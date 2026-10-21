import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanEditor } from "../src/PlanEditor";
import { ConnectionCanvas } from "../src/ConnectionCanvas";
import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { defaultCustomConfig } from "../src/customAI";
import {
  customModuleStore,
  instantiateCustomModule,
  reusableConfig,
} from "../src/customModuleStore";
import { arrangeForLearning, overlaps } from "../src/layout";
import { templateSchema, safeTemplate, type Mod } from "../src/model";
import { prepareGeneratedPlan } from "../src/layoutPlan";
import { createApp } from "./helpers/aiApp";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
function standardPlan() {
  return {
    version: 2 as const,
    title: "学习算法",
    description: "",
    modules: [
      {
        instanceId: "m1",
        type: "pdf" as const,
        title: "阅读资料",
        layout: { x: 0, y: 0, w: 6, h: 6 },
      },
      {
        instanceId: "m2",
        type: "chat" as const,
        title: "理解原理",
        layout: { x: 6, y: 0, w: 6, h: 6 },
      },
      {
        instanceId: "m3",
        type: "note" as const,
        title: "记录解释",
        layout: { x: 0, y: 6, w: 6, h: 6 },
      },
    ],
    connections: [],
    planning: {
      goal: "理解注意力计算",
      steps: [
        {
          title: "解释注意力计算",
          description: "用自己的话解释Q、K、V，并完成一个计算练习",
          moduleTypes: ["pdf", "chat", "note"],
        },
      ],
      outcomes: ["可复核的计算过程"],
      moduleRoles: [
        { moduleId: "m1", purpose: "阅读" },
        { moduleId: "m2", purpose: "解答" },
        { moduleId: "m3", purpose: "记录" },
      ],
      layoutReason: "阅读为主",
    },
  };
}
test("按用途排列给阅读保留主区域，保存实例内容、分组并避免重叠", () => {
  const modules: Mod[] = standardPlan().modules.map((m) => ({
    ...m,
    id: m.instanceId,
    data: { text: "existing" },
  }));
  const layout = arrangeForLearning(modules);
  assert.equal(layout[0].layout.w, 8);
  assert.equal(layout[0].layout.h, 16);
  assert.equal(layout[0].data, modules[0].data);
  for (let i = 0; i < layout.length; i++)
    for (let j = i + 1; j < layout.length; j++)
      assert(!overlaps(layout[i].layout, layout[j].layout));
  const grouped = [
    { ...modules[0], group: "g1" },
    { ...modules[1], group: "g1" },
    modules[2],
  ];
  const arranged = arrangeForLearning(grouped);
  assert.deepEqual(arranged[0].layout, arranged[1].layout);
  assert.equal(arranged[0].id, modules[0].id);
});
test("AI默认仅允许已有工具，只有明确开启才接受自定义配置；阅读布局自动校正", () => {
  const p = standardPlan();
  const prepared = prepareGeneratedPlan(p);
  assert(
    prepared.modules[0].layout.w >= 8 && prepared.modules[0].layout.h >= 14,
  );
  assert.equal(p.modules[0].layout.w, 6, "不修改输入草案");
  const custom = {
    ...p,
    modules: p.modules.map((m, i) =>
      i === 1
        ? { ...m, type: "custom-ai", customConfig: defaultCustomConfig() }
        : m,
    ),
    planning: {
      ...p.planning,
      steps: [
        { ...p.planning.steps[0], moduleTypes: ["pdf", "custom-ai", "note"] },
      ],
    },
  };
  assert.throws(() => prepareGeneratedPlan(custom), /仅使用标准模块/);
  assert.equal(prepareGeneratedPlan(custom, true).version, 2);
});
test("独立模块库只存配置；多次安装深拷贝、全新实例与空运行状态", async () => {
  const config = defaultCustomConfig();
  config.name = "合成可复用工具";
  const row = await customModuleStore.save(config);
  config.name = "外部修改";
  const restored = (await customModuleStore.list()).find(
    (r) => r.id === row.id,
  )!;
  assert.equal(restored.config.name, "合成可复用工具");
  const first = instantiateCustomModule(restored.config, []),
    second = instantiateCustomModule(restored.config, [first]);
  assert.notEqual(first.id, second.id);
  assert(!first.data);
  assert(!first.input);
  assert(!overlaps(first.layout, second.layout));
  first.customConfig!.fields[0].label = "局部编辑";
  assert.notEqual(
    first.customConfig!.fields[0].label,
    second.customConfig!.fields[0].label,
  );
  assert.notEqual(
    first.customConfig!.fields[0].label,
    restored.config.fields[0].label,
  );
  assert.throws(() =>
    reusableConfig({ ...restored.config, inputs: { paper: "private" } }),
  );
  assert.throws(
    () =>
      reusableConfig({ ...restored.config, prompt: "sk-" + "x".repeat(30) }),
    /凭证/,
  );
  const workspace = {
    id: "isolated",
    title: "合成",
    description: "",
    createdAt: 0,
    updatedAt: 0,
    modules: [second],
  };
  assert(templateSchema.safeParse(safeTemplate(workspace)).success);
  await customModuleStore.remove(row.id);
  assert(!(await customModuleStore.list()).some((r) => r.id === row.id));
});
test("HTTP默认搭建不接受自定义模块，明确开启可用；不会自动运行", async () => {
  const base = standardPlan();
  let custom = false,
    calls = 0,
    last = "";
  const app = createApp({
    authenticate: async () => "isolated-design",
    complete: async (_a, p, i) => {
      calls++;
      last = i;
      if (!custom) return JSON.stringify(base);
      return JSON.stringify({
        ...base,
        modules: base.modules.map((m, i) =>
          i === 1
            ? { ...m, type: "custom-ai", customConfig: defaultCustomConfig() }
            : m,
        ),
        planning: {
          ...base.planning,
          steps: [
            {
              ...base.planning.steps[0],
              moduleTypes: ["pdf", "custom-ai", "note"],
            },
          ],
        },
      });
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const post = (includeCustom?: boolean) =>
    fetch(`http://127.0.0.1:${(server.address() as any).port}/api/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test",
      },
      body: JSON.stringify({
        action: "layout",
        payload: {
          request: "学习大模型算法",
          mode: "combination",
          ...(includeCustom === undefined ? {} : { includeCustom }),
        },
      }),
    });
  try {
    assert.equal((await post()).status, 200);
    assert.equal(calls, 1);
    assert(last.includes("禁止 custom-ai"));
    assert(last.includes("学习步骤必须描述"));
    custom = true;
    calls = 0;
    assert.equal((await post()).status, 502);
    assert.equal(calls, 2);
    calls = 0;
    assert.equal((await post(true)).status, 200);
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("搭建预览只展示推荐学习路线，不提供工具配置；底层连接仍兼容", () => {
  const p = prepareGeneratedPlan(standardPlan());
  const { planning, ...template } = p;
  const html = renderToStaticMarkup(
    createElement(PlanEditor, { template, plan: planning }),
  );
  for (const retired of [
    "你的学习路线",
    "预期学习成果",
    "调整学习目标与步骤",
    "查看起点假设",
    "保存学习计划",
    "学习工具",
    "调整此工具",
    "添加工具",
    "空间安排",
  ]) {
    assert.ok(!html.includes(retired), `不应再展示：${retired}`);
  }
  assert.match(html, /推荐学习路线/);
  assert.match(html, /解释注意力计算/);
  assert.match(html, /plan-roadmap/);
  assert.ok(!/<(?:input|textarea|select|button)\b/.test(html));
  assert(!html.includes("调整布局（x、y、宽、高）"));
  const target = instantiateCustomModule(defaultCustomConfig(), []);
  const source: Mod = {
    id: "s",
    type: "text",
    title: "合成资料",
    layout: { x: 0, y: 0, w: 6, h: 8 },
  };
  const workspace = {
    id: "synthetic-ui",
    title: "合成界面",
    description: "",
    createdAt: 0,
    updatedAt: 0,
    modules: [source, target],
    connections: [
      {
        id: "edge",
        source: { moduleId: "s", port: "text" as const },
        target: { moduleId: target.id, field: "paper" },
        trigger: "manual" as const,
        mode: "replace" as const,
      },
    ],
  };
  const graph = renderToStaticMarkup(
    createElement(ConnectionCanvas, {
      workspace,
      notes: [],
      save: () => {},
      notify: () => {},
      navigate: () => {},
    }),
  );
  assert.match(graph, /有效连接立即保存/);
  assert(!graph.includes('aria-label="已有连接列表"'));
  assert.match(graph, /aria-label="查看连接：/);
  assert.match(graph, /合成资料/);
  assert(!graph.includes('role="dialog"'), "连接视图不应自动打开确认弹窗");
});
