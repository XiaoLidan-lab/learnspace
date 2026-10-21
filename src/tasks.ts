import { inputPorts } from "./connectionGraph.js";
import { copiedCustomInputs } from "./customAI.js";
import { customEvidence } from "./customAI.js";
import {
  uid,
  type Workspace,
  type Mod,
  type Note,
  type Source,
  type ContentKind,
} from "./model.js";
import type { z } from "zod";
import type {
  feedbackSchema,
  exchangeSchema,
  summarySchema,
  planHistorySchema,
} from "./taskAssistantSchemas.js";
import type { LayoutPlanning } from "./layoutPlan.js";

export type TaskStep = {
  id: string;
  title: string;
  description: string;
  moduleIds: string[];
  done: boolean;
};
export type ArtifactCandidate = {
  key: string;
  title: string;
  moduleId: string;
  kind: "note" | "cards" | "quiz" | "custom";
  snapshot: string;
  sources: Source[];
  contentKind: ContentKind;
};
export type TaskArtifact = ArtifactCandidate & {
  id: string;
  stepId: string;
  createdAt: number;
};
export type LearningTask = {
  id: string;
  title: string;
  goal: string;
  status: "active" | "paused" | "completed";
  steps: TaskStep[];
  outcomes: string[];
  assumptions: string[];
  artifacts: TaskArtifact[];
  createdAt: number;
  completedAt?: number;
  moduleStates?: Record<string, ModuleState>;
  plan?: LayoutPlanning;
  feedback?: z.infer<typeof feedbackSchema>[];
  assistantLog?: z.infer<typeof exchangeSchema>[];
  learningSummary?: z.infer<typeof summarySchema>;
  summaryPending?: boolean;
  planHistory?: z.infer<typeof planHistorySchema>[];
};
export type ModuleState = Omit<
  Mod,
  "id" | "type" | "title" | "layout" | "group" | "locked" | "customConfig"
