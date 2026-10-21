import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { prepareChatContext } from "../src/chatContext";
import { directConnection } from "../src/connectionGraph";
import { chatProviderMessages } from "../server/api";
import type { Mod, Workspace } from "../src/model";
const source: Mod = {
  id: "source",
  type: "text",
  title: "合成参考",
  layout: { x: 0, y: 0, w: 6, h: 8 },
  data: { text: "合成实验：青鸟项目采用七轮复习，每轮九分钟。" },
};
const chat: Mod = {
  id: "chat",
  type: "chat",
  title: "问答",
  layout: { x: 6, y: 0, w: 6, h: 8 },
  input: "需要复习几轮？",
};
const edge = directConnection(
  [source, chat],
  [],
  source.id,
  "selection",
  chat.id,
  "context",
  "edge",
);
const workspace: Workspace = {
  id: "workspace",
  title: "合成验收",
  description: "",
  createdAt: 0,
  updatedAt: 0,
  modules: [source, chat],
  connections: [edge],
};
const ctx = () => ({
  workspace: structuredClone(workspace),
  notes: [],
  resources: [],
  selection: {
    kind: "text" as const,
    moduleId: source.id,
    resourceId: source.id,
    version: "v1",
    text: source.data!.text!,
    createdAt: 1,
    page: 1,
  },
});
test("沿连线读取选中片段，问题保持独立，来源和快照进入模型上下文", async () => {
  const c = ctx();
  const prepared = await prepareChatContext(chat, c);
  assert.match(prepared.context!, /七轮复习/);
  assert.equal(prepared.patch.input, undefined);
  assert.equal(prepared.patch.data?.flow?.inputs[0].connection?.id, "edge");
  assert.equal(prepared.sources[0].moduleId, source.id);
  const messages = chatProviderMessages(
    {
      messages: [{ role: "user", content: chat.input! }],
      context: prepared.context,
    },
    "学习助手",
  );
  assert.equal(messages.at(-1)?.content, chat.input);
  assert.match(messages[1].content, /七轮复习/);
  assert(!messages.at(-1)?.content.includes('"messages"'));
  prepared.assertCurrent(c);
  const changed = ctx();
  changed.workspace.activeTaskId = "another-task";
  assert.throws(() => prepared.assertCurrent(changed), /任务或连接/);
  const changedSource = ctx();
  changedSource.selection.text = "新的选区";
  assert.throws(() => prepared.assertCurrent(changedSource));
});
test("空选区、错误实例、删除连接、来源变化均不能静默沿用旧内容", async () => {
  const c = ctx();
  await assert.rejects(
    prepareChatContext(chat, { ...c, selection: null }),
    /请先/,
  );
  await assert.rejects(
    prepareChatContext(chat, {
      ...c,
      selection: { ...c.selection, moduleId: "unrelated" },
    }),
    /请先/,
  );
  const prepared = await prepareChatContext(chat, c);
  const removed = ctx();
  removed.workspace.connections = [];
  assert.throws(() => prepared.assertCurrent(removed), /连接/);
});
test("多个来源全部组装；移除连接后不使用遗留快照；独立问答仍可使用", async () => {
  const c = ctx();
  const other: Mod = {
    ...source,
    id: "other",
    data: { text: "第二份材料：测试代号为绿色。" },
  };
  c.workspace.modules.push(other);
  c.workspace.connections!.push(
    directConnection(
      c.workspace.modules,
      c.workspace.connections!,
      other.id,
      "text",
      chat.id,
      "context",
      "second",
    ),
  );
  const prepared = await prepareChatContext(chat, c);
  assert.match(prepared.context!, /绿色/);
  assert.match(prepared.context!, /七轮/);
  c.workspace.connections = [];
  const free = await prepareChatContext({ ...chat, ...prepared.patch }, c);
  assert.equal(free.context, undefined);
});

test("PDF 连线只读取对应文件的选区并保留页码，替换文件后拒绝旧选区", async () => {
  const c = ctx();
  c.workspace.modules[0] = { ...source, type: "pdf", resourceId: "pdf-file" };
  const resource = {
    id: "pdf-file",
    name: "合成资料.pdf",
    file: new Blob(["synthetic"], {type:"application/pdf"}),
    version: "pdf-v1",
    type: "application/pdf",
    size: 100,
    createdAt: 0,
  };
  const pdfContext = {
    ...c,
    resources: [resource],
    selection: {
      ...c.selection,
      kind: "pdf" as const,
      resourceId: resource.id,
      resourceName: resource.name,
      version: resource.version,
      page: 7,
    },
  };
  const prepared = await prepareChatContext(chat, pdfContext);
  assert.equal(prepared.sources[0].page, 7);
  assert.equal(prepared.sources[0].contentKind, "original");
  assert.match(prepared.context!, /定位 7/);
  await assert.rejects(
    prepareChatContext(chat, {
      ...pdfContext,
      resources: [{ ...resource, version: "pdf-v2" }],
    }),
    /请先/,
  );
});
