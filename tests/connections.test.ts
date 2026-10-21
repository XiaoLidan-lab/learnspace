import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  fromTemplate,
  builtins,
  uid,
  type Note,
  type Resource,
} from "../src/model";
import { defaultCustomConfig, customRunSchema } from "../src/customAI";
import {
  connectionError,
  readConnection,
  upstreamVersion,
  applyConnectedInput,
  type Connection,
} from "../src/connections";
import {
  addTask,
  taskFromPlan,
  projectWorkspace,
  scopedNotes,
  updateModule,
  changeStructure,
  reuseTaskContent,
} from "../src/tasks";
import { cloudPayload, cloudCopy, parseCloudPayload } from "../src/cloudData";
import { store } from "../src/storage";
import { ensurePdfIndex } from "../src/pdfIndex";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
function fixture() {
  const w = fromTemplate(builtins[0]);
  w.modules = w.modules.slice(0, 3);
  const [target, text, note] = w.modules;
  target.type = "custom-ai";
  target.customConfig = defaultCustomConfig();
  text.type = "text";
  text.data = { text: "ALPHA amber light" };
  note.type = "note";
  const edge: Connection = {
    id: uid(),
    source: { moduleId: text.id, port: "text" },
    target: { moduleId: target.id, field: "paper" },
    trigger: "manual",
    mode: "replace",
  };
  w.connections = [edge];
  return { w, target, text, note, edge };
}
test("连接类型、唯一输入、具体篇目、检索条件、端点与依赖环校验", () => {
  const { w, target, text, note, edge } = fixture();
  assert.equal(connectionError(w.modules, [edge]), undefined);
  assert.match(
    connectionError(w.modules, [edge, { ...edge, id: uid() }])!,
    /重复/,
  );
  assert.match(
    connectionError(w.modules, [
      { ...edge, source: { moduleId: text.id, port: "output" } },
    ])!,
    /类型/,
  );
  assert.match(
    connectionError(w.modules, [
      { ...edge, source: { moduleId: note.id, port: "note" } },
    ])!,
    /篇目/,
  );
  assert.match(
    connectionError(w.modules, [
      { ...edge, source: { moduleId: "gone", port: "text" } },
    ])!,
    /端点/,
  );
  text.type = "custom-ai";
  text.customConfig = defaultCustomConfig();
  const forward = {
    ...edge,
    source: { moduleId: text.id, port: "output" as const },
  };
  assert.match(
    connectionError(w.modules, [
      forward,
      {
        ...edge,
        id: uid(),
        source: { moduleId: target.id, port: "output" },
        target: { moduleId: text.id, field: "paper" },
      },
    ])!,
    /环/,
  );
  text.type = "pdf";
  assert.match(
    connectionError(w.modules, [
      { ...edge, source: { moduleId: text.id, port: "retrieval" } },
    ])!,
    /关键词/,
  );
});
test("获取不覆盖输入，确认时保护编辑、作用域、大小；上游版本变化可发现", async () => {
  const { w, target, text, edge } = fixture();
  const ctx = { workspace: w, notes: [], resources: [], selection: null };
  const input = await readConnection(edge, ctx);
  assert.equal(input.kind, "user");
  assert.equal(target.data?.custom, undefined);
  const version = input.connection!.version;
  text.data!.text = "changed";
  assert.notEqual(upstreamVersion(edge, ctx), version);
  const patch = applyConnectedInput(
    target,
    edge,
    input,
    w.id,
    undefined,
    "null",
  );
  assert.equal(patch.data!.custom!.inputs.paper.text, "ALPHA amber light");
  assert.throws(
    () =>
      applyConnectedInput(target, edge, input, w.id, "another-task", "null"),
    /作用域/,
  );
  target.data = patch.data;
  target.data!.custom!.inputs.paper.text = "user edit";
  assert.throws(
    () => applyConnectedInput(target, edge, input, w.id, undefined, "null"),
    /已被编辑/,
  );
  text.data!.text = "x".repeat(8001);
  await assert.rejects(readConnection(edge, ctx), /8000/);
});
test("指定笔记不会因当前篇目变化而读错；跨任务、缺失篇目不能回退", async () => {
  let { w, target, note, edge } = fixture();
  const a = taskFromPlan(
    {
      goal: "A",
      steps: [
        {
          title: "read",
          description: "read",
          moduleTypes: ["note", "custom-ai"],
        },
      ],
      outcomes: [],
      layoutReason: "合成验收布局",
    },
    w.modules,
  );
  w = addTask(w, a);
  const n: Note = {
    id: uid(),
    moduleId: note.id,
    workspaceId: w.id,
    taskId: a.id,
    content: "exact A",
    contentKind: "mixed",
    sources: [],
  };
  const other = { ...n, id: uid(), content: "wrong note" };
  edge = { ...edge, source: { moduleId: note.id, port: "note", noteId: n.id } };
  w.connections = [edge];
  let projected = projectWorkspace(
    updateModule(w, note.id, { activeNoteId: other.id }),
  );
  const read = await readConnection(edge, {
    workspace: projected,
    notes: [n, other],
    resources: [],
    selection: null,
  });
  assert.equal(read.text, n.content);
  assert.equal(read.sources[0].noteId, n.id);
  assert.equal(read.kind, "mixed");
  const b = taskFromPlan({ ...a.plan!, goal: "B" }, w.modules);
  w = addTask(w, b);
  await assert.rejects(
    readConnection(edge, {
      workspace: projectWorkspace(w),
      notes: [n, other],
      resources: [],
      selection: null,
    }),
    /当前任务/,
  );
  await assert.rejects(
    readConnection(edge, {
      workspace: projected,
      notes: [other],
      resources: [],
      selection: null,
    }),
    /指定笔记/,
  );
});
test("PDF 只接受匹配模块和文件版本的选区；检索只提供相关页并保留来源", async () => {
  const { w, text, edge } = fixture();
  text.type = "pdf";
  text.resourceId = uid();
  const r: Resource = {
    id: text.resourceId,
    name: "Synthetic PDF",
    createdAt: 1,
    version: "v1",
    file: new File(["synthetic"], "synthetic.pdf", { type: "application/pdf" }),
  };
  const ctx = { workspace: w, notes: [], resources: [r], selection: null };
  const selected = {
    ...edge,
    source: { moduleId: text.id, port: "selection" as const },
  };
  await assert.rejects(readConnection(selected, ctx), /先在指定/);
  const selection = {
    kind: "pdf" as const,
    moduleId: text.id,
    resourceId: r.id,
    version: r.version,
    page: 2,
    text: "ALPHA amber",
    createdAt: 1,
  };
  assert.equal(
    (await readConnection(selected, { ...ctx, selection })).sources[0].page,
    2,
  );
  await assert.rejects(
    readConnection(selected, {
      ...ctx,
      selection: { ...selection, version: "old" },
    }),
    /选择/,
  );
  await ensurePdfIndex(r, {
    load: () => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: async (page) => ({
          getTextContent: async () => ({
            items: [
              {
                str:
                  page === 3
                    ? "ALPHA amber light evidence"
                    : "unrelated introduction",
              },
            ],
          }),
        }),
      }),
      destroy: async () => {},
    }),
  });
  const retrieve = {
    ...edge,
    source: { moduleId: text.id, port: "retrieval" as const, query: "ALPHA" },
  };
  const result = await readConnection(retrieve, ctx);
  assert.equal(result.sources[0].page, 3);
  assert(!result.text.includes("unrelated"));
  assert.equal(result.kind, "original");
  await assert.rejects(
    readConnection(
      { ...retrieve, source: { ...retrieve.source, query: "zzzznotfound" } },
      ctx,
    ),
    /无相关/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readConnection(retrieve, ctx, abort.signal), {
    name: "AbortError",
  });
});
test("连接及输入/运行快照本地与云端兼容；另存副本重映射篇目与归属，删除模块清理连接", async () => {
  const { w, target, note, edge } = fixture();
  const n: Note = {
    id: uid(),
    moduleId: note.id,
    workspaceId: w.id,
    content: "exact",
    sources: [],
    contentKind: "user",
  };
  w.connections = [
    { ...edge, source: { moduleId: note.id, port: "note", noteId: n.id } },
  ];
  const input = await readConnection(w.connections[0], {
    workspace: w,
    notes: [n],
    resources: [],
    selection: null,
  });
  target.data = {
    custom: {
      inputs: {
        paper: input,
        question: { text: "Q", kind: "user", sources: [] },
      },
      runs: [],
    },
  };
  const run = customRunSchema.parse({
    id: uid(),
    workspaceId: w.id,
    moduleId: target.id,
    config: target.customConfig,
    inputs: target.data.custom!.inputs,
    startedAt: 1,
    finishedAt: 2,
    status: "succeeded",
    result: { text: "Answer [S1]", citations: ["S1"] },
  });
  target.data.custom!.runs = [run];
  await store.saveInstallation(w, [n], []);
  assert.equal(
    (await store.workspaces()).find((x) => x.id === w.id)?.connections?.length,
    1,
  );
  const payload = cloudPayload(w, [n]),
    copy = cloudCopy(payload);
  assert.doesNotThrow(() => cloudPayload(copy.workspace, copy.notes));
  assert.equal(copy.workspace.connections![0].source.noteId, copy.notes[0].id);
  const copied = copy.workspace.modules[0].data!.custom!;
  assert.equal(copied.inputs.paper.connection!.workspaceId, copy.workspace.id);
  assert.equal(copied.runs[0].inputs.paper.sources[0].noteId, copy.notes[0].id);
  const bad = structuredClone(payload);
  bad.workspace.modules[0].data!.custom!.inputs.paper.connection!.taskId =
    "other";
  assert.throws(() => parseCloudPayload(bad), /归属/);
  assert.equal(
    changeStructure(
      w,
      w.modules.filter((m) => m.id !== note.id),
    ).connections!.length,
    0,
  );
});

