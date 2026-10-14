export function authCallbackError(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!params.get("error")) return null;
  return params.get("error_code") === "otp_expired"
    ? "登录链接已失效或过期，请重新发送，并打开最新邮件中的登录链接。"
    : "登录未完成，请重新发送登录链接后重试。";
}

export function authErrorMessage(error: {
  code?: string;
  status?: number;
  message?: string;
}): string {
  const message = error.message?.toLowerCase() || "";
  if (
    error.code === "invalid_credentials" ||
    message.includes("invalid login credentials")
  )
    return "邮箱或密码不正确，或该账号尚未设置密码，请检查后重试。";
  if (error.code === "email_not_confirmed")
    return "账号邮箱尚未确认，请完成邮箱验证后再登录。";
  if (
    error.code === "over_email_send_rate_limit" ||
    message.includes("email rate limit exceeded")
  )
    return "登录邮件发送额度已用完。请稍后重试或联系管理员检查邮件服务；重复点击不会恢复额度。";
  if (error.code === "over_request_rate_limit" || error.status === 429)
    return "登录请求过于频繁，请稍后重试。";
  if (
    error.code === "email_address_not_authorized" ||
    error.code === "email_address_not_allowed" ||
    message.includes("not authorized")
  )
    return "此邮箱暂不在邮件服务允许的范围内，请使用允许的测试邮箱或联系管理员。";
  if (error.code === "otp_expired")
    return "登录链接已失效或过期，请使用最新邮件中的链接。";
  if (error.code === "email_address_invalid")
    return "邮箱地址格式不正确，请检查后重试。";
  return "登录请求失败，请检查网络及 Supabase 邮件服务配置后重试。";
}
export function readAuthRetryDeadline(): number {
  try {
    return Number(localStorage.getItem("learnspace-auth-retry-v1")) || 0;
  } catch {
    return 0;
  }
}
export function saveAuthRetryDeadline(deadline: number) {
  try {
    localStorage.setItem("learnspace-auth-retry-v1", String(deadline));
  } catch {}
}
