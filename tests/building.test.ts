import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createApp, guidance } from "./helpers/aiApp";
import { defaultCustomConfig } from "../src/customAI";
import { validateLayoutPlan, installedPlanning } from "../src/layoutPlan";
import { addDraftModule, removeDraftModule } from "../src/buildingDraft";
import { fromTemplate, safeTemplate, uid } from "../src/model";
import {
  addTask,
  taskFromPlan,
  projectWorkspace,
  activateTask,
  updateModule,
} from "../src/tasks";
import { cloudPayload, parseCloudPayload } from "../src/cloudData";
import { store } from "../src/storage";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
export function buildFixture() {
  return {
    version: 2 as const,
    title: "合成AI搭建验收",
    description: "配置草案，待用户确认",
    modules: [
      {
        instanceId: "m1",
        type: "pdf" as const,
        title: "资料",
        layout: { x: 0, y: 0, w: 6, h: 8 },
      },
      {
        instanceId: "m2",
        type: "note" as const,
        title: "笔记",
        layout: { x: 6, y: 0, w: 6, h: 8 },
      },
      {
        instanceId: "m3",
        type: "custom-ai" as const,
        title: "专属分析",
        layout: { x: 0, y: 8, w: 6, h: 8 },
        customConfig: defaultCustomConfig(),
      },
    ],
    connections: [
      {
        id: "c1",
        source: {
          moduleId: "m1",
          port: "retrieval" as const,
          needsBinding: true as const,
        },
        target: { moduleId: "m3", field: "paper" },
        trigger: "manual" as const,
        mode: "replace" as const,
      },
    ],
    planning: {
      goal: "解释合成资料中的概念",
      outcomes: ["带来源的解释"],
      steps: [
        {
          title: "阅读与解释",
          description: "导入资料，获取输入，再手动运行",
          moduleTypes: ["pdf" as const, "custom-ai" as const],
        },
      ],
      moduleRoles: [
        { moduleId: "m1", purpose: "提供资料" },
        { moduleId: "m2", purpose: "记录经过核验的思考" },
        { moduleId: "m3", purpose: "基于问题解释概念" },
      ],
      layoutReason: "双栏分离输入输出",
    },
  };
}
test("AI草案仅修正几何，不修补私有数据、虚构端口、缺失职责或非法Prompt", () => {
  const f = buildFixture();
  assert.equal(validateLayoutPlan(f).version, 2);
  const overlap = structuredClone(f);
  overlap.modules[1].layout = { ...overlap.modules[0].layout };
  assert(validateLayoutPlan(overlap).planning.layoutReason.includes("校正"));
  const publicFlag = structuredClone(f) as any;
  publicFlag.modules[0].type = "text";
  publicFlag.planning.steps[0].moduleTypes = ["text", "custom-ai"];
  publicFlag.connections[0].source.port = "text";
  publicFlag.connections[0].source.needsBinding = false;
  assert.equal(
    validateLayoutPlan(publicFlag).connections![0].source.needsBinding,
    undefined,
  );
  assert.equal(publicFlag.connections[0].source.needsBinding, false);
  const bad = [
    {
      ...f,
      connections: [
        {
          ...f.connections[0],
          source: { ...f.connections[0].source, needsBinding: false },
        },
      ],
    },
    {
      ...f,
      connections: [
        { ...f.connections[0], source: { moduleId: "m99", port: "text" } },
      ],
    },
    {
      ...f,
      connections: [
        { ...f.connections[0], source: { moduleId: "m1", port: "output" } },
      ],
    },
    {
      ...f,
      connections: [
        {
          ...f.connections[0],
          source: { ...f.connections[0].source, query: "private" },
        },
      ],
    },
    { ...f, planning: { ...f.planning, moduleRoles: [] } },
    {
      ...f,
      modules: f.modules.map((m) =>
        m.customConfig
          ? {
              ...m,
              customConfig: { ...m.customConfig, prompt: "{{undeclared}}" },
            }
          : m,
      ),
    },
  ];
  for (const value of bad) assert.throws(() => validateLayoutPlan(value));
});
test("草案增删、连接清理与确认安装重映射；配置、任务隔离和运行快照兼容", async () => {
  const { planning, ...t } = validateLayoutPlan(buildFixture());
  const original = JSON.stringify(t);
  const added = addDraftModule(t, planning, "text");
  assert.equal(added.template.modules.at(-1)?.instanceId, "m4");
  const removed = removeDraftModule(t, planning, 0);
  assert.equal(removed.template.connections!.length, 0);
  assert.equal(removed.plan.moduleRoles!.length, 2);
  assert.equal(JSON.stringify(t), original);
  const w0 = fromTemplate(t),
    plan = installedPlanning(planning, t, w0.modules);
  assert.equal(plan.moduleRoles![0].moduleId, w0.modules[0].id);
  let w = addTask(w0, taskFromPlan(plan, w0.modules));
  const a = w.activeTaskId!;
  const b = taskFromPlan(plan, w.modules);
  w = addTask(w, b);
  w = updateModule(w, w.modules[2].id, { input: "TASK-B" });
  w = activateTask(w, a);
  assert(!projectWorkspace(w).modules[2].input);
  w = activateTask(w, b.id);
  assert.equal(projectWorkspace(w).modules[2].input, "TASK-B");
  await store.saveInstallation(w, [], []);
  assert.deepEqual(
    (await store.workspaces()).find((x) => x.id === w.id)?.connections,
    w.connections,
  );
  assert.deepEqual(
    parseCloudPayload(cloudPayload(w, [])).workspace.tasks![0].plan!
      .moduleRoles,
    plan.moduleRoles,
  );
  const copy = fromTemplate(safeTemplate(w));
  assert.notEqual(copy.modules[0].id, w.modules[0].id);
  assert.equal(copy.connections![0].source.moduleId, copy.modules[0].id);
  assert(!copy.tasks);
  assert(!copy.modules[2].input);
});
test("AI组合HTTP复用认证、注册端口与严格输出校验；无效输出不创建记录", async () => {
  let result: any = buildFixture(),
    instructions = "";
  const app = createApp({
    authenticate: async (t) => (t === "test" ? "isolated-test" : null),
    complete: async (_a, _p, i) => {
      instructions = i;
      return JSON.stringify(result);
    },
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/ai`;
  const post = (payload: unknown, token = "test") =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "layout", payload }),
    });
  try {
    assert.equal(
      (
        await post(
          { request: "合成验收", mode: "combination", includeCustom: true },
          "bad",
        )
      ).status,
      401,
    );
    const ok = await post({
      request: "合成验收",
      mode: "combination",
      includeCustom: true,
    });
    assert.equal(ok.status, 200);
    assert.equal(
      (await ok.json()).result.connections[0].source.needsBinding,
      true,
    );
    assert(
      instructions.includes(
        '"outputPorts":["selection","retrieval","document"]',
      ),
    );
    assert(instructions.includes("不运行模块"));
    result = {
      ...buildFixture(),
      connections: [
        {
          ...buildFixture().connections[0],
          target: { moduleId: "unknown", field: "paper" },
        },
      ],
    };
    assert.equal(
      (
        await post({
          request: "合成验收",
          mode: "combination",
          includeCustom: true,
        })
      ).status,
      502,
    );
    result = {
      version: 1,
      title: "legacy",
      description: "",
      modules: [
        { type: "note", title: "笔记", layout: { x: 0, y: 0, w: 6, h: 6 } },
      ],
      planning: {
        goal: "保留V1",
        steps: [
          { title: "记录", description: "记录要点", moduleTypes: ["note"] },
        ],
        layoutReason: "简单布局",
      },
    };
    assert.equal((await post({ request: "旧版布局" })).status, 200);
    assert.equal(
      (
        await post({
          request: "组合推荐",
          mode: "combination",
          includeCustom: true,
        })
      ).status,
      502,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("AI搭建仅修正一次：保留目标、严格拒绝无效连接、不记录或应用失败草案", async () => {
  let responses: (string | Error)[] = [],
    calls: unknown[] = [];
  const app = createApp({
    authenticate: async () => "repair-isolated-test",
    complete: async (_action, payload, instructions) => {
      calls.push({ payload, instructions });
      const response = responses.shift()!;
      if (response instanceof Error) throw response;
      return response;
    },
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const post = () =>
    fetch(`http://127.0.0.1:${(server.address() as any).port}/api/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify({
        action: "layout",
        payload: {
          request: "我想要学习大模型算法",
          mode: "combination",
          includeCustom: true,
        },
      }),
    });
  const good = JSON.stringify(buildFixture());
  const invalid = buildFixture();
  invalid.connections[0].target.moduleId = "missing";
  try {
    responses = [good];
    assert.equal((await post()).status, 200);
    assert.equal(calls.length, 1, "有效方案不能额外调用模型");
    calls = [];
    responses = [JSON.stringify(invalid), good];
    assert.equal((await post()).status, 200);
    assert.equal(calls.length, 2);
    const retry = calls[1] as any;
    assert.equal(retry.payload.request, "我想要学习大模型算法");
    assert(
      retry.payload.repair.issues.some((i: any) =>
        i.message.includes("端点无效"),
      ),
    );
    assert(retry.instructions.includes("不可信"));
    calls = [];
    const unsupported = {
      ...buildFixture(),
      modules: buildFixture().modules.map((m) => ({
        ...m,
        settings: { inventedOption: "not supported" },
      })),
    };
    responses = [JSON.stringify(unsupported), good];
    assert.equal((await post()).status, 200);
    assert(
      (calls[1] as any).payload.repair.issues.some((i: any) =>
        i.message.includes("省略 settings"),
      ),
    );
    calls = [];
    responses = ["{broken", good];
    assert.equal((await post()).status, 200);
    assert.equal(calls.length, 2);
    calls = [];
    responses = [JSON.stringify(invalid), JSON.stringify(invalid), good];
    const failed = await post();
    assert.equal(failed.status, 502);
    assert.equal(calls.length, 2, "禁止无限重试");
    const body = await failed.json();
    assert.equal(body.result, undefined);
    assert.match(body.error, /当前工作台未修改/);
    calls = [];
    const timeout = new Error("provider timeout");
    timeout.name = "TimeoutError";
    responses = [timeout];
    const timedOut = await post();
    assert.equal(timedOut.status, 502);
    assert.match((await timedOut.json()).error, /生成超时/);
    assert.equal(calls.length, 1, "超时不得重新开启无界重试");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("AI提示中的完整示例必须符合实际组合Schema与连接规则", () => {
  const marker = "不能使用标签或模块类型）：";
  const index = guidance.combination.indexOf(marker);
  assert(index >= 0);
  const example = JSON.parse(guidance.combination.slice(index + marker.length));
  assert.equal(validateLayoutPlan(example).version, 2);
});
