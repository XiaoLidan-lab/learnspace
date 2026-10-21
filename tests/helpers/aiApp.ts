// Explicit test-only quota injection. Production has no in-memory fallback.
import {
  createApp as productionApp,
  type Dependencies,
} from "../../server/api";
import { AIServiceError, type AIQuota } from "../../server/aiQuota";
export { guidance } from "../../server/api";
export function createTestQuota(): AIQuota {
  const counts = new Map<string, number>();
  const active = new Map<string, string>();
  const used = new Set<string>();
  return {
    async apply(input) {
      if (input.operation === "finish") {
        active.delete(input.user);
        return;
      }
      if (input.operation === "reserve") return;
      if (used.has(input.request))
        throw new AIServiceError(409, "DUPLICATE", "重复请求");
      if (active.has(input.user))
        throw new AIServiceError(429, "CONCURRENCY", "已有请求");
      const count = counts.get(input.user) || 0;
      if (count >= 15)
        throw new AIServiceError(429, "RATE_LIMIT", "请求过于频繁");
      counts.set(input.user, count + 1);
      used.add(input.request);
      active.set(input.user, input.request);
    },
  };
}
export function createApp(
  deps: Dependencies = {},
  options?: { serveFrontend?: boolean },
) {
  return productionApp(
    { ...deps, quota: deps.quota || createTestQuota() },
    options,
  );
}
