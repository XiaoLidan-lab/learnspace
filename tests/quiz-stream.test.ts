import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { quizPreview } from "../src/quizPreview";
import { quizSchema } from "../src/aiSchemas";
import { readTextStream } from "../src/eventStream";
import { createApp } from "../server/api";

const q = {
  type: "choice",
  question: '中文问题 {x} [y] "引号" 和 $1/\\sqrt{d_k}$',
  options: ["A", "B"],
  answer: "A",
  explanation: '解释含 \\ 和 " } , { [ ] 中文',
};
const question = JSON.stringify(q);
const prefix = '{"questions":[';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
async function close(s: Server) {
  s.closeAllConnections();
  await new Promise<void>((r) => s.close(() => r()));
}

test("quiz previews withstand every split point in escaped strings, LaTeX, Unicode and nested delimiters", () => {
  for (let i = 0; i < question.length; i++)
    assert.deepEqual(quizPreview(prefix + question.slice(0, i)), []);
  assert.deepEqual(quizPreview(prefix + question + ","), [q]);
  const second = { ...q, question: "second question" };
  const full = JSON.stringify({ questions: [q, second] });
  assert.deepEqual(quizPreview(full), [q, second]);
  assert.deepEqual(
    quizPreview(prefix + question + "," + JSON.stringify(second).slice(0, -1)),
    [q],
  );
});
test("preview rejects invalid questions, never skips invalid entries, and bounds count and input size", () => {
  for (const invalid of [
    { ...q, answer: "not-an-option" },
    { ...q, options: ["A", "A"] },
    { ...q, type: "short" },
    { ...q, unexpected: true },
  ]) {
    assert.deepEqual(
      quizPreview(JSON.stringify({ questions: [invalid, q] })),
      [],
    );
  }
  assert.deepEqual(
    quizPreview("```json\n" + JSON.stringify({ questions: [q] }) + "\n```"),
    [],
  );
  assert.deepEqual(quizPreview("x".repeat(100001)), []);
  assert.equal(
    quizPreview(
      JSON.stringify({ questions: Array.from({ length: 12 }, () => q) }),
    ).length,
    10,
  );
  // A visible, valid first question is still only a preview: a broken remainder fails final schema validation.
  const incomplete = prefix + question + ",";
  assert.equal(quizPreview(incomplete).length, 1);
  assert.throws(() => quizSchema.parse(JSON.parse(incomplete)));
});

test("quiz HTTP streams validated question previews before completion and commits one validated object at the end", async (t) => {
  const gate = deferred();
  const first = deferred();
  let upstream: any;
  let mode: "valid" | "invalid" = "valid";
  const ops: string[] = [];
  const provider = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    upstream = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const push = (content: string) =>
      res.write(
        "data: " +
          JSON.stringify({
            choices: [{ delta: { content }, finish_reason: null }],
          }) +
          "\n\n",
      );
    push(prefix + question + ",");
    await gate.promise;
    push(
      JSON.stringify(
        mode === "valid"
          ? { ...q, question: "second" }
          : { ...q, answer: "wrong" },
      ) + "]}",
    );
    res.end(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
  });
  const base = await listen(provider);
  const old = process.env.AI_BASE_URL;
  process.env.AI_BASE_URL = base;
  const api = createServer(
    createApp(
      {
        authenticate: async () => "synthetic-user",
        quota: {
          async apply(i) {
            ops.push(i.operation);
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
  const post = () =>
    fetch(url + "/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: "Bearer synthetic",
      },
      body: JSON.stringify({
        action: "quiz",
        payload: { text: "synthetic quiz material" },
      }),
    });
  const response = await post();
  let ended = false;
  let preview: unknown[] = [];
  const final = readTextStream(
    response,
    (text) => {
      preview = quizPreview(text);
      first.resolve();
    },
    true,
  ).finally(() => {
    ended = true;
  });
  await Promise.race([
    first.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("No first question")), 2000),
    ),
  ]);
  assert.equal(ended, false);
  assert.deepEqual(preview, [q]);
  assert.equal(upstream.stream, true);
  assert.equal(upstream.max_tokens, 6144);
  assert.deepEqual(upstream.response_format, { type: "json_object" });
  gate.resolve();
  assert.equal(quizSchema.parse(await final).questions.length, 2);
  assert.deepEqual(ops, ["begin", "finish"]);
  mode = "invalid";
  const invalid = await post();
  let partial = "";
  await assert.rejects(
    readTextStream(invalid, (text) => (partial = text), true),
    /格式不正确/,
  );
  assert.equal(quizPreview(partial).length, 1);
  assert.deepEqual(ops, ["begin", "finish", "begin", "finish"]);
});