test("主动跨任务复用连接输入保留内容但解除旧取数绑定，不会污染快照归属", async () => {
  let { w, target, edge } = fixture();
  const plan = {
    goal: "A",
    steps: [
      {
        title: "read",
        description: "read",
        moduleTypes: ["custom-ai" as const],
      },
    ],
    outcomes: [],
    layoutReason: "合成验收布局",
  };
  const a = taskFromPlan(plan, w.modules);
  w = addTask(w, a);
  w = updateModule(w, edge.source.moduleId, {
    data: { text: "ALPHA amber light" },
  });
  const input = await readConnection(edge, {
    workspace: projectWorkspace(w),
    notes: [],
    resources: [],
    selection: null,
  });
  w = updateModule(w, target.id, {
    data: { custom: { inputs: { paper: input }, runs: [] } },
  });
  const b = taskFromPlan({ ...plan, goal: "B" }, w.modules);
  w = addTask(w, b);
  const copy = reuseTaskContent(w, [], a.id);
  const copied = projectWorkspace(copy.workspace).modules[0].data!.custom!
    .inputs.paper;
  assert.equal(copied.text, input.text);
  assert.equal(copied.connection, undefined);
  assert.doesNotThrow(() => cloudPayload(copy.workspace, copy.notes));
});

test("摘要输出保留 AI 类型，不把后来更换的输入来源错误归给旧输出", async () => {
  const { w, text, edge } = fixture();
  text.type = "summary";
  text.output = "Old AI answer";
  text.source = {
    kind: "pdf",
    resourceId: uid(),
    version: "new-input",
    page: 7,
    text: "unrelated new material",
  };
  const input = await readConnection(
    { ...edge, source: { moduleId: text.id, port: "output" } },
    { workspace: w, notes: [], resources: [], selection: null },
  );
  assert.equal(input.kind, "ai");
  assert.equal(input.sources.length, 1);
  assert.equal(input.sources[0].moduleId, text.id);
  assert.equal(input.sources[0].contentKind, "ai");
});
