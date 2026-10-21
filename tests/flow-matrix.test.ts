import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { types, type ModuleType } from "../src/definitions";
import {
  outputPorts,
  inputPorts,
  directConnection,
} from "../src/connectionGraph";
import { readConnection, applyConnectedInput } from "../src/connections";
import { flowPatch } from "../src/flowData";
import { defaultCustomConfig } from "../src/customAI";
import { uid, type Mod, type Workspace, type Resource } from "../src/model";
import { ensurePdfIndex } from "../src/pdfIndex";
import { WorkspaceBus } from "../src/events";
import { prepareChatContext } from "../src/chatContext";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const node = (type: ModuleType, id: string): Mod => ({
  id,
  type,
  title: type,
  layout: { x: 0, y: 0, w: 6, h: 8 },
  ...(type === "custom-ai" ? { customConfig: defaultCustomConfig() } : {}),
});
test("全注册表兼容端口矩阵：逐一取数并写入目标，断言内容和来源收据", async () => {
  let count = 0;
  for (const fromType of types) {
    const source = node(fromType, "source"),
      token = `合成内容-${fromType}`;
    source.output = token;
    source.messages = [{ role: "assistant", content: token }];
    source.data = {
      text: token,
      transcript: token,
      url: "https://example.com/",
      cards: [{ id: "card", front: token, back: "答案" }],
      nodes: [{ id: "node", text: token, x: 0, y: 0 }],
      tasks: [{ id: "todo", text: token, done: false }],
      events: [
        { id: "event", title: token, date: "2026-10-19", time: "09:00" },
      ],
      timer: { mode: "focus", remaining: 60 },
      quiz: [
        {
          id: "q",
          type: "choice",
          question: token,
          options: ["A", "B"],
          answer: "A",
          explanation: "合成解析",
        },
      ],
      submitted: true,
      answers: { q: "A" },
    };
    const resource: Resource = {
      id: uid(),
      version: "v1",
      name: "fixture.pdf",
      file: new Blob(["synthetic"], {
        type:
          fromType === "video"
            ? "video/mp4"
            : fromType === "image"
              ? "image/png"
              : "application/pdf",
      }),
      createdAt: 0,
    };
    source.resourceId = resource.id;
    source.data!.mediaResourceId = resource.id;
    if (fromType === "pdf")
      await ensurePdfIndex(resource, {
        load: () => ({
          promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({
              getTextContent: async () => ({ items: [{ str: token }] }),
            }),
          }),
          destroy: async () => {},
        }),
      });
    for (const toType of types) {
      const target = node(toType, "target");
      for (const port of outputPorts(fromType))
        for (const field of inputPorts(target).filter((f) =>
          f.accept.includes(port),
        )) {
          const w: Workspace = {
            id: uid(),
            title: "端口矩阵",
            description: "",
            createdAt: 0,
            updatedAt: 0,
            modules: [source, target],
          };
          const edge = directConnection(
            w.modules,
            [],
            source.id,
            port,
            target.id,
            field.id,
            uid(),
            port === "note" ? "note" : undefined,
          );
          if (port === "retrieval")
            edge.source = { moduleId: source.id, port, query: token };
          if (port === "tasks") edge.source.itemId = "todo";
          w.connections = [edge];
          const selection = {
            kind: "text" as const,
            moduleId: source.id,
            resourceId: resource.id,
            version: resource.version,
            page: 1,
            text: token,
            createdAt: 0,
          };
          const ctx = {
            workspace: w,
            notes: [
              {
                id: "note",
                workspaceId: w.id,
                moduleId: source.id,
                content: token,
                sources: [],
                contentKind: "user" as const,
              },
            ],
            resources: [resource],
            selection,
          };
          const label = `${fromType}.${port} -> ${toType}.${field.id}`;
          try {
            const packet = await readConnection(edge, ctx);
            assert(packet.text.length > 0, label);
            assert.equal(packet.connection?.moduleId, source.id, label);
            const patch =
              toType === "custom-ai"
                ? applyConnectedInput(
                    target,
                    edge,
                    packet,
                    w.id,
                    undefined,
                    "null",
                  )
                : flowPatch(target, [edge], [packet], w.id, undefined, {
                    date: "2026-10-19",
                    time: "09:00",
                  }).patch;
            assert(patch.data, label);
            count++;
          } catch (error) {
            throw Error(
              `${label}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
    }
  }
  console.log(`端口矩阵验证 ${count} 种兼容组合`);
  assert(count > 200);
});
test("多来源选区按实例保留，切换焦点不丢失；作用域清空后不能复用", async () => {
  const a = node("text", "a"),
    b = node("text", "b"),
    target = node("chat", "chat");
  a.data = { text: "来源A独立片段" };
  b.data = { text: "来源B独立片段" };
  const bus = new WorkspaceBus("test");
  for (const m of [a, b]) {
    bus.emit("selection.changed", {
      moduleId: m.id,
      resourceId: m.id,
      version: "v1",
      page: 1,
      text: m.data!.text!,
      createdAt: 0,
      kind: "text",
    });
    bus.emit("selection.cleared", { moduleId: m.id });
  }
  const w: Workspace = {
    id: uid(),
    title: "合成",
    description: "",
    createdAt: 0,
    updatedAt: 0,
    modules: [a, b, target],
  };
  w.connections = [a, b].map((m) =>
    directConnection(
      w.modules,
      [],
      m.id,
      "selection",
      target.id,
      "context",
      uid(),
    ),
  );
  const ctx = {
    workspace: w,
    notes: [],
    resources: [],
    selection: bus.selection,
    selections: bus.selections,
  };
  const prepared = await prepareChatContext(target, ctx);
  assert.match(prepared.context!, /来源A/);
  assert.match(prepared.context!, /来源B/);
  bus.emit("selection.cleared", {});
  await assert.rejects(
    prepareChatContext(target, { ...ctx, selection: bus.selection }),
    /请先/,
  );
  bus.dispose();
});

test("所有标准 AI 处理入口：空输入沿线取数，编辑内容保留，变更来源和任务阻止提交", async () => {
  const { prepareLearningInput } = await import("../src/materialInput");
  const source = node("text", "source");
  source.data = { text: "联合材料 KEY-937：七轮九分钟" };
  for (const type of [
    "translate",
    "summary",
    "cards",
    "quiz",
    "mindmap",
  ] as const) {
    const target = node(type, "target");
    const w: Workspace = {
      id: uid(),
      title: "合成执行",
      description: "",
      createdAt: 0,
      updatedAt: 0,
      modules: [source, target],
    };
    w.connections = [
      directConnection(
        w.modules,
        [],
        source.id,
        "text",
        target.id,
        "input",
        uid(),
      ),
    ];
    const ctx = { workspace: w, notes: [], resources: [], selection: null };
    const prepared = await prepareLearningInput(target, ctx);
    assert.match(prepared.material.input!, /KEY-937/);
    assert.equal(
      prepared.patch?.data?.flow?.inputs[0].connection?.moduleId,
      source.id,
    );
    prepared.assertCurrent(ctx);
    assert.throws(
      () =>
        prepared.assertCurrent({
          ...ctx,
          workspace: { ...w, activeTaskId: "other" },
        }),
      /任务或连接/,
    );
    const edited = await prepareLearningInput(
      { ...prepared.material, input: "用户编辑后的材料" },
      ctx,
    );
    assert.equal(edited.material.input, "用户编辑后的材料");
    assert.equal(edited.patch, undefined);
  }
});
