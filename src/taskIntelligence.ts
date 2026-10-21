import { uid, type Workspace, type Note, type Mod } from "./model.js";
import { projectWorkspace, scopedNotes, type LearningTask } from "./tasks.js";
import {
  taskContextSchema,
  validateCoachResult,
  type Evidence,
  type TaskContext,
  type CoachResult,
} from "./taskAssistantSchemas.js";

export function quizAttempt(mod: Mod) {
  return {
    id: uid(),
    createdAt: Date.now(),
    questions: (mod.data?.quiz || []).map((q) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      answer: q.answer,
      response: mod.data?.answers?.[q.id] || "",
      ...(q.type === "choice"
        ? { correct: mod.data?.answers?.[q.id] === q.answer }
        : {}),
    })),
  };
}
export function mastery(w: Workspace, taskId: string) {
  const task = w.tasks?.find((t) => t.id === taskId)!;
  const modules = projectWorkspace({ ...w, activeTaskId: taskId }).modules;
  const results = modules
    .filter((m) => m.type === "quiz")
    .flatMap((m) => {
      const attempts = m.data?.quizAttempts || [];
      const questions = attempts.length
        ? attempts.at(-1)!.questions
        : m.data?.submitted
          ? quizAttempt(m).questions
          : [];
      return questions.map((q) => ({ ...q, moduleId: m.id }));
    });
  const scored = results.filter((q) => q.type === "choice");
  const correct = scored.filter((q) => q.correct).length;
  const stuck = task.feedback?.slice(-1)[0]?.level === "stuck";
  const label = stuck
    ? "需要帮助"
    : !scored.length
      ? "证据不足"
      : correct < scored.length
        ? "需要巩固"
        : scored.length < 3
          ? "初步理解"
          : "当前题目表现良好";
  const reasons = [
    scored.length
      ? `最近已提交的选择题答对 ${correct}/${scored.length}，只代表这些题目。`
      : "没有可客观判分的已提交选择题。",
    `${results.filter((q) => q.type === "short").length} 道简答题需人工核对，不自动计分。`,
    `已关联 ${task.artifacts.length} 项成果，仅证明有学习产出。`,
    task.feedback?.length
      ? `最近自评：${{ stuck: "遇到困难", unsure: "不确定", confident: "有信心" }[task.feedback.at(-1)!.level]}，自评不等于验证通过。`
      : "尚无用户自评。",
    "步骤完成率不用于推算掌握度；题目由 AI 生成时，答案本身仍需核验。",
  ];
  return {
    label,
    reasons,
    correct,
    total: scored.length,
    items: results.map((q) => ({
      question: q.question,
      moduleId: q.moduleId,
      status:
        q.type === "short"
          ? "需人工核对"
          : q.correct
            ? "此题回答正确"
            : "此题需巩固",
    })),
  };
}
export function nextOperation(w: Workspace, task: LearningTask) {
  const projected = projectWorkspace({ ...w, activeTaskId: task.id });
  const quiz = projected.modules.find(
    (m) =>
      m.type === "quiz" &&
      m.data?.submitted &&
      m.data.quiz?.some(
        (q) => q.type === "choice" && m.data?.answers?.[q.id] !== q.answer,
      ),
  );
  if (quiz)
    return {
      label: "回看错题并补充练习",
      moduleId: quiz.id,
      reason: "当前已提交的选择题存在错误，建议先核对解析。",
    };
  const step = task.steps.find((s) => !s.done);
  if (step) {
    const module = projected.modules.find((m) => step.moduleIds.includes(m.id));
    return {
      label: step.title,
      moduleId: module?.id,
      reason: step.description || "继续第一个未完成步骤。",
    };
  }
  return {
    label:
      task.status === "completed" ? "回顾成果与安排复习" : "检查成果并完成任务",
    reason: "步骤已勾选完成，仍需核对成果要求；完成不代表掌握。",
  };
}
export function buildTaskContext(
  w: Workspace,
  taskId: string,
  notes: Note[],
  extras: Evidence[] = [],
  coverage: string[] = [],
): TaskContext {
  const task = w.tasks?.find((t) => t.id === taskId);
  if (!task) throw Error("学习任务不存在");
  const space = projectWorkspace({ ...w, activeTaskId: taskId });
  const evidence: Evidence[] = [];
  let budget = 12000;
  let omitted = 0;
  const add = (e: Omit<Evidence, "id">) => {
    if (!e.text.trim()) return;
    if (budget <= 0 || evidence.length >= 40) {
      omitted++;
      return;
    }
    const text = e.text.slice(0, Math.min(2500, budget));
    if (text.length < e.text.length) omitted++;
    budget -= text.length;
    evidence.push({
      ...e,
      id: `E${evidence.length + 1}`,
      text,
      label: e.label.slice(0, 300),
    });
  };
  // Retrieved passages are question-specific; reserve their place before long outputs.
  extras.forEach((e) => add(e));
  // Include evidence of performance and outputs before other long documents.
  task.artifacts.slice(-8).forEach((a) =>
    add({
      label: `成果快照：${a.title}`,
      text: a.snapshot,
      kind: a.contentKind,
      moduleId: space.modules.some((m) => m.id === a.moduleId)
        ? a.moduleId
        : undefined,
    }),
  );
  for (const m of space.modules.filter((m) => m.type === "quiz")) {
    const attempts = m.data?.quizAttempts || [];
    const latest =
      attempts.at(-1) || (m.data?.submitted ? quizAttempt(m) : undefined);
    if (latest)
      add({
        label: `测验作答：${m.title}`,
        text: JSON.stringify(latest.questions),
        kind: "user",
        moduleId: m.id,
      });
  }
  for (const feedback of (task.feedback || []).slice(-3))
    add({
      label: "用户自评与学习反馈",
      kind: "user",
      text: `自评：${{ stuck: "遇到困难", unsure: "不确定", confident: "有信心" }[feedback.level]}；反馈：${feedback.text || "无补充文字"}`,
    });
  scopedNotes({ ...w, activeTaskId: taskId }, notes)
    .slice(-8)
    .forEach((n) =>
      add({
        label: `笔记：${n.content.replace(/^#+\s*/, "").slice(0, 60)}`,
        text: n.content,
        kind: n.contentKind || "unknown",
        moduleId: n.moduleId,
        noteId: n.id,
      }),
    );
  for (const n of scopedNotes({ ...w, activeTaskId: taskId }, notes).slice(-8))
    for (const s of n.sources.slice(-3))
      if (s.text)
        add({
          label: `笔记关联材料：${s.resourceName || "资料"}`,
          text: s.text,
          kind: s.contentKind || "unknown",
          moduleId: s.moduleId,
          ...(s.kind === "pdf" && s.page > 0
            ? {
                locator: {
                  resourceId: s.resourceId,
                  version: s.version,
                  page: s.page,
                },
              }
            : {}),
        });
  for (const m of space.modules) {
    if (m.input?.trim() && m.input !== m.source?.text)
      add({
        label: `${m.title}（待处理材料）`,
        text: m.input,
        kind: m.source?.contentKind || "unknown",
        moduleId: m.id,
      });
    const body = m.data?.text || m.data?.transcript;
    if (body)
      add({
        label: `${m.title}（用户提供文本）`,
        text: body,
        kind: "user",
        moduleId: m.id,
      });
    if (m.data?.cards?.length)
      add({
        label: `卡片：${m.title}`,
        text: m.data.cards
          .map((c) => `问：${c.front}\n答：${c.back}`)
          .join("\n"),
        kind: "unknown",
        moduleId: m.id,
      });
    if (m.source?.text)
      add({
        label: `关联摘录：${m.source.resourceName || m.title}`,
        text: m.source.text,
        kind: m.source.contentKind || "unknown",
        moduleId: m.source.moduleId || m.id,
        ...(m.source.kind === "pdf"
          ? {
              locator: {
                resourceId: m.source.resourceId,
                version: m.source.version,
                page: m.source.page,
              },
            }
          : {}),
      });
    if (m.output)
      add({
        label: `AI 输出：${m.title}`,
        text: m.output,
        kind: "ai",
        moduleId: m.id,
      });
  }
  return taskContextSchema.parse({
    workspaceId: w.id,
    taskId,
    goal: task.goal,
    status: task.status,
    steps: task.steps.map((s) => ({
      ...s,
      hasArtifacts: task.artifacts.some((a) => a.stepId === s.id),
    })),
    modules: space.modules.map(({ id, type, title }) => ({ id, type, title })),
    outcomes: task.outcomes,
    feedback: (task.feedback || []).slice(-20).map(({ id: _id, createdAt: _createdAt, ...feedback }) => feedback),
    mastery: JSON.stringify(
      (({ label, reasons, correct, total }) => ({
        label,
        reasons,
        correct,
        total,
      }))(mastery(w, taskId)),
    ),
    evidence,
    coverage: [
      "仅包含当前任务的文本、最近八篇笔记、绑定资料摘录和最近成果；不包含其他任务或自由学习正文。",
      ...coverage,
      ...(omitted
        ? [`有 ${omitted} 段内容被截断或省略，请针对具体资料继续提问。`]
        : []),
    ].slice(0, 30),
  });
}
// A compact change detector (not a security hash); source text is never used as a storage key.
export function contextKey(context: TaskContext) {
  let h = 2166136261;
  for (const c of JSON.stringify(context))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}
