import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  fromTemplate,
  builtins,
  type Note,
  type Workspace,
} from "../src/model";
import {
  taskFromPlan,
  addTask,
  updateModule,
  projectWorkspace,
  reuseTaskContent,
} from "../src/tasks";
import {
  assistantHistory,
  buildTaskContext,
  contextKey,
  planKey,
  applyAdjustment,
  mastery,
  nextOperation,
  quizAttempt,
} from "../src/taskIntelligence";
import {
  validateCoachResult,
  type CoachResult,
} from "../src/taskAssistantSchemas";
import { cloudPayload, cloudCopy } from "../src/cloudData";
import { taskResources } from "../src/taskResources";
import { store } from "../src/storage";
import { createApp } from "./helpers/aiApp";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
function setup() {
  let w = fromTemplate(builtins[0]);
  w.modules[0].type = "text";
  w.modules[1].type = "quiz";
  w.modules[2].type = "note";
  const a = taskFromPlan(
    {
      goal: "理解能量转换",
      steps: [
        { title: "阅读", description: "阅读资料", moduleTypes: ["text"] },
        { title: "练习", description: "测验", moduleTypes: ["quiz"] },
      ],
      layoutReason: "合成测试",
    },
    w.modules,
  );
  w = addTask(w, a);
  return { w, a };
}
const answer: CoachResult = {
  answer: "当前证据不足",
  citations: [],
  next: { label: "先阅读", reason: "尚未阅读" },
};
test("助手上下文只包括目标任务；来源类型、页码、截断与反馈可解释", () => {
  let { w, a } = setup();
  w = updateModule(w, w.modules[0].id, {
    data: { text: "任务A资料" },
    input: "任务A待处理材料",
    output: "AI概括",
  });
  const b = taskFromPlan(
    {
      goal: "任务B",
      steps: [{ title: "读", description: "", moduleTypes: ["text"] }],
      layoutReason: "",
    },
    w.modules,
  );
  w = addTask(w, b);
  w = updateModule(w, w.modules[0].id, { data: { text: "B-secret" } });
  const notes: Note[] = [
    {
      id: "an",
      taskId: a.id,
      workspaceId: w.id,
      moduleId: w.modules[2].id,
      content: "A笔记",
      sources: [],
      contentKind: "user",
    },
    {
      id: "bn",
      taskId: b.id,
      workspaceId: w.id,
      moduleId: w.modules[2].id,
      content: "B-note-secret",
      sources: [],
    },
    {
      id: "free",
      workspaceId: w.id,
      moduleId: w.modules[2].id,
      content: "free-secret",
      sources: [],
    },
  ];
  const c = buildTaskContext(w, a.id, notes, [
    {
      id: "",
      label: "材料.pdf · 第 3 页",
      text: "原文".repeat(4000),
      kind: "original",
      moduleId: w.modules[0].id,
      locator: { resourceId: "r", version: "v1", page: 3 },
    },
  ]);
  const text = JSON.stringify(c);
  assert(
    !text.includes("B-secret") &&
      !text.includes("B-note-secret") &&
      !text.includes("free-secret"),
  );
  assert(text.includes("任务A资料") && text.includes("A笔记"));
  assert(text.includes("任务A待处理材料"));
  assert.equal(c.evidence.find((e) => e.text === "AI概括")?.kind, "ai");
  assert.equal(c.evidence.find((e) => e.locator)?.locator?.page, 3);
  assert(c.coverage.some((x) => x.includes("截断")));
  assert(c.evidence.reduce((s, e) => s + e.text.length, 0) <= 12000);
});
test("掌握度不随步骤完成增加，简答不判分，错题和自评均有依据；复制测验不复制成绩", () => {
  let { w, a } = setup();
  w.tasks![0].steps.forEach((s) => (s.done = true));
  assert.equal(mastery(w, a.id).label, "证据不足");
  const id = w.modules[1].id;
  w = updateModule(w, id, {
    data: {
      quiz: [
        {
          id: "q1",
          type: "choice",
          question: "光能转化为什么",
          options: ["化学能", "不变"],
          answer: "化学能",
          explanation: "",
        },
        {
          id: "q2",
          type: "short",
          question: "解释",
          answer: "参考",
          explanation: "",
        },
      ],
      answers: { q1: "不变", q2: "参考" },
      submitted: true,
    },
  });
  const attempt = quizAttempt(projectWorkspace(w).modules[1]);
  assert.equal(attempt.questions[1].correct, undefined);
  w = updateModule(w, id, {
    data: { ...projectWorkspace(w).modules[1].data, quizAttempts: [attempt] },
  });
  assert.equal(mastery(w, a.id).label, "需要巩固");
  assert.equal(mastery(w, a.id).total, 1);
  assert.equal(nextOperation(w, w.tasks![0]).moduleId, id);
  w.tasks![0].feedback = [
    { id: "f", text: "不理解原因", level: "stuck", createdAt: 1 },
  ];
  assert.equal(mastery(w, a.id).label, "需要帮助");
  const b = taskFromPlan(
    {
      goal: "另一任务",
      steps: [{ title: "练习", description: "", moduleTypes: ["quiz"] }],
      layoutReason: "",
    },
    w.modules,
  );
  w = addTask(w, b);
  const copied = reuseTaskContent(w, [], a.id).workspace;
  assert.equal(projectWorkspace(copied).modules[1].data?.quiz?.length, 2);
  assert.equal(
    projectWorkspace(copied).modules[1].data?.quizAttempts?.length,
    0,
  );
  assert.equal(mastery(copied, b.id).label, "证据不足");
  assert.equal(
    copied.tasks![0].moduleStates?.[id].data?.quizAttempts?.length,
    1,
  );
});
test("计划建议是只读草案；确认应用保留完成状态、旧计划和成果；过期/越权引用拒绝", () => {
  let { w, a } = setup();
  const task = w.tasks![0];
  task.steps[0].done = true;
  task.artifacts = [
    {
      id: "art",
      key: "note:n",
      title: "学习产出",
      moduleId: w.modules[2].id,
      kind: "note",
      snapshot: "已保存",
      sources: [],
      contentKind: "user",
      stepId: task.steps[0].id,
      createdAt: 1,
    },
  ];
  const c = buildTaskContext(w, a.id, []);
  const request = {
    mode: "adjust" as const,
    question: "补充练习",
    context: c,
    history: [],
  };
  const result = validateCoachResult(
    {
      ...answer,
      answer: "保留已有成果 [E1]",
      citations: ["E1"],
      adjustment: {
        reason: "补充练习",
        steps: [
          {
            id: task.steps[0].id,
            title: "阅读",
            description: "保留",
            moduleIds: [w.modules[0].id],
          },
          {
            title: "补充解释",
            description: "解释能量转换",
            moduleIds: [w.modules[2].id],
          },
          {
            id: task.steps[1].id,
            title: "练习",
            description: "最后自测",
            moduleIds: [w.modules[1].id],
          },
        ],
      },
    },
    request,
  );
  assert.equal(task.steps.length, 2);
  const before = planKey(task),
    updated = applyAdjustment(w, a.id, result, before);
  assert.equal(task.steps.length, 2);
  assert.equal(updated.tasks![0].steps.length, 3);
  assert.equal(updated.tasks![0].steps[0].done, true);
  assert.deepEqual(updated.tasks![0].artifacts, task.artifacts);
  assert.equal(updated.tasks![0].planHistory![0].steps.length, 2);
  assert.throws(() => applyAdjustment(updated, a.id, result, before), /已变化/);
  assert.throws(
    () =>
      validateCoachResult(
        { ...result, citations: ["other-task-source"] },
        request,
      ),
    /来源/,
  );
  assert.throws(
    () => validateCoachResult({ ...result, answer: "[E999]错误" }, request),
    /引用/,
  );
  assert.throws(
    () =>
      validateCoachResult(
        { ...result, next: { label: "访问", reason: "", moduleId: "other" } },
        request,
      ),
    /模块/,
  );
  assert.throws(
    () =>
      validateCoachResult(
        {
          ...result,
          adjustment: { reason: "删除", steps: [result.adjustment!.steps[1]] },
        },
        request,
      ),
    /不能移除/,
  );
  assert.throws(
    () => validateCoachResult(result, { ...request, mode: "ask" }),
    /不能调整/,
  );
});
test("助手记录、自评、总结、测验历史通过本地和云端保存；独立副本重映射笔记引用", async () => {
  const { w, a } = setup(),
    c = buildTaskContext(w, a.id, []);
  const note: Note = {
    id: crypto.randomUUID(),
    workspaceId: w.id,
    taskId: a.id,
    moduleId: w.modules[2].id,
    content: "note",
    sources: [],
  };
  const entry = {
    id: "entry",
    question: "问",
    result: answer,
    evidence: [
      {
        id: "E1",
        label: "笔记",
        text: "note",
        kind: "user" as const,
        noteId: note.id,
        moduleId: note.moduleId,
      },
    ],
    contextKey: contextKey(c),
    createdAt: 1,
    coverage: ["当前任务"],
  };
  w.tasks![0].assistantLog = [entry];
  w.tasks![0].learningSummary = {
    ...entry,
    result: {
      ...answer,
      summary: {
        knowledge: ["能量转换"],
        weaknesses: ["尚无测验"],
        review: ["练习"],
      },
    },
  };
  delete (w.tasks![0].learningSummary as any).id;
  delete (w.tasks![0].learningSummary as any).question;
  w.tasks![0].feedback = [
    { id: "f", text: "困惑", level: "stuck", createdAt: 1 },
  ];
  await store.saveSnapshot([w], [note]);
  const restored = (await store.workspaces()).find((x) => x.id === w.id)!;
  const payload = cloudPayload(restored, [note]);
  assert.equal(payload.workspace.tasks![0].feedback![0].text, "困惑");
  const copy = cloudCopy(payload);
  assert.notEqual(copy.notes[0].id, note.id);
  assert.equal(
    copy.workspace.tasks![0].assistantLog![0].evidence[0].noteId,
    copy.notes[0].id,
  );
  assert.equal(
    copy.workspace.tasks![0].learningSummary!.result.summary!.review[0],
    "练习",
  );
});
test("任务 AI 接口执行结构与来源验证；坏模型输出不会成为可应用计划", async () => {
  const { w, a } = setup();
  const context = buildTaskContext(w, a.id, []);
  let output: unknown = answer,
    guidance = "";
  const app = createApp({
    authenticate: async () => "synthetic",
    complete: async (_, payload, instructions) => {
      guidance = instructions;
      assert.equal((payload as any).context.taskId, a.id);
      return JSON.stringify(output);
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const post = (mode = "ask") =>
    fetch(`http://127.0.0.1:${port}/api/ai`, {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "taskAssist",
        payload: { mode, question: "为什么", context, history: [] },
      }),
    });
  try {
    assert.equal((await post()).status, 200);
    assert(
      guidance.includes("不可信数据") && guidance.includes("不能证明掌握"),
    );
    output = { ...answer, citations: ["unbound"] };
    assert.equal((await post()).status, 502);
    output = answer;
    assert.equal((await post("adjust")).status, 502);
    output = {
      ...answer,
      summary: { knowledge: [], weaknesses: ["证据不足"], review: [] },
    };
    assert.equal((await post("summary")).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("PDF 上下文完整索引目标任务绑定文件并检索，保留版本定位；取消/缺失/读取失败有边界反馈", async () => {
  let { w, a } = setup();
  w.modules[0].type = "pdf";
  w = updateModule(w, w.modules[0].id, { resourceId: "a-file", page: 3 });
  const b = taskFromPlan(
    {
      goal: "B",
      steps: [{ title: "读", description: "", moduleTypes: ["pdf"] }],
      layoutReason: "",
    },
    w.modules,
  );
  w = addTask(w, b);
  w = updateModule(w, w.modules[0].id, { resourceId: "b-file", page: 1 });
  let destroyed = 0;
  const loadedPages: number[] = [];
  const loader = () => ({
    promise: Promise.resolve({
      numPages: 5,
      getPage: async (page: number) => {
        loadedPages.push(page);
        return {
          getTextContent: async () => ({
            items: [{ str: "original page " + page }],
          }),
        };
      },
    }),
    destroy: async () => {
      destroyed++;
    },
  });
  const resources = [
    {
      id: "a-file",
      name: "A.pdf",
      version: "A-v1",
      createdAt: 1,
      file: new Blob(["A"]),
    },
    {
      id: "b-file",
      name: "B-secret.pdf",
      version: "B-v1",
      createdAt: 1,
      file: new Blob(["B"]),
    },
  ];
  const extracted = await taskResources(
    w,
    a.id,
    resources,
    new AbortController().signal,
    loader,
    "original page",
  );
  assert.deepEqual(loadedPages, [1, 2, 3, 4, 5]);
  assert(
    extracted.evidence.every(
      (e) => e.locator?.resourceId === "a-file" && e.locator.version === "A-v1",
    ),
  );
  assert(!JSON.stringify(extracted).includes("B-secret"));
  assert.equal(destroyed, 1);
  assert(
    (
      await taskResources(w, a.id, [], new AbortController().signal, loader)
    ).coverage.some((x) => x.includes("缺失")),
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    taskResources(w, a.id, resources, abort.signal, loader),
    { name: "AbortError" },
  );
  const failure = await taskResources(
    w,
    a.id,
    resources.map((r) => ({ ...r, version: r.version + "-failure" })),
    new AbortController().signal,
    () => ({
      promise: Promise.reject(Error("encrypted")),
      destroy: async () => {},
    }),
  );
  assert(failure.coverage.some((x) => x.includes("全文解析或检索失败")));
});
test("模型不能通过回显只读字段改变完成状态；未声明字段仍拒绝", () => {
  const { w, a } = setup(),
    task = w.tasks![0];
  const request = {
    mode: "adjust" as const,
    question: "建议",
    context: buildTaskContext(w, a.id, []),
    history: [],
  };
  const value = {
    ...answer,
    adjustment: {
      reason: "增加练习",
      steps: task.steps.map((s) => ({ ...s, done: true, hasArtifacts: true })),
    },
  };
  const result = validateCoachResult(value, request);
  assert(!("done" in result.adjustment!.steps[0]));
  const updated = applyAdjustment(w, a.id, result, planKey(task));
  assert.equal(updated.tasks![0].steps[0].done, false);
  assert.throws(() =>
    validateCoachResult(
      {
        ...value,
        adjustment: {
          reason: "bad",
          steps: [{ ...value.adjustment.steps[0], execute: "code" }],
        },
      },
      request,
    ),
  );
});

test("自评有独立引用；总结/调整不混入历史问答，问答的旧引用编号不冒充当前证据", () => {
  const { w, a } = setup(),
    task = w.tasks![0];
  task.feedback = [
    { id: "f", level: "stuck", text: "不理解能量转换", createdAt: 1 },
  ];
  const context = buildTaskContext(w, a.id, []),
    key = contextKey(context);
  assert(
    context.evidence.some(
      (e) => e.kind === "user" && e.text.includes("不理解能量转换"),
    ),
  );
  task.assistantLog = [
    {
      id: "e",
      question: "为什么",
      result: { ...answer, answer: "历史说明 [E99]" },
      evidence: [],
      contextKey: key,
      createdAt: 1,
    },
  ];
  assert.deepEqual(assistantHistory(task, "summary", key), []);
  assert.deepEqual(assistantHistory(task, "adjust", key), []);
  assert.deepEqual(assistantHistory(task, "ask", "stale"), []);
  assert(!JSON.stringify(assistantHistory(task, "ask", key)).includes("E99"));
  assert(!("id" in context.feedback[0]));
  const normalized = validateCoachResult(
    { ...answer, answer: "参见 [E1]", citations: ["[E1]"] },
    { mode: "ask", question: "测试", context, history: [] },
  );
  assert.deepEqual(normalized.citations, ["E1"]);
});

test("完成总结允许无下一步动作并补为受控回顾提示，问答仍拒绝空动作", () => {
  const { w, a } = setup(),
    context = buildTaskContext(w, a.id, []);
  const request = {
    mode: "summary" as const,
    question: "总结",
    context,
    history: [],
  };
  const summary = {
    ...answer,
    next: null,
    summary: { knowledge: [], weaknesses: ["证据不足"], review: ["核对资料"] },
  };
  assert.equal(
    validateCoachResult(summary, request).next.label,
    "回顾成果与安排复习",
  );
  assert.throws(() =>
    validateCoachResult({ ...answer, next: null }, { ...request, mode: "ask" }),
  );
});

test("检索到的文档证据不会被冗长成果占满上下文预算", () => {
  let { w, a } = setup();
  w = updateModule(w, w.modules[0].id, {
    data: { text: "long user material ".repeat(2000) },
  });
  const context = buildTaskContext(
    w,
    a.id,
    [],
    [
      {
        id: "",
        label: "tail.pdf · 第 24 页",
        text: "ZXQ-742 alkaline water",
        kind: "original",
        moduleId: w.modules[0].id,
        locator: { resourceId: "pdf", version: "v1", page: 24 },
      },
    ],
  );
  assert(
    context.evidence.some(
      (e) => e.locator?.page === 24 && e.text.includes("alkaline"),
    ),
  );
  assert(context.evidence.reduce((n, e) => n + e.text.length, 0) <= 12000);
});

test("较长推荐理由在受控上限内可保存，超限和未知字段仍拒绝", () => {
  const { w, a } = setup();
  const request = {
    mode: "ask" as const,
    question: "synthetic",
    context: buildTaskContext(w, a.id, []),
    history: [],
  };
  const result = {
    ...answer,
    next: { ...answer.next, reason: "合成理由".repeat(100) },
  };
  assert.equal(validateCoachResult(result, request).next.reason.length, 400);
  assert.throws(() =>
    validateCoachResult(
      { ...result, next: { ...result.next, reason: "a".repeat(1001) } },
      request,
    ),
  );
  assert.throws(() =>
    validateCoachResult({ ...result, execute: true }, request),
  );
});

test("助手显示将步骤内部标识和只读字段转为自然语言，不修改原记录", async () => {
  const { coachText } = await import("../src/coachText");
  const { w, a } = setup();
  const raw = `${a.steps[0].id}: done=true, hasArtifacts: true`;
  assert.equal(coachText(raw, w), "阅读: 步骤已完成, 已有成果");
  assert(raw.includes(a.steps[0].id));
});
