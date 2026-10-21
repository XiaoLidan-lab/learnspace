import test from "node:test";
import assert from "node:assert/strict";
import { createSharedRequests } from "../src/sharedRequests";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test("同一分析只发一次，取消导图不影响测验继续等待", async () => {
  const share = createSharedRequests<string>(), gate = deferred<string>();
  const map = new AbortController(), quiz = new AbortController();
  let calls = 0, upstream: AbortSignal | undefined;
  const run = (signal: AbortSignal) => { calls++; upstream = signal; return gate.promise; };
  const first = share("user/file/part", run, map.signal);
  const second = share("user/file/part", run, quiz.signal);
  await Promise.resolve();
  assert.equal(calls, 1);
  const cancelled = assert.rejects(first, { name: "AbortError" });
  map.abort();
  await cancelled;
  assert.equal(upstream?.aborted, false);
  gate.resolve("共享摘要");
  assert.equal(await second, "共享摘要");
});
test("全部取消中止上游，旧请求迟到不干扰新一轮共享", async () => {
  const share = createSharedRequests<string>(), old = deferred<string>(), next = deferred<string>();
  const a = new AbortController(), b = new AbortController();
  let upstream: AbortSignal | undefined, calls = 0;
  const run = (signal: AbortSignal) => { upstream = signal; calls++; return old.promise; };
  const first = share("key", run, a.signal), second = share("key", run, b.signal);
  await Promise.resolve();
  const cancelled = Promise.all([assert.rejects(first, { name: "AbortError" }), assert.rejects(second, { name: "AbortError" })]);
  a.abort(); b.abort();
  await cancelled;
  assert.equal(upstream?.aborted, true);
  const retry = share("key", () => { calls++; return next.promise; });
  old.resolve("旧结果");
  await old.promise; await Promise.resolve();
  const follower = share("key", () => { throw Error("不应另发请求"); });
  next.resolve("新结果");
  assert.deepEqual(await Promise.all([retry, follower]), ["新结果", "新结果"]);
  assert.equal(calls, 2);
});
test("失败不缓存，重试可恢复，已完成的结果不成为永久共享缓存", async () => {
  const share = createSharedRequests<string>(), gate = deferred<string>();
  let calls = 0;
  const run = () => { calls++; return gate.promise; };
  const a = share("key", run), b = share("key", run);
  const failed = Promise.all([assert.rejects(a, /网络失败/), assert.rejects(b, /网络失败/)]);
  gate.reject(Error("网络失败")); await failed;
  assert.equal(calls, 1);
  assert.equal(await share("key", async () => { calls++; return "重试"; }), "重试");
  assert.equal(await share("key", async () => { calls++; return "重新分析"; }), "重新分析");
  assert.equal(calls, 3);
});
test("不同账号或输入互不合并，预先取消的请求不会启动", async () => {
  const share = createSharedRequests<string>(), gate = deferred<string>();
  let calls = 0;
  const run = () => { calls++; return gate.promise; };
  const requests = [share(JSON.stringify(["A", "x"]), run), share(JSON.stringify(["B", "x"]), run), share(JSON.stringify(["A", "y"]), run)];
  await Promise.resolve(); assert.equal(calls, 3);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(share("stopped", run, stopped.signal), { name: "AbortError" });
  gate.resolve("结果"); await Promise.all(requests);
  assert.equal(calls, 3);
});
