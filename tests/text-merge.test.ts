import test from "node:test";
import assert from "node:assert/strict";
import { creatableTypes, types } from "../src/definitions";
import { withTextPresentation } from "../src/textPresentation";
import { templateSchema, type Workspace, type Mod } from "../src/model";
import { connectionError, directConnection } from "../src/connectionGraph";
import { prepareGeneratedPlan, validateLayoutPlan } from "../src/layoutPlan";
import { changeStructure, projectWorkspace } from "../src/tasks";
const text: Mod = {
  id: "t",
  type: "text",
  title: "我的材料",
  layout: { x: 0, y: 0, w: 6, h: 6 },
  data: { text: "原内容" },
  settings: { format: "markdown" },
};
const summary: Mod = {
  id: "s",
  type: "summary",
  title: "摘要",
  layout: { x: 6, y: 0, w: 6, h: 6 },
};
test("one text creation entry, reversible presentation preserves contents, identity and graph", () => {
  assert(!creatableTypes.includes("sticky"));
  assert(!creatableTypes.includes("text"));
  assert(!creatableTypes.includes("custom-ai"));
  assert(!creatableTypes.includes("summary"));
  assert(types.includes("sticky"));
  const compact = withTextPresentation(text, true);
  assert.equal(compact.type, "sticky");
  assert.equal(compact.id, text.id);
  assert.equal(compact.data, text.data);
  assert.deepEqual(withTextPresentation(compact, false), text);
  const edges = [
    directConnection(
      [text, summary],
      [],
      "t",
      "selection",
      "s",
      "input",
      "edge",
    ),
  ];
  assert.equal(connectionError([compact, summary], edges), undefined);
  const w = {
    id: "w",
    modules: [text, summary],
    connections: edges,
    activeTaskId: "a",
    tasks: [
      { id: "a", moduleStates: { t: { data: { text: "任务A" } } } },
      { id: "b", moduleStates: { t: { data: { text: "任务B" } } } },
    ],
  } as unknown as Workspace;
  const next = changeStructure(
    w,
    projectWorkspace(w).modules.map((m) =>
      m.id === "t" ? withTextPresentation(m, true) : m,
    ),
  );
  assert.equal(next.modules[0].type, "sticky");
  assert.equal(projectWorkspace(next).modules[0].data?.text, "任务A");
  assert.equal(
    projectWorkspace({ ...next, activeTaskId: "b" }).modules[0].data?.text,
    "任务B",
  );
  assert.equal(next.modules[0].data?.text, "原内容");
  assert.deepEqual(next.connections, edges);
});
test("summary stays readable for legacy templates but cannot appear in new AI recommendations", () => {
  const legacy = {
    version: 2 as const,
    title: "旧总结方案",
    description: "",
    modules: [
      {
        instanceId: "m1",
        type: "summary" as const,
        title: "已有摘要",
        layout: { x: 0, y: 0, w: 6, h: 6 },
      },
    ],
    connections: [],
    planning: {
      goal: "整理要点",
      steps: [
        {
          title: "解释要点",
          description: "概括材料",
          moduleTypes: ["summary" as const],
        },
      ],
      moduleRoles: [{ moduleId: "m1", purpose: "保留旧总结" }],
      layoutReason: "兼容历史布局",
    },
  };
  assert.equal(validateLayoutPlan(legacy).modules[0].type, "summary");
  assert.throws(() => prepareGeneratedPlan(legacy), /AI 总结已合并到 AI 问答/);
});
test("legacy sticky templates stay valid; new AI drafts reject removed text modules", () => {
  const template = {
    version: 1,
    title: "旧模板",
    description: "",
    modules: [
      { type: "sticky", title: "旧便签", layout: { x: 0, y: 0, w: 6, h: 6 } },
    ],
  };
  assert(templateSchema.safeParse(template).success);
  const legacyPlan = {
    ...template,
    version: 2,
    modules: [{ ...template.modules[0], instanceId: "m1" }],
    connections: [],
    planning: {
      goal: "整理概念",
      steps: [
        { title: "解释概念", description: "写出解释", moduleTypes: ["sticky"] },
      ],
      moduleRoles: [{ moduleId: "m1", purpose: "记录解释" }],
      layoutReason: "单工具",
    },
  };
  assert.equal(validateLayoutPlan(legacyPlan).modules[0].type, "sticky");
  assert.throws(
    () => prepareGeneratedPlan(legacyPlan),
    /文本模块已从新建目录移除/,
  );
});
