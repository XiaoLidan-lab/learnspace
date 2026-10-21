import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  addTask,
  activateTask,
  artifactCandidates,
  finishTask,
  linkArtifact,
  taskFromPlan,
} from "../src/tasks";
import {
  appendNote,
  receivingNote,
  titledTranslation,
} from "../src/noteContent";
import { builtins, fromTemplate, safeTemplate } from "../src/model";
import { store } from "../src/storage";
import { layoutResultSchema } from "../src/layoutPlan";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanEditor } from "../src/PlanEditor";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const plan = {
  goal: "理解并记录",
  steps: [
    {
      title: "阅读",
      description: "解释并保存",
      moduleTypes: ["note" as const],
    },
  ],
  outcomes: ["一篇笔记"],
  layoutReason: "保留资料与笔记",
};
test("多个任务独立保存进度，暂停/继续/完成及自由模式，公共模板不泄露任务", async () => {
  let w = fromTemplate(builtins[0]);
  const a = taskFromPlan(plan, w.modules),
    b = taskFromPlan(plan, w.modules);
  w = addTask(addTask(w, a), b);
  assert.equal(w.tasks?.find((t) => t.id === a.id)?.status, "paused");
  w = activateTask(w, a.id);
  const n = appendNote(
    undefined,
    w.id,
    w.modules.find((m) => m.type === "note")!.id,
    "我的理解",
    undefined,
    "user",
  );
  n.taskId = w.activeTaskId;
  const candidate = artifactCandidates(w, [n])[0];
  const linked = linkArtifact(w.tasks![0], candidate, a.steps[0].id);
  w.tasks![0] = linked;
  assert.throws(() => linkArtifact(linked, candidate, a.steps[0].id), /已关联/);
  assert.throws(() => finishTask(w, a.id), /步骤/);
  w.tasks![0].steps[0].done = true;
  w = finishTask(w, a.id);
  assert.equal(w.activeTaskId, undefined);
  assert.equal(w.tasks![1].steps[0].done, false);
  await store.saveInstallation(w, [n], []);
  const loaded = (await store.workspaces()).find((x) => x.id === w.id)!;
  assert.deepEqual(loaded.tasks, w.tasks);
  assert(!JSON.stringify(safeTemplate(w)).includes("artifacts"));
  n.content = "后续编辑";
  assert.match(loaded.tasks![0].artifacts[0].snapshot, /我的理解/);
  assert.equal(activateTask(loaded).tasks![0].status, "completed");
  assert.throws(() => activateTask(loaded, "missing"), /不存在/);
});
test("笔记接收使用当前篇且隔离工作台；AI 文字不伪装原文引用", () => {
  const w = fromTemplate(builtins[0]),
    m = w.modules.find((x) => x.type === "note")!;
  const a = appendNote(undefined, w.id, m.id, "A", undefined, "user");
  const b = appendNote(undefined, w.id, m.id, "B", undefined, "user");
  assert.equal(
    receivingNote([a, b], w.id, { ...m, activeNoteId: b.id })?.id,
    b.id,
  );
  assert.equal(receivingNote([a, b], "other", m), undefined);
  const source = {
    resourceId: "r",
    version: "v",
    page: 2,
    text: "原始证据",
    resourceName: "资料",
  };
  const ai = appendNote(undefined, w.id, m.id, "模型解释", source, "ai");
  assert(!ai.content.includes("> 模型解释"));
  assert.match(ai.content, /AI 生成/);
  assert.match(ai.content, /参考材料/);
  assert.equal(ai.sources[0].text, "原始证据");
  assert.match(
    appendNote(undefined, w.id, m.id, "原始证据", source, "original").content,
    /> 原始证据/,
  );
  assert.equal(
    appendNote(ai, w.id, m.id, "个人想法", undefined, "user").contentKind,
    "mixed",
  );
});
test("旧工作台不需迁移，卡片/测验快照关联后不随正文改变", async () => {
  const w = fromTemplate(builtins[0]);
  await store.save(w);
  assert.equal(
    (await store.workspaces()).find((x) => x.id === w.id)?.tasks,
    undefined,
  );
  w.modules.push({
    id: "cards",
    title: "卡片",
    type: "cards",
    layout: { x: 0, y: 20, w: 6, h: 6 },
    data: { cards: [{ id: "c", front: "问题", back: "答案" }] },
  });
  const t = taskFromPlan(plan, w.modules),
    candidate = artifactCandidates(w, [])[0];
  const next = linkArtifact(t, candidate, t.steps[0].id);
  w.modules.at(-1)!.data!.cards![0].back = "改变";
  assert.match(next.artifacts[0].snapshot, /答案/);
});

test("AI 草案可编辑且成果要求接受结构校验，缺失工具引用阻止应用", () => {
  const w = fromTemplate(builtins[0]);
  const template = safeTemplate(w);
  const result = layoutResultSchema.parse({ ...template, planning: plan });
  const task = taskFromPlan(result.planning, w.modules);
  assert.deepEqual(task.outcomes, ["一篇笔记"]);
  assert.deepEqual(
    task.steps[0].moduleIds,
    w.modules.filter((m) => m.type === "note").map((m) => m.id),
  );
  assert(
    !layoutResultSchema.safeParse({
      ...template,
      planning: { ...plan, outcomes: [""] },
    }).success,
  );
  assert(
    !layoutResultSchema.safeParse({
      ...template,
      planning: { ...plan, goal: "   " },
    }).success,
  );
  const missing = {
    ...template,
    modules: template.modules.filter((m) => m.type !== "note"),
  };
  assert(!layoutResultSchema.safeParse({ ...missing, planning: plan }).success);
  const html = renderToStaticMarkup(
    createElement(PlanEditor, { template: missing, plan }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /请重新生成/);
  assert.ok(!html.includes("成果要求"));
  assert.match(html, /推荐学习路线/);
});

test("译文笔记使用内容主题作标题，同时保留 AI 属性与参考来源", () => {
  const text = "解码器：解码器由六个相同的层堆叠而成。";
  const source = { resourceId: "r", version: "v", page: 3, text: "Decoder" };
  const note = appendNote(
    undefined,
    "w",
    "m",
    titledTranslation(text),
    source,
    "ai",
  );
  assert.ok(note.content.startsWith("### 解码器\n\n"));
  assert.ok(note.content.includes(text));
  assert.ok(!note.content.includes("### AI 生成"));
  assert.equal(note.contentKind, "ai");
  assert.deepEqual(note.sources, [source]);
  assert.equal(
    titledTranslation("## 注意力机制\n\n正文"),
    "## 注意力机制\n\n正文",
  );
  assert.ok(titledTranslation("长".repeat(100)).split("\n")[0].length < 40);
});