export function planKey(task: LearningTask) {
  return JSON.stringify({
    goal: task.goal,
    steps: task.steps,
    outcomes: task.outcomes,
  });
}
export function applyAdjustment(
  w: Workspace,
  taskId: string,
  result: CoachResult,
  expectedPlan: string,
): Workspace {
  const task = w.tasks?.find((t) => t.id === taskId);
  if (!task || task.status !== "active" || w.activeTaskId !== taskId)
    throw Error("请先切换并继续此任务");
  if (planKey(task) !== expectedPlan) throw Error("计划已变化，请重新生成建议");
  const context = buildTaskContext(w, taskId, []);
  validateCoachResult(
    { ...result, answer: "确认计划调整", citations: [] },
    { mode: "adjust", question: "确认修改", context, history: [] },
  );
  const steps = result.adjustment!.steps.map((s) => ({
    ...s,
    id: s.id || uid(),
    done: s.id ? task.steps.find((old) => old.id === s.id)!.done : false,
  }));
  const updated: LearningTask = {
    ...task,
    steps,
    planHistory: [
      ...(task.planHistory || []).slice(-9),
      {
        createdAt: Date.now(),
        reason: result.adjustment!.reason,
        steps: structuredClone(task.steps),
      },
    ],
  };
  return { ...w, tasks: w.tasks?.map((t) => (t.id === taskId ? updated : t)) };
}

export function assistantHistory(
  task: LearningTask,
  mode: "ask" | "adjust" | "summary",
  key: string,
) {
  if (mode !== "ask") return [];
  return (task.assistantLog || [])
    .filter((entry) => entry.contextKey === key && !entry.result.adjustment)
    .slice(-3)
    .flatMap((entry) => [
      { role: "user" as const, content: entry.question },
      {
        role: "assistant" as const,
        content: entry.result.answer
          .slice(0, 1000)
          .replace(/\[?E\d+\]?/g, "（历史引用，以当前证据为准）"),
      },
    ]);
}
