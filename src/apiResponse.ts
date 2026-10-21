// Gateways and platform-level timeouts may return HTML even when our API uses JSON.
export async function readAIResponse(response: Response) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    /* no raw gateway HTML in UI */
  }
  const value = body as { error?: unknown; result?: unknown } | undefined;
  if (!response.ok) {
    const fallback =
      response.status === 413
        ? "输入内容过大，请缩短或分段处理"
        : response.status === 429
          ? "请求过于频繁或额度已达上限，请稍后再试"
          : response.status === 401
            ? "登录已过期，请重新登录"
            : "AI 服务暂时不可用，请稍后重试";
    throw Error(typeof value?.error === "string" ? value.error : fallback);
  }
  if (!value || !Object.hasOwn(value, "result"))
    throw Error("AI 服务返回格式异常，请稍后重试");
  return value.result;
}
