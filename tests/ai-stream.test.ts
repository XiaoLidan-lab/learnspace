import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { eventData, readTextStream } from "../src/eventStream";
import { readAIResponse } from "../src/apiResponse";
import { createApp } from "../server/api";
import { AIServiceError, type AIQuota } from "../server/aiQuota";

const encoded = (text: string) => new TextEncoder().encode(text);
const streamResponse = (text: string) =>
  new Response(text, { headers: { "Content-Type": "text/event-stream" } });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
const requestBody = {
  action: "translate",
  payload: { text: "Synthetic input", language: "简体中文" },
};
const headers = {
  "Content-Type": "application/json",
  Authorization: "Bearer synthetic",
  Accept: "text/event-stream",
};

test("SSE handles UTF-8 byte splits, CRLF, comments and multiline data", async () => {
  const bytes = encoded(
    ': heartbeat\r\ndata: {"delta":\r\ndata: "中文"}\r\n\r\ndata: [DONE]\r\n\r\n',
  );
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of bytes) c.enqueue(new Uint8Array([b]));
      c.close();
    },
  });
  const events = [];
  for await (const data of eventData(body)) events.push(data);
  assert.deepEqual(JSON.parse(events[0]), { delta: "中文" });
  assert.equal(events[1], "[DONE]");
});
test("browser requires final result and rejects failures after showing partial text", async () => {
  const shown: string[] = [];
  await assert.rejects(
    readTextStream(streamResponse('data: {"delta":"部分"}\n\n'), (text) =>
      shown.push(text),
    ),
    /中断/,
  );
  assert.deepEqual(shown, ["部分"]);
  await assert.rejects(
    readTextStream(
      streamResponse(
        'data: {"delta":"部分"}\n\ndata: {"error":"额度服务异常"}\n\n',
      ),
      () => {},
    ),
    /额度服务异常/,
  );
  await assert.rejects(
    readTextStream(streamResponse('data: {"delta":"unfinished"}'), () => {}),
    /中断/,
  );
  assert.equal(
    await readTextStream(
      streamResponse('data: {"delta":"答"}\n\ndata: {"result":"答案"}\n\n'),
      () => {},
    ),
    "答案",
  );
  assert.equal(
    await readAIResponse(Response.json({ result: "legacy" })),
    "legacy",
  );
});

test("real HTTP streaming path forwards text before provider completes, retains token caps and one quota lease", async (t) => {
  const gate = deferred();
  let upstream: any;
  let providerCalls = 0;
  const operations: string[] = [];
  const provider = createServer(async (req, res) => {
    providerCalls++;
    let body = "";
    for await (const chunk of req) body += chunk;
    upstream = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      'data: {"choices":[{"delta":{"content":"先显示"},"finish_reason":null}]}\n\n',
    );
    await gate.promise;
    res.end(
      'data: {"choices":[{"delta":{"content":"后完成"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
  const base = await listen(provider);
  const old = process.env.AI_BASE_URL;
  process.env.AI_BASE_URL = base;
  const api = createServer(
    createApp(
      {
        authenticate: async () => "test-user",
        quota: {
          async apply(input) {
            operations.push(input.operation);
          },
        },
      },
      { serveFrontend: false },
    ),
  );
  const url = await listen(api);
  t.after(async () => {
    gate.resolve();
    await close(api);
    await close(provider);
    if (old === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = old;
  });
  const response = await fetch(url + "/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  assert.match(response.headers.get("content-type")!, /text\/event-stream/);
  const first = deferred();
  let settled = false;
  const shown: string[] = [];
  const result = readTextStream(response, (text) => {
    shown.push(text);
    first.resolve();
  }).finally(() => {
    settled = true;
  });
  await Promise.race([
    first.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("No first chunk")), 2000),
    ),
  ]);
  assert.equal(settled, false);
  assert.deepEqual(shown, ["先显示"]);
  assert.equal(upstream.stream, true);
  assert.equal(upstream.max_tokens, 8192);
  gate.resolve();
  assert.equal(await result, "先显示后完成");
  assert.equal(providerCalls, 1);
  assert.deepEqual(operations, ["begin", "finish"]);
});

test("stream errors, timeout, cancellation and quota rejection do not masquerade as successful results", async (t) => {
  const servers: Server[] = [];
  t.after(async () => {
    for (const s of servers) await close(s);
  });
  async function serve(complete: any, quota?: AIQuota, timeoutMs = 1000) {
    const s = createServer(
      createApp(
        {
          authenticate: async () => "test",
          quota: quota || { async apply() {} },
          complete,
          timeoutMs,
        },
        { serveFrontend: false },
      ),
    );
    servers.push(s);
    return listen(s);
  }
  const failures = await serve(async (_a: any, _p: any, _i: any, o: any) => {
    o.onDelta("partial");
    throw Error("private error text");
  });
  const r = await fetch(failures + "/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  const text = await r.text();
  assert.match(text, /"delta":"partial"/);
  assert.match(text, /"code":"INTERNAL_ERROR"/);
  assert(!text.includes('"result"'));
  assert(!text.includes("private error text"));
  const ops: string[] = [];
  const timeout = await serve(
    async (_a: any, _p: any, _i: any, o: any) => {
      o.onDelta("partial");
      await new Promise(() => {});
    },
    {
      async apply(i) {
        ops.push(i.operation);
      },
    },
    40,
  );
  const timed = await fetch(timeout + "/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  await assert.rejects(
    readTextStream(timed, () => {}),
    /超时/,
  );
  assert.deepEqual(ops, ["begin"]);
  let called = false;
  const denied = await serve(
    async () => {
      called = true;
      return "bad";
    },
    {
      async apply() {
        throw new AIServiceError(503, "QUOTA_UNAVAILABLE", "配额暂不可用");
      },
    },
  );
  const blocked = await fetch(denied + "/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
  assert.equal(blocked.status, 503);
  assert.match(blocked.headers.get("content-type")!, /json/);
  assert.equal(called, false);
  let abortObserved = false;
  const abortGate = deferred();
  const cancel = await serve(async (_a: any, _p: any, _i: any, o: any) => {
    o.onDelta("partial");
    await new Promise<void>((resolve) =>
      o.signal.addEventListener(
        "abort",
        () => {
          abortObserved = true;
          abortGate.resolve();
          resolve();
        },
        { once: true },
      ),
    );
    return "unused";
  });
  const controller = new AbortController();
  const cancelled = await fetch(cancel + "/api/ai", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });
  await assert.rejects(readTextStream(cancelled, () => controller.abort()));
  await Promise.race([
    abortGate.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Provider not cancelled")), 2000),
    ),
  ]);
  assert(abortObserved);
});

test("provider stream truncation and token exhaustion fail explicitly without a final result", async (t) => {
  let mode = "truncated";
  const provider = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    res.end(
      mode === "length"
        ? 'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
        : "",
    );
  });
  const base = await listen(provider),
    old = process.env.AI_BASE_URL;
  process.env.AI_BASE_URL = base;
  const api = createServer(
    createApp(
      { authenticate: async () => "synthetic", quota: { async apply() {} } },
      { serveFrontend: false },
    ),
  );
  const url = await listen(api);
  t.after(async () => {
    await close(api);
    await close(provider);
    if (old === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = old;
  });
  for (mode of ["truncated", "length"]) {
    const response = await fetch(url + "/api/ai", {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
    const text = await response.text();
    assert.match(text, /"delta":"partial"/);
    assert.match(text, /"error"/);
    assert(!text.includes('"result"'));
  }
});
