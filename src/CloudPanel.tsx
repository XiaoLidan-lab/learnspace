import { useDialogFocus } from "./useDialogFocus";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace, Note } from "./model";
import { listCloud } from "./cloudService";
import { cloudCopy, payloadHash, type CloudRecord } from "./cloudData";
import { store } from "./storage";
export function CloudPanel({
  client,
  userId,
  current,
  status,
  close,
  enable,
  restore,
  retry,
}: {
  client: SupabaseClient | null;
  userId?: string;
  current?: Workspace;
  status?: string;
  close: () => void;
  enable: () => void;
  restore: (w: Workspace, notes: Note[]) => void;
  retry: () => void;
}) {
  const [rows, setRows] = useState<CloudRecord[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!client || !userId) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    listCloud(client, controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) setRows(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [client, userId, revision]);
  const dialogPanel = useDialogFocus(close, busy);
  const install = async (row: CloudRecord) => {
    if (!userId) return;
    setBusy(true);
    setError("");
    try {
      const exists = (await store.workspaces()).some(
        (w) => w.id === row.workspace_id,
      );
      const existingNotes = await store.notes();
      const collision = row.payload.notes.some((n) =>
        existingNotes.some((x) => x.id === n.id),
      );
      const copy = exists || collision;
      const installed: { workspace: Workspace; notes: Note[] } = copy
        ? cloudCopy(row.payload)
        : {
            workspace: structuredClone(row.payload.workspace),
            notes: structuredClone(row.payload.notes),
          };
      if (
        copy &&
        !confirm(
          "此设备已有同名标识的内容。将另存为独立副本，不覆盖本地内容，是否继续？",
        )
      )
        return;
      if (!copy)
        installed.workspace.cloud = {
          ownerId: userId,
          revision: row.revision,
          syncedHash: await payloadHash(row.payload),
          syncedAt: Date.now(),
        };
      await store.saveInstallation(installed.workspace, installed.notes, []);
      restore(installed.workspace, installed.notes);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复失败，本地内容未覆盖");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        ref={dialogPanel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="云端工作台"
      >
        <button
          className="modal-close"
          aria-label="关闭云端工作台"
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
        <h2>云端工作台</h2>
        <p className="modal-subtitle">
          保存工作台配置、笔记和模块内容。原始
          PDF、图片、视频文件不会上传，跨设备需重新选择文件。
        </p>
        {!userId ? (
          <p>请先登录后使用云端保存与恢复。本地学习仍可继续。</p>
        ) : (
          <>
            {current && (
              <div className="task-link">
                <b>{current.title}</b>
                <p role="status">
                  {current.cloud?.ownerId === userId
                    ? status || "等待同步"
                    : "仅在本地，尚未开启云端同步"}
                </p>
                {current.cloud?.ownerId === userId ? (
                  <button className="btn" onClick={retry}>
                    重试同步
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    onClick={() => {
                      if (current.cloud && current.cloud.ownerId !== userId) {
                        setError(
                          "此工作台已绑定另一账号，请复制为独立工作台后再同步。",
                        );
                        return;
                      }
                      if (
                        confirm(
                          "将此工作台的配置、笔记和模块内容保存到当前登录账号？原始文件不会上传。",
                        )
                      )
                        enable();
                    }}
                  >
                    开启当前工作台同步
                  </button>
                )}
              </div>
            )}
            <div className="section-heading">
              <h3>从云端恢复</h3>
              <button
                className="btn mini"
                disabled={busy}
                onClick={() => setRevision((n) => n + 1)}
              >
                刷新列表
              </button>
            </div>
            {busy && <p role="status">正在连接云端…</p>}
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            {!busy && !error && !rows.length && (
              <p>还没有云端学习工作台。打开本地工作台后，可在这里开启同步。</p>
            )}
            {rows.map((r) => (
              <div className="task-link" key={r.workspace_id}>
                <b>{r.payload.workspace.title}</b>
                <p className="small">
                  云端版本 {r.revision} ·{" "}
                  {new Date(r.updated_at).toLocaleString("zh-CN")}
                </p>
                <button
                  className="btn mini"
                  disabled={busy}
                  onClick={() => void install(r)}
                >
                  恢复／另存副本
                </button>
              </div>
            ))}
            <p className="small">
              同一工作台发生版本冲突时停止上传，保留本地修改。恢复到已有设备默认另存副本，不自动覆盖。
            </p>
          </>
        )}
      </section>
    </div>
  );
}