>;
const stateKeys = [
  "data",
  "settings",
  "resourceId",
  "page",
  "zoom",
  "input",
  "output",
  "language",
  "source",
  "activeNoteId",
  "messages",
] as const;
export function moduleState(m: Mod): ModuleState {
  return Object.fromEntries(
    stateKeys
      .filter((k) => m[k] !== undefined)
      .map((k) => [k, structuredClone(m[k])]),
  ) as ModuleState;
}
export function projectWorkspace(w: Workspace): Workspace {
  const task = w.tasks?.find((t) => t.id === w.activeTaskId);
  if (!task) return w;
  return {
    ...w,
    modules: w.modules.map((m) => ({
      id: m.id,
      type: m.type,
      title: m.title,
      layout: m.layout,
      group: m.group,
      locked: m.locked,
      settings: m.settings,
      customConfig: m.customConfig,
      ...(task.moduleStates?.[m.id] || {}),
    })),
  };
}
export function scopedNotes(w: Workspace, notes: Note[]): Note[] {
  return notes.filter(
    (n) => n.workspaceId === w.id && n.taskId === w.activeTaskId,
  );
}
export function updateModule(
  w: Workspace,
  moduleId: string,
  patch: Partial<Mod>,
  taskId: string | null | undefined = w.activeTaskId,
): Workspace {
  const base = w.modules.find((m) => m.id === moduleId);
  if (!base) return w;
  if (!taskId)
    return {
      ...w,
      modules: w.modules.map((m) =>
        m.id === moduleId ? { ...m, ...patch } : m,
      ),
    };
  return {
    ...w,
    tasks: w.tasks?.map((t) =>
      t.id === taskId
        ? {
            ...t,
            moduleStates: {
              ...t.moduleStates,
              [moduleId]: moduleState({
                ...projectWorkspace({
                  ...w,
                  activeTaskId: taskId,
                }).modules.find((m) => m.id === moduleId)!,
                ...patch,
              }),
            },
          }
        : t,
    ),
  };
}
export function changeStructure(w: Workspace, modules: Mod[]): Workspace {
  let next = w;
  for (const m of modules) next = updateModule(next, m.id, moduleState(m));
  if (w.activeTaskId)
    next = {
      ...next,
      tasks: next.tasks?.map((t) =>
        t.id === w.activeTaskId
          ? {
              ...t,
              moduleStates: {
                ...t.moduleStates,
                ...Object.fromEntries(
                  modules
                    .filter((m) => !w.modules.some((x) => x.id === m.id))
                    .map((m) => [m.id, moduleState(m)]),
                ),
              },
            }
          : t,
      ),
    };
  return {
    ...next,
    connections: next.connections?.filter(
      (e) =>
        modules.some((m) => m.id === e.source.moduleId) &&
        modules.some(
          (m) =>
            m.id === e.target.moduleId &&
            inputPorts(m).some((f) => f.id === e.target.field),
        ),
    ),

    modules: modules.map((m) => {
      const old = w.modules.find((x) => x.id === m.id);
      return {
        ...(old ||
          (w.activeTaskId
            ? { id: m.id, type: m.type, title: m.title, layout: m.layout }
            : m)),
        id: m.id,
        type: m.type,
        title: m.title,
        layout: m.layout,
        group: m.group,
        locked: m.locked,
        customConfig: m.customConfig,
      };
    }),
  };
}
// Additive migration: keep free-mode originals and copy former shared state to each legacy task.
export function migrateTaskContent(
  w: Workspace,
  notes: Note[],
): { workspace: Workspace; notes: Note[] } {
  if (w.isolationVersion === 1) return { workspace: w, notes };
  const additions: Note[] = [];
  const tasks = w.tasks?.map((t) => {
    const mapping = new Map<string, string>();
    for (const n of notes.filter((n) => n.workspaceId === w.id && !n.taskId)) {
      const id = uid();
      mapping.set(n.id, id);
      additions.push({ ...structuredClone(n), id, taskId: t.id });
    }
    const moduleStates = Object.fromEntries(
      w.modules.map((m) => {
        const state = moduleState(m);
        if (state.activeNoteId)
          state.activeNoteId = mapping.get(state.activeNoteId);
        return [m.id, state];
      }),
    );
    return {
      ...t,
      moduleStates: t.moduleStates || moduleStates,
      artifacts: t.artifacts.map((a) => ({
        ...a,
        key:
          a.kind === "note" && mapping.has(a.key.slice(5))
            ? `note:${mapping.get(a.key.slice(5))}`
            : a.key,
      })),
    };
  });
  return {
    workspace: { ...w, isolationVersion: 1, tasks },
    notes: [...notes, ...additions],
  };
}
export function reuseTaskContent(
  w: Workspace,
  notes: Note[],
  sourceTaskId: string | undefined,
) {
  if (!w.activeTaskId || sourceTaskId === w.activeTaskId)
    throw Error("请选择不同的来源任务");
  if (sourceTaskId && !w.tasks?.some((t) => t.id === sourceTaskId))
    throw Error("来源任务不存在");
  const targetId = w.activeTaskId;
  const source = projectWorkspace({ ...w, activeTaskId: sourceTaskId });
  const mapping = new Map<string, string>();
  const copies = scopedNotes({ ...w, activeTaskId: sourceTaskId }, notes).map(
    (n) => {
      const id = uid();
      mapping.set(n.id, id);
      return { ...structuredClone(n), id, taskId: targetId };
    },
  );
  const states = Object.fromEntries(
    source.modules.map((m) => {
      const state = moduleState(m);
      if (m.type === "custom-ai" && state.data?.custom) {
        state.data = {
          ...state.data,
          custom: {
            inputs: copiedCustomInputs(state.data.custom.inputs, mapping),
            runs: [],
          },
        };
        state.output = undefined;
      }
      if (state.data?.flow) {
        state.data = {
          ...state.data,
          flow: {
            inputs: state.data.flow.inputs.map((input) => {
              const { connection, ...snapshot } = input;
              return {
                ...snapshot,
                sources: snapshot.sources.map((s) => ({
                  ...s,
                  noteId: s.noteId
                    ? mapping.get(s.noteId) || s.noteId
                    : undefined,
                })),
              };
            }),
          },
        };
      }
      if (m.type === "quiz" && state.data) {
        state.data = {
          ...state.data,
          answers: {},
          submitted: false,
          quizAttempts: [],
        };
      }
      if (state.activeNoteId)
        state.activeNoteId = mapping.get(state.activeNoteId);
      return [m.id, state];
    }),
  );
  return {
    workspace: {
      ...w,
      tasks: w.tasks?.map((t) =>
        t.id === targetId ? { ...t, moduleStates: states } : t,
      ),
    },
    notes: [...notes, ...copies],
  };
}
export function taskFromPlan(
  plan: LayoutPlanning,
  modules: Mod[],
): LearningTask {
  return {
    id: uid(),
    title: plan.goal.slice(0, 80),
    goal: plan.goal,
    status: "active",
    createdAt: Date.now(),
    steps: plan.steps.map((s) => ({
      id: uid(),
      title: s.title,
      description: s.description,
      done: false,
      moduleIds: modules
        .filter((m) => s.moduleTypes.includes(m.type))
        .map((m) => m.id),
    })),
    outcomes: [...(plan.outcomes || [])],
    assumptions: [...(plan.assumptions || [])],
    artifacts: [],
    moduleStates: {},
    plan: structuredClone(plan),
  };
}
export function activateTask(w: Workspace, id?: string): Workspace {
  if (id && !w.tasks?.some((t) => t.id === id)) throw Error("学习任务不存在");
  return {
    ...w,
    activeTaskId: id,
    tasks: w.tasks?.map((t) =>
      t.id === id
        ? { ...t, status: "active", completedAt: undefined }
        : t.status === "active"
          ? { ...t, status: "paused" }
          : t,
    ),
  };
}
export function addTask(w: Workspace, task: LearningTask): Workspace {
  return activateTask({ ...w, tasks: [...(w.tasks || []), task] }, task.id);
}
export function finishTask(w: Workspace, id: string): Workspace {
  const task = w.tasks?.find((t) => t.id === id);
  if (!task) throw Error("学习任务不存在");
  if (task.steps.some((s) => !s.done)) throw Error("请先确认所有步骤已完成");
  if (!task.artifacts.length) throw Error("请先关联至少一项学习成果");
  return {
    ...w,
    activeTaskId: w.activeTaskId === id ? undefined : w.activeTaskId,
    tasks: w.tasks?.map((t) =>
      t.id === id ? { ...t, status: "completed", completedAt: Date.now() } : t,
    ),
  };
}
export function linkArtifact(
  task: LearningTask,
  candidate: ArtifactCandidate,
  stepId: string,
): LearningTask {
  if (task.status !== "active") throw Error("请先继续此任务");
  if (!task.steps.some((s) => s.id === stepId))
    throw Error("请选择有效的学习步骤");
  if (
    task.artifacts.some(
      (a) =>
        a.key === candidate.key &&
        a.stepId === stepId &&
        a.snapshot === candidate.snapshot,
    )
  )
    throw Error("此内容已关联到该步骤");
  return {
    ...task,
    artifacts: [
      ...task.artifacts,
      {
        ...structuredClone(candidate),
        id: uid(),
        stepId,
        createdAt: Date.now(),
      },
    ],
  };
}
export function artifactCandidates(
  w: Workspace,
  notes: Note[],
): ArtifactCandidate[] {
  const result: ArtifactCandidate[] = notes
    .filter(
      (n) =>
        n.workspaceId === w.id &&
        n.taskId === w.activeTaskId &&
        n.content.trim(),
    )
    .map((n) => ({
      key: `note:${n.id}`,
      title:
        n.content
          .split("\n")
          .find((s) => s.trim())
          ?.replace(/^#+\s*/, "")
          .slice(0, 80) || "笔记",
      moduleId: n.moduleId,
      kind: "note",
      snapshot: n.content,
      sources: n.sources,
      contentKind: n.contentKind || "unknown",
    }));
  for (const m of w.modules) {
    if (m.type === "custom-ai")
      for (const run of m.data?.custom?.runs || [])
        if (run.status === "succeeded" && run.result)
          result.push({
            key: `custom:${run.id}`,
            title: `${run.config.name} · ${new Date(run.startedAt).toLocaleString()}`,
            moduleId: m.id,
            kind: "custom",
            snapshot: run.result.text,
            sources: customEvidence(run)
              .filter((e) => run.result!.citations.includes(e.id))
              .map((e) => e.source),
            contentKind: "ai",
          });
    if (m.type === "cards" && m.data?.cards?.length)
      result.push({
        key: `cards:${m.id}`,
        title: `${m.title} · ${m.data.cards.length} 张`,
        moduleId: m.id,
        kind: "cards",
        snapshot: m.data.cards
          .map((c) => `### ${c.front}\n\n${c.back}`)
          .join("\n\n"),
        sources: m.data.cards.flatMap((c) => (c.source ? [c.source] : [])),
        contentKind: "mixed",
      });
    if (m.type === "quiz" && m.data?.quiz?.length)
      result.push({
        key: `quiz:${m.id}`,
        title: `${m.title} · ${m.data.submitted ? "已提交" : "练习草稿"}`,
        moduleId: m.id,
        kind: "quiz",
        snapshot: m.data.quiz
          .map(
            (q, i) =>
              `### ${i + 1}. ${q.question}\n\n${(q.options || []).join("\n\n")}\n\n我的回答：${m.data?.answers?.[q.id] || "未作答"}${m.data?.submitted ? `\n\n参考答案：${q.answer}\n\n${q.explanation}` : ""}`,
          )
          .join("\n\n"),
        sources: m.source ? [m.source] : [],
        contentKind: "mixed",
      });
  }
  return result;
}
