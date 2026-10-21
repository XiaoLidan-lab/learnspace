import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./helpers/aiApp";
import type { Server } from "node:http";
test("全文分段分析沿用鉴权、严格请求与摘要长度校验", async () => {
  let output = "合成知识要点";
  const server: Server = await new Promise((resolve) => {
    const app = createApp({
      authenticate: async (token) => (token === "test" ? "digest-user" : null),
      complete: async () => output,
    });
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const post = (payload: unknown, auth = true) =>
    fetch(`http://127.0.0.1:${port}/api/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: "Bearer test" } : {}),
      },
      body: JSON.stringify({ action: "documentDigest", payload }),
    });
  try {
    assert.equal((await post({ text: "合成正文" }, false)).status, 401);
    assert.equal((await post({ text: "合成正文", extra: true })).status, 400);
    assert.equal((await post({ text: "x".repeat(12001) })).status, 400);
    assert.equal((await post({ text: "合成正文" })).status, 200);
    output = "x".repeat(1801);
    assert.equal((await post({ text: "合成正文" })).status, 502);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test("AI HTTP 集成：身份验证、输入校验、结果校验和限流", async () => {
  let result = "测试译文";
  const app = createApp({
    authenticate: async (token) => (token === "valid" ? "user1" : null),
    complete: async () => result,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  const post = (action: string, payload: unknown, token?: string) =>
    fetch(`http://127.0.0.1:${port}/api/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, payload }),
    });
  try {
    assert.equal(
      (await post("translate", { text: "hi", language: "简体中文" })).status,
      401,
    );
    assert.equal(
      (await post("translate", { text: "hi", language: "简体中文" }, "bad"))
        .status,
      401,
    );
    assert.equal((await post("unsupported", {}, "valid")).status, 400);
    assert.equal(
      (await post("translate", { text: "", language: "简体中文" }, "valid"))
        .status,
      400,
    );
    const r = await post(
      "translate",
      { text: "hi", language: "简体中文" },
      "valid",
    );
    assert.equal(r.status, 200);
    assert.equal((await r.json()).result, "测试译文");
    result = '{"modules":[]}';
    assert.equal(
      (await post("layout", { request: "论文阅读" }, "valid")).status,
      502,
    );
    for (let i = 0; i < 14; i++)
      await post("translate", { text: "hi", language: "简体中文" }, "valid");
    assert.equal(
      (await post("translate", { text: "hi", language: "简体中文" }, "valid"))
        .status,
      429,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
