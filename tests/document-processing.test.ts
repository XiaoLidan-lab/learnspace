import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { ensurePdfIndex, documentParts, type PdfLoader } from "../src/pdfIndex";
import {
  createDocumentReader,
  digestText,
  reduceDigests,
  type DocumentReport,
} from "../src/documentProcessing";
import { prepareLearningInput } from "../src/materialInput";
import { prepareChatContext } from "../src/chatContext";
import { validateAIResult } from "../src/aiSchemas";
import { flowStateSchema } from "../src/flowSchema";
import { cloudPayload, parseCloudPayload } from "../src/cloudData";
import { directConnection } from "../src/connectionGraph";
import { uid, type Mod, type Resource, type Workspace } from "../src/model";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
async function fixture(texts: string[], type: Mod["type"] = "mindmap") {
  const resource: Resource = {
    id: uid(),
    version: "v1",
    name: "合成全文.pdf",
    file: new Blob(["fixture"], { type: "application/pdf" }),
    createdAt: 0,
  };
  const load: PdfLoader = () => ({
    promise: Promise.resolve({
      numPages: texts.length,
      getPage: async (page) => ({
        getTextContent: async () => ({ items: [{ str: texts[page - 1] }] }),
      }),
    }),
    destroy: async () => {},
  });
  await ensurePdfIndex(resource, { load });
  const source: Mod = {
    id: uid(),
    type: "pdf",
    title: "文件",
    resourceId: resource.id,
    layout: { x: 0, y: 0, w: 6, h: 8 },
  };
  const target: Mod = {
    id: uid(),
    type,
    title: "工具",
    layout: { x: 6, y: 0, w: 6, h: 8 },
    input: type === "chat" ? "结尾代号是什么？" : undefined,
  };
  const edge = directConnection(
    [source, target],
    [],
    source.id,
    "selection",
    target.id,
    type === "chat" ? "context" : "input",
    uid(),
  );
  edge.source.range = "document";
  target.data = {
    flow: { materials: [edge], inputs: [], materialMode: "sources" },
  };
  const workspace: Workspace = {
    id: uid(),
    title: "全文合成测试",
    description: "",
    modules: [source, target],
    createdAt: 0,
    updatedAt: 0,
    isolationVersion: 1,
  };
  return {
    target,
    source,
    resource,
    ctx: { workspace, resources: [resource], notes: [], selection: null },
    edge,
  };
}
test("全文分段不丢尾部，短文无需额外 AI，保留原文页码", async () => {
  const f = await fixture(["首段知识", "末段答案 END-739"]);
  const chunks = [];
  for await (const part of documentParts(f.resource)) chunks.push(part);
  assert.equal(chunks.length, 2);
  const reports: DocumentReport[] = [];
  const reader = createDocumentReader({
    ctx: f.ctx,
    targetId: f.target.id,
    budget: 16000,
    reports,
    call: async () => {
      throw Error("短文不应额外调用");
    },
  });
  const prepared = await prepareLearningInput(
    f.target,
    f.ctx,
    undefined,
    reader,
  );
  assert.match(prepared.material.input!, /END-739/);
  assert.equal(reports[0].method, "direct");
  assert.equal(prepared.material.source?.page, 1);
});
test("超过23000字符的全文每段均被分析，失败重试复用完成段，持久化快照有界", async () => {
  const f = await fixture(
    Array.from(
      { length: 8 },
      (_, i) => `章节${i + 1} CODE-${i + 1} ` + "正文知识 ".repeat(850),
    ),
  );
  const seen: string[] = [];
  let fail = true;
  const call = async (_action: string, payload: any) => {
    seen.push(payload.text);
    if (seen.length === 3 && fail) throw Error("合成网络失败");
    return `要点：${payload.text.match(/CODE-\d+/)?.[0]}`;
  };
  const options = { ctx: f.ctx, targetId: f.target.id, budget: 16000, call };
  const original = structuredClone(f.target);
  await assert.rejects(
    prepareLearningInput(
      f.target,
      f.ctx,
      undefined,
      createDocumentReader(options),
    ),
    /第 3\/8 段分析失败/,
  );
  assert.deepEqual(f.target, original);
  fail = false;
  const reports: DocumentReport[] = [];
  const prepared = await prepareLearningInput(
    f.target,
    f.ctx,
    undefined,
    createDocumentReader({ ...options, reports }),
  );
  assert.equal(seen.length, 9); // 2 cached successes, 1 failed attempt, 6 remaining calls.
  assert.match(prepared.material.input!, /CODE-1/);
  assert.match(prepared.material.input!, /CODE-8/);
  assert.equal(reports[0].parts, 8);
  assert.equal(reports[0].method, "digest");
  assert.ok(prepared.material.input!.length < 23000);
  flowStateSchema.parse(prepared.material.data?.flow);
  const changed = structuredClone(f.ctx);
  changed.workspace.activeTaskId = "other";
  assert.throws(() => prepared.assertCurrent(changed), /任务/);
});
test("针对性问答检索文末而非只读开头，不额外摘要，无结果明确失败", async () => {
  const f = await fixture(
    ["开头内容 irrelevant ".repeat(400), "结尾代号为 PINE-246。"],
    "chat",
  );
  const reader = createDocumentReader({
    ctx: f.ctx,
    targetId: f.target.id,
    budget: 16000,
    query: f.target.input,
    call: async () => {
      throw Error("检索不应调用摘要");
    },
  });
  const prepared = await prepareChatContext(
    f.target,
    f.ctx,
    undefined,
    undefined,
    reader,
  );
  assert.match(prepared.context!, /PINE-246/);
  assert.equal(prepared.sources[0].page, 2);
  const absent = createDocumentReader({
    ctx: f.ctx,
    targetId: f.target.id,
    budget: 16000,
    query: "不存在的量子鹦鹉",
    call: async () => "",
  });
  await assert.rejects(absent(f.resource, f.source.id), /未检索到/);
});
test("全文概述分析尾部；缓存按任务隔离；中止不继续请求；摘要层级合并有界", async () => {
  let calls = 0;
  const call = async () => {
    calls++;
    return "合成摘要";
  };
  await digestText("same", "task-a", call);
  await digestText("same", "task-a", call);
  await digestText("same", "task-b", call);
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    digestText("new", "task-a", call, controller.signal),
    /Aborted/,
  );
  assert.equal(calls, 2);
  const seen: string[] = [];
  const result = await reduceDigests(
    Array.from({ length: 12 }, (_, i) => `${i}`.repeat(1000)),
    3000,
    async (text) => {
      seen.push(text);
      return "摘要";
    },
  );
  assert.ok(result.length <= 3000);
  assert.ok(seen.every((text) => text.length <= 7000));
  assert.throws(() => validateAIResult("documentDigest", "x".repeat(1801)));
});
test("扫描空页不能冒充全文处理，文档超出成本保护前不请求 AI", async () => {
  const f = await fixture(["可读", ""]);
  const reader = createDocumentReader({
    ctx: f.ctx,
    targetId: f.target.id,
    budget: 16000,
    call: async () => {
      throw Error("不得调用");
    },
  });
  await assert.rejects(reader(f.resource, f.source.id), /不能作为完整正文/);
  const large = await fixture(
    Array.from({ length: 129 }, () => "文字".repeat(100)),
  );
  const bounded = createDocumentReader({
    ctx: large.ctx,
    targetId: large.target.id,
    budget: 16000,
    call: async () => {
      throw Error("不得调用");
    },
  });
  await assert.rejects(bounded(large.resource, large.source.id), /128/);
});
test("全文概述覆盖所有分段，中途取消不再消费后续段，分析范围可云端往返", async () => {
  const f = await fixture(
    Array.from(
      { length: 6 },
      (_, i) => `CHAPTER-${i + 1} ` + "合成内容 ".repeat(900),
    ),
    "chat",
  );
  const reports: DocumentReport[] = [];
  let calls = 0;
  const call = async (_action: string, payload: any) => {
    calls++;
    return payload.text.match(/CHAPTER-\d+/)?.[0] || "汇总";
  };
  const reader = createDocumentReader({
    ctx: f.ctx,
    targetId: f.target.id,
    budget: 16000,
    query: "概述全文的核心内容",
    call,
    reports,
  });
  const prepared = await prepareChatContext(
    f.target,
    f.ctx,
    undefined,
    undefined,
    reader,
  );
  assert.equal(calls, 6);
  assert.match(prepared.context!, /CHAPTER-1/);
  assert.match(prepared.context!, /CHAPTER-6/);
  f.target.data = {
    ...prepared.patch.data,
    flow: { ...prepared.patch.data!.flow!, documents: reports },
  };
  const restored = parseCloudPayload(cloudPayload(f.ctx.workspace, []));
  assert.deepEqual(
    restored.workspace.modules[1].data?.flow?.documents,
    reports,
  );
  const controller = new AbortController();
  let abortedCalls = 0;
  const abortReader = createDocumentReader({
    ctx: f.ctx,
    targetId: "different-module-cache",
    budget: 16000,
    signal: controller.signal,
    call: async () => {
      abortedCalls++;
      controller.abort();
      return "不要应用";
    },
  });
  await assert.rejects(abortReader(f.resource, f.source.id), /Aborted/);
  assert.equal(abortedCalls, 1);
});
