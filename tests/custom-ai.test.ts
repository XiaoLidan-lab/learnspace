import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  defaultCustomConfig,
  customStateKey,
  customConfigSchema,
  customRequestSchema,
  customRunSchema,
  renderCustomPrompt,
  validateCustomResult,
  completeCustomRun,
  type CustomRun,
} from "../src/customAI";
import { fromTemplate, builtins, uid } from "../src/model";
import {
  addTask,
  taskFromPlan,
  updateModule,
  projectWorkspace,
  artifactCandidates,
  linkArtifact,
  reuseTaskContent,
} from "../src/tasks";
import { cloudPayload, cloudCopy, parseCloudPayload } from "../src/cloudData";
import { store } from "../src/storage";
import { createApp } from "./helpers/aiApp";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const inputs = {
  paper: {
    text: "Synthetic protein ZXQ operates only in alkaline water.",
    kind: "user" as const,
    sources: [],
  },
  question: {
    text: "Where does ZXQ operate?",
    kind: "user" as const,
    sources: [],
  },
};
function setup() {
  let w = fromTemplate(builtins[0]);
  const m = w.modules[0];
  m.type = "custom-ai";
  m.customConfig = defaultCustomConfig();
  const a = taskFromPlan(
    {
      goal: "A",
      steps: [
        {
          title: "解释",
          description: "解释合成资料",
          moduleTypes: ["custom-ai"],
        },
      ],
      layoutReason: "test",
    },
    w.modules,
  );
  w = addTask(w, a);
  return { w, m, a };
}
function run(w: ReturnType<typeof setup>["w"], moduleId: string): CustomRun {
  return {
    id: uid(),
    workspaceId: w.id,
    moduleId,
    taskId: w.activeTaskId,
    config: defaultCustomConfig(),
    inputs: structuredClone(inputs),
    status: "running",
    startedAt: 1,
  };
}
test("多个命名输入受控替换：拒绝重名、未知字段、表达式、缺失必填与过大内容，字段值不递归解释", () => {
  const config = defaultCustomConfig();
  assert(customRequestSchema.safeParse({ config, inputs }).success);
  assert.match(renderCustomPrompt({ config, inputs }), /Where does ZXQ/);
  assert(
    !customConfigSchema.safeParse({
      ...config,
      fields: [config.fields[0], config.fields[0]],
    }).success,
  );
  for (const prompt of [
    "{{secret}}",
    "{{paper.toString()}}",
    "{{paper",
    "${process.env.KEY}",
  ])
    assert(!customConfigSchema.safeParse({ ...config, prompt }).success);
  assert(
    !customRequestSchema.safeParse({ config, inputs: { paper: inputs.paper } })
      .success,
  );
  assert(
    !customRequestSchema.safeParse({
      config,
      inputs: { ...inputs, secret: inputs.paper },
    }).success,
  );
  assert(
    !customRequestSchema.safeParse({
      config,
      inputs: { ...inputs, paper: { ...inputs.paper, text: "x".repeat(8001) } },
    }).success,
  );
  assert(
    renderCustomPrompt({
      config,
      inputs: { ...inputs, paper: { ...inputs.paper, text: "{{question}}" } },
    }).includes("资料：{{question}}"),
  );
});
test("来源白名单与内容类型：手动输入不能产生文献引用，编辑保留来源不冒充原文", () => {
  const config = defaultCustomConfig();
  assert.throws(() =>
    validateCustomResult(
      { text: "answer [S1]", citations: ["S1"] },
      { config, inputs },
    ),
  );
  const source = {
    resourceId: "pdf",
    version: "v1",
    page: 24,
    text: "original",
    kind: "pdf" as const,
    moduleId: "pdf-module",
  };
  const request = {
    config,
    inputs: {
      ...inputs,
      paper: {
        text: "edited paraphrase",
        kind: "mixed" as const,
        sources: [source],
      },
    },
  };
  assert.equal(
    validateCustomResult({ text: "answer [S1]", citations: ["S1"] }, request)
      .citations[0],
    "S1",
  );
  assert.throws(() =>
    validateCustomResult({ text: "answer [S1]", citations: [] }, request),
  );
  assert.throws(() =>
    validateCustomResult(
      { text: "answer", citations: [], execute: true },
      request,
    ),
  );
});
test("配置共享但任务输入、运行、输出和成果隔离；迟到响应只应用到仍运行的原记录", () => {
  let { w, m, a } = setup();
  const pending = run(w, m.id);
  w = updateModule(w, m.id, { data: { custom: { inputs, runs: [pending] } } });
  const b = taskFromPlan(
    {
      goal: "B",
      steps: [{ title: "独立", description: "B", moduleTypes: ["custom-ai"] }],
      layoutReason: "test",
    },
    w.modules,
  );
  w = addTask(w, b);
  assert.equal(
    projectWorkspace(w).modules[0].customConfig?.name,
    m.customConfig!.name,
  );
  assert.equal(projectWorkspace(w).modules[0].data, undefined);
  const am = projectWorkspace({ ...w, activeTaskId: a.id }).modules[0];
  w = updateModule(
    w,
    m.id,
    completeCustomRun(am, pending.id, {
      status: "succeeded",
      finishedAt: 2,
      result: { text: "A answer", citations: [] },
    }),
    a.id,
  );
  assert.equal(projectWorkspace(w).modules[0].output, undefined);
  const restored = projectWorkspace({ ...w, activeTaskId: a.id });
  assert.equal(restored.modules[0].output, "A answer");
  assert.deepEqual(
    completeCustomRun(restored.modules[0], pending.id, {
      status: "failed",
      finishedAt: 3,
      error: "late",
    }),
    {},
  );
  const candidate = artifactCandidates(restored, []).find(
    (c) => c.kind === "custom",
  )!;
  assert.equal(candidate.contentKind, "ai");
  const linked = linkArtifact(
    { ...w.tasks![0], status: "active" },
    candidate,
    a.steps[0].id,
  );
  assert.equal(linked.artifacts[0].snapshot, "A answer");
  const reused = reuseTaskContent(w, [], a.id).workspace;
  assert.equal(
    projectWorkspace(reused).modules[0].data?.custom?.runs.length,
    0,
  );
  assert.equal(projectWorkspace(reused).modules[0].output, undefined);
});
test("失败、取消、配置变更后保留旧成功快照；记录经过本地和云端恢复、独立副本重映射", async () => {
  let { w, m, a } = setup();
  let pending = run(w, m.id);
  let success = {
    ...pending,
    status: "succeeded" as const,
    finishedAt: 2,
    result: { text: "original answer", citations: [] },
  };
  w = updateModule(w, m.id, {
    output: success.result.text,
    data: { custom: { inputs, runs: [success] } },
  });
  pending = { ...run(w, m.id), retryOf: success.id };
  w = updateModule(w, m.id, {
    data: { custom: { inputs, runs: [success, pending] } },
  });
  w = updateModule(
    w,
    m.id,
    completeCustomRun(projectWorkspace(w).modules[0], pending.id, {
      status: "failed",
      finishedAt: 3,
      error: "synthetic timeout",
    }),
  );
  w.modules[0].customConfig = {
    ...m.customConfig!,
    name: "updated",
    version: 2,
  };
  assert.equal(projectWorkspace(w).modules[0].output, "original answer");
  await store.saveSnapshot([w], []);
  const reloaded = (await store.workspaces()).find((x) => x.id === w.id)!;
  const payload = cloudPayload(reloaded, []),
    copy = cloudCopy(payload);
  assert.equal(
    copy.workspace.tasks![0].moduleStates![m.id].data!.custom!.runs[0].config
      .version,
    1,
  );
  assert.equal(copy.workspace.modules[0].customConfig!.version, 2);
  assert.equal(
    copy.workspace.tasks![0].moduleStates![m.id].data!.custom!.runs[1].retryOf,
    success.id,
  );
  assert.equal(
    copy.workspace.tasks![0].moduleStates![m.id].data!.custom!.runs[0]
      .workspaceId,
    copy.workspace.id,
  );
  assert.doesNotThrow(() => cloudPayload(copy.workspace, copy.notes));
  const wrong = structuredClone(payload);
  wrong.workspace.tasks![0].moduleStates![m.id].data!.custom!.runs[0].taskId =
    "another-task";
  assert.throws(() => parseCloudPayload(wrong));
  assert(!customRunSchema.safeParse({ ...success, result: undefined }).success);
  assert(
    !customRunSchema.safeParse({
      ...pending,
      status: "cancelled",
      result: success.result,
      finishedAt: 3,
    }).success,
  );
});
test("连接基础只接受有效端点、唯一目标和无环关系；旧 V1 工作台不要求新增字段", () => {
  const { w, m } = setup();
  const old = fromTemplate(builtins[0]);
  assert.doesNotThrow(() => cloudPayload(old, []));
  const text = w.modules[1];
  text.type = "text";
  w.connections = [
    {
      id: "edge",
      source: { moduleId: text.id, port: "text" },
      target: { moduleId: m.id, field: "paper" },
      trigger: "manual",
      mode: "replace",
    },
  ];
  assert.doesNotThrow(() => cloudPayload(w, []));
  w.connections.push({ ...w.connections[0], id: "duplicate" });
  assert.throws(() => cloudPayload(w, []));
  w.connections.pop();
  w.connections[0].target.field = "missing";
  assert.throws(() => cloudPayload(w, []));
  w.connections[0].target.field = "paper";
  w.connections[0].source.moduleId = m.id;
  assert.throws(() => cloudPayload(w, []));
});
test("自定义 AI HTTP 沿用鉴权和结构校验；模型伪造来源、非法配置不会成为结果", async () => {
  let output: unknown = { text: "synthetic answer", citations: [] },
    calls = 0;
  const app = createApp({
    authenticate: async () => "synthetic",
    complete: async (action, payload, instructions) => {
      calls++;
      assert.equal(action, "custom");
      assert(instructions.includes("不执行代码"));
      assert((payload as any).config.fields.length === 3);
      return JSON.stringify(output);
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r, j) => {
    server.once("listening", r);
    server.once("error", j);
  });
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/ai`;
  const post = (payload: unknown, auth = true) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: "Bearer synthetic" } : {}),
      },
      body: JSON.stringify({ action: "custom", payload }),
    });
  try {
    assert.equal(
      (await post({ config: defaultCustomConfig(), inputs }, false)).status,
      401,
    );
    assert.equal(
      (await post({ config: defaultCustomConfig(), inputs })).status,
      200,
    );
    output = { text: "forged [S9]", citations: ["S9"] };
    assert.equal(
      (await post({ config: defaultCustomConfig(), inputs })).status,
      502,
    );
    const before = calls;
    assert.equal(
      (
        await post({
          config: { ...defaultCustomConfig(), prompt: "{{secret}}" },
          inputs,
        })
      ).status,
      400,
    );
    assert.equal(calls, before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("输入属性顺序不应误报历史结果过期；内容变化仍可识别", () => {
  const config = defaultCustomConfig();
  const a = { paper: { text: "same", kind: "user" as const, sources: [] } };
  const b = { paper: { sources: [], kind: "user" as const, text: "same" } };
  assert.equal(customStateKey(config, a), customStateKey(config, b));
  assert.notEqual(
    customStateKey(config, a),
    customStateKey(config, { paper: { ...a.paper, text: "changed" } }),
  );
});
