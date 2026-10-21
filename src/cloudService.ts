import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseCloudPayload,
  type CloudPayload,
  type CloudRecord,
} from "./cloudData";
// Bound the entire request, including token acquisition before fetch starts.
async function cloudRequest<T>(
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  const controller = new AbortController();
  let rejectCancel!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancel = reject;
  });
  const abort = () => {
    rejectCancel(new DOMException("Aborted", "AbortError"));
    controller.abort();
  };
  const timer = setTimeout(() => {
    rejectCancel(
      Error(
        "云端请求超时，保存结果尚未确认。请刷新列表核对版本后重试；本地内容已保留。",
      ),
    );
    controller.abort();
  }, 20000);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([run(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export function cloudError(error: { code?: string; message?: string }) {
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code || ""))
    return "云端任务存储尚未初始化，请联系管理员；内容仍保存在此设备。";
  if (
    error.code === "PT409" ||
    error.code === "40001" ||
    error.code === "23505"
  )
    return "云端版本已改变。请刷新云端列表并另存副本，避免覆盖另一台设备的修改。";
  if (error.code === "42501") return "没有云端访问权限，请重新登录。";
  return "云端连接或保存失败，请检查网络后重试；本地内容已保留。";
}
export async function listCloud(
  client: SupabaseClient,
  signal?: AbortSignal,
): Promise<CloudRecord[]> {
  const query = client
    .from("learning_workspaces")
    .select("workspace_id,revision,payload,updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  const { data, error } = await cloudRequest(signal, (s) =>
    query.abortSignal(s),
  );
  if (error) throw Error(cloudError(error));
  return (data || []).map((r) => {
    const payload = parseCloudPayload(r.payload);
    if (
      payload.workspace.id !== r.workspace_id ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1
    )
      throw Error("云端数据标识或版本无效，未导入任何内容");
    return { ...r, payload };
  });
}
export async function saveCloud(
  client: SupabaseClient,
  workspaceId: string,
  revision: number,
  payload: CloudPayload,
  signal?: AbortSignal,
): Promise<number> {
  const query = client.rpc("save_learning_workspace", {
    p_workspace_id: workspaceId,
    p_expected_revision: revision,
    p_payload: parseCloudPayload(payload),
  });
  const { data, error } = await cloudRequest(signal, (s) =>
    query.abortSignal(s),
  );
  if (error) throw Error(cloudError(error));
  if (!Number.isSafeInteger(data) || data < 1)
    throw Error("云端未确认保存结果，请刷新列表核对版本");
  return data;
}
