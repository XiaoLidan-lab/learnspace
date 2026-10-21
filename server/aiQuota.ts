import { createClient } from "@supabase/supabase-js";

export class AIServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export type QuotaOperation = {
  operation: "begin" | "reserve" | "finish";
  user: string;
  request: string;
  hash?: string;
  units?: number;
};
export interface AIQuota {
  apply(input: QuotaOperation): Promise<void>;
}

export function supabaseQuota(): AIQuota {
  return {
    async apply(input) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw unavailable();
      try {
        const client = createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (url, init) =>
              fetch(url, { ...init, signal: AbortSignal.timeout(4000) }),
          },
        });
        const { data, error } = await client.rpc("learnspace_ai_quota", {
          p_operation: input.operation,
          p_user: input.user,
          p_request: input.request,
          p_hash: input.hash || "",
          p_units: input.units || 0,
        });
        if (error || !data || typeof data.allowed !== "boolean")
          throw unavailable();
        if (!data.allowed) {
          const code = data.code as string;
          if (code === "DUPLICATE")
            throw new AIServiceError(
              409,
              "DUPLICATE",
              "相同请求正在处理或已经提交，请勿重复发送",
            );
          if (code === "EXPIRED")
            throw new AIServiceError(409, code, "请求已结束或过期，请重新提交");
          if (!["RATE_LIMIT", "CONCURRENCY", "BUDGET"].includes(code))
            throw unavailable();
          throw new AIServiceError(
            429,
            code,
            code === "BUDGET"
              ? "AI 使用额度已达上限，请联系管理员；普通学习仍可使用"
              : code === "CONCURRENCY"
                ? "已有 AI 请求正在处理，请稍后再试"
                : "请求过于频繁，请稍后重试",
            code === "BUDGET" ? undefined : Number(data.retry_after) || 60,
          );
        }
      } catch (error) {
        if (error instanceof AIServiceError) throw error;
        throw unavailable();
      }
    },
  };
}
function unavailable() {
  return new AIServiceError(
    503,
    "QUOTA_UNAVAILABLE",
    "AI 配额服务暂不可用，已暂停新请求；普通学习仍可使用",
  );
}

export const outputTokenLimits = {
  translate: 8192,
  summary: 4096,
  documentDigest: 2048,
  cards: 4096,
  mindmap: 6144,
  quiz: 6144,
  chat: 4096,
  layout: 8192,
  custom: 6144,
  taskAssist: 6144,
} as const;
// Conservative admission units, NOT provider usage/billing. Never refunded.
export function reservationUnits(
  messages: { role: string; content: string }[],
  output: number,
) {
  return (
    Buffer.byteLength(JSON.stringify(messages), "utf8") +
    messages.length * 1024 +
    output
  );
}

export function providerTokenOptions(
  base: string,
  model: string,
  limit: number,
) {
  const host = new URL(base).hostname;
  // Qwen's max_tokens may exclude reasoning. This app does not need thinking mode.
  const qwen = host.endsWith(".aliyuncs.com") && /^qwen/i.test(model);
  return { max_tokens: limit, ...(qwen ? { enable_thinking: false } : {}) };
}
