import { readTextStream } from "./eventStream";
import { readAIResponse } from "./apiResponse";
import { createSharedRequests } from "./sharedRequests";
import { createClient } from "@supabase/supabase-js";
export const supabase =
  import.meta.env?.VITE_SUPABASE_URL && import.meta.env?.VITE_SUPABASE_ANON_KEY
    ? createClient(
        import.meta.env?.VITE_SUPABASE_URL,
        import.meta.env?.VITE_SUPABASE_ANON_KEY,
      )
    : null;
let nextDigestAt = 0;
const sharedDigest = createSharedRequests<unknown>();
async function documentRequestSlot(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const delay = Math.max(0, nextDigestAt - Date.now());
  nextDigestAt = Date.now() + delay + 4500;
  if (!delay) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function ai(
  action: string,
  payload: unknown,
  signal?: AbortSignal,
  onText?: (text: string) => void,
) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const session = (await supabase?.auth.getSession())?.data.session;
  const token = session?.access_token;
  if (!session || !token) throw Error("请先登录后使用 AI 服务");
  if (action === "documentDigest") {
    // Different modules can analyze the same file concurrently without sending
    // duplicate digest requests. Never share across authenticated accounts.
    return sharedDigest(
      JSON.stringify([session.user.id, payload]),
      sharedSignal => requestAI(action, payload, token, sharedSignal),
      signal,
    );
  }
  return requestAI(action, payload, token, signal, onText);
}
async function requestAI(
  action: string,
  payload: unknown,
  token: string,
  signal?: AbortSignal,
  onText?: (text: string) => void,
) {
  // Pace actual requests, not subscribers. Database limits remain authoritative.
  if (action === "documentDigest") await documentRequestSlot(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(onText ? { Accept: "text/event-stream" } : {}),
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ action, payload }),
      signal: controller.signal,
    });
    if (r.ok && onText && r.headers.get("content-type")?.includes("text/event-stream")) {
      const result = await readTextStream(r, onText, action === "quiz");
      if (action === "quiz") {
        const { quizSchema } = await import("./aiSchemas");
        return quizSchema.parse(result);
      }
      return result;
    }
    return await readAIResponse(r);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
