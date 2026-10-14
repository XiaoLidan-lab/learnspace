import test from "node:test";
import assert from "node:assert/strict";
import { authCallbackError } from "../src/authErrors";
test("登录回调错误显示普通说明，不回显 token 或第三方错误正文", () => {
  assert.equal(authCallbackError(""), null);
  assert.equal(authCallbackError("#access_token=secret"), null);
  assert.match(
    authCallbackError("#error=access_denied&error_code=otp_expired")!,
    /已失效或过期/,
  );
  assert(
    !authCallbackError(
      "#error=secret&error_description=secret-token",
    )!.includes("secret"),
  );
});

test("邮件限额错误与普通请求限流提供不同提示，不回显原始错误", async () => {
  const { authErrorMessage } = await import("../src/authErrors");
  assert.match(
    authErrorMessage({ code: "over_email_send_rate_limit", status: 429 }),
    /发送额度已用完/,
  );
  assert.match(
    authErrorMessage({ message: "email rate limit exceeded" }),
    /发送额度/,
  );
  assert.match(
    authErrorMessage({ status: 429, code: "over_request_rate_limit" }),
    /请求过于频繁/,
  );
  assert(
    !authErrorMessage({ message: "secret provider details" }).includes(
      "secret",
    ),
  );
});

test("密码登录失败区分无效凭证与邮箱未确认，不暴露原始详情", async () => {
  const { authErrorMessage } = await import("../src/authErrors");
  assert.match(
    authErrorMessage({ code: "invalid_credentials" }),
    /邮箱或密码不正确/,
  );
  assert.match(authErrorMessage({ code: "email_not_confirmed" }), /尚未确认/);
});
