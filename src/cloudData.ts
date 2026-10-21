import { flowStateSchema } from "./flowSchema.js";
import { connectionError } from "./connections.js";
import {
  customConfigSchema,
  customRuntimeSchema,
  connectionSchema,
} from "./customAI.js";
import { z } from "zod";
import {
  publicSettingsSchema,
  layoutSchema,
  types,
  uid,
  type Workspace,
  type Note,
} from "./model.js";
import {
  feedbackSchema,
  exchangeSchema,
  summarySchema,
  planHistorySchema,
  quizAttemptSchema,
} from "./taskAssistantSchemas.js";
import { planningSchema } from "./layoutPlan.js";
const id = z.string().min(1).max(100);
const text = z.string().max(1000000);
const kind = z.enum(["original", "ai", "user", "mixed", "unknown"]);
const source = z
  .object({
    contentKind: kind.optional(),
    kind: z.enum(["pdf", "web", "video", "text"]).optional(),
    moduleId: id.optional(),
    noteId: id.optional(),
    resourceId: id,
    resourceName: z.string().max(2000).optional(),
    version: id,
    page: z.number().finite(),
    text,
    url: z.string().max(4000).optional(),
    timestamp: z.number().finite().optional(),
    start: z.number().finite().optional(),
    end: z.number().finite().optional(),
    createdAt: z.number().finite().optional(),
  })
  .strict();
const card = z
  .object({ id, front: text, back: text, source: source.optional() })
  .strict();
const question = z
  .object({
    id,
    type: z.enum(["choice", "short"]),
    question: text,
    options: z.array(text).max(10).optional(),
    answer: text,
    explanation: text,
  })
  .strict();
const data = z
  .object({
    custom: customRuntimeSchema.optional(),
    flow: flowStateSchema.optional(),
    text: text.optional(),
    url: z.string().max(4000).optional(),
    transcript: text.optional(),
    mediaResourceId: id.optional(),
    time: z.number().finite().optional(),
    seek: z.number().finite().optional(),
    cards: z.array(card).max(10000).optional(),
    tasks: z
      .array(z.object({ id, text, done: z.boolean() }).strict())
      .max(10000)
      .optional(),
    nodes: z
      .array(
        z
          .object({
            id,
            parentId: id.optional(),
            text,
            x: z.number().finite(),
            y: z.number().finite(),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
    mapScale: z.number().finite().optional(),
    mapPan: z
      .object({ x: z.number().finite(), y: z.number().finite() })
      .strict()
      .optional(),
    events: z
      .array(
        z
          .object({
            id,
            date: z.string().max(30),
            title: text,
            time: z.string().max(30),
          })
          .strict(),
      )
      .max(10000)
      .optional(),
    month: z.string().max(30).optional(),
    selectedDate: z.string().max(30).optional(),
    timer: z
      .object({
        mode: z.enum(["focus", "break"]),
        remaining: z.number().finite(),
        endsAt: z.number().finite().optional(),
      })
      .strict()
      .optional(),
    quiz: z.array(question).max(1000).optional(),
    answers: z.record(text).optional(),
    submitted: z.boolean().optional(),
    quizAttempts: z.array(quizAttemptSchema).max(20).optional(),
    imageZoom: z.number().finite().optional(),
    autoSync: z.boolean().optional(),
    autoTranslate: z.boolean().optional(),
    webMode: z.enum(["embed", "external"]).optional(),
  })
  .strict();
const stateFields = {
  data: data.optional(),
  settings: publicSettingsSchema.optional(),
  resourceId: id.optional(),
  page: z.number().finite().optional(),
  zoom: z.number().finite().optional(),
  input: text.optional(),
  output: text.optional(),
  language: z.string().max(100).optional(),
  source: source.optional(),
  activeNoteId: id.optional(),
  messages: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant"]),
          content: text,
          source: source.optional(),
          sources: z.array(source).max(36).optional(),
        })
        .strict(),
    )
    .max(10000)
    .optional(),
};
const mod = z
  .object({
    id,
    type: z.enum(types),
    customConfig: customConfigSchema.optional(),
    title: z.string().min(1).max(80),
    layout: layoutSchema,
    group: id.optional(),
    locked: z.boolean().optional(),
    ...stateFields,
  })
  .strict();
const note = z
  .object({
    id,
    workspaceId: id,
    moduleId: id,
    content: text,
    sources: z.array(source).max(10000),
    contentKind: kind.optional(),
    taskId: id.optional(),
    originRun: z.object({ moduleId: id, runId: id }).strict().optional(),
  })
  .strict();
const artifact = z
  .object({
    id,
    stepId: id,
    key: z.string().max(250),
    title: z.string().max(300),
    moduleId: id,
    kind: z.enum(["note", "cards", "quiz", "custom"]),
    snapshot: text,
    sources: z.array(source).max(10000),
    contentKind: kind,
    createdAt: z.number().finite(),
  })
  .strict();
const task = z
  .object({
    id,
    title: z.string().max(80),
    goal: z.string().max(300),
    status: z.enum(["active", "paused", "completed"]),
    steps: z
      .array(
        z
          .object({
            id,
            title: z.string().max(80),
            description: z.string().max(300),
            moduleIds: z.array(id).max(24),
            done: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    outcomes: z.array(z.string().max(300)).max(20),
    assumptions: z.array(z.string().max(300)).max(20),
    artifacts: z.array(artifact).max(1000),
    createdAt: z.number().finite(),
    completedAt: z.number().finite().optional(),
    feedback: z.array(feedbackSchema).max(20).optional(),
    assistantLog: z.array(exchangeSchema).max(12).optional(),
    learningSummary: summarySchema.optional(),
    summaryPending: z.boolean().optional(),
    planHistory: z.array(planHistorySchema).max(10).optional(),
    moduleStates: z.record(z.object(stateFields).strict()).optional(),
    plan: planningSchema
      .extend({
        steps: planningSchema.shape.steps.element
          .extend({ moduleTypes: z.array(z.enum(types)).max(24) })
          .array()
          .min(1)
          .max(20),
      })
      .optional(),
  })
  .strict();
export const cloudPayloadSchema = z
  .object({
    version: z.literal(1),
    workspace: z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).max(80),
        description: z.string().max(1000),
        modules: z.array(mod).max(24),
        createdAt: z.number().finite(),
        updatedAt: z.number().finite(),
        origin: id.optional(),
        tasks: z.array(task).max(100).optional(),
        connections: z.array(connectionSchema).max(48).optional(),
        activeTaskId: id.optional(),
        isolationVersion: z.literal(1),
      })
      .strict(),
    notes: z.array(note).max(10000),
  })
  .strict()
  .superRefine(({ workspace: w, notes }, c) => {
    const taskIds = new Set(w.tasks?.map((t) => t.id));
    const connectionIssue = connectionError(w.modules, w.connections || []);
    if (connectionIssue)
      c.addIssue({ code: "custom", message: connectionIssue });
    const checkRuns = (
      moduleId: string,
      data: z.infer<typeof customRuntimeSchema> | undefined,
      taskId?: string,
    ) => {
      const snapshots = [
        data?.inputs,
        ...(data?.runs || []).map((r) => r.inputs),
      ];
      if (
        snapshots.some((inputs) =>
          Object.values(inputs || {}).some(
            (i) =>
              i.connection &&
              (i.connection.workspaceId !== w.id ||
                i.connection.taskId !== taskId),
          ),
        )
      )
        c.addIssue({ code: "custom", message: "连接输入快照归属无效" });
      if (
        data?.runs.some(
          (r) =>
            r.workspaceId !== w.id ||
            r.moduleId !== moduleId ||
            r.taskId !== taskId,
        )
      )
        c.addIssue({ code: "custom", message: "自定义模块运行记录归属无效" });
    };
    const checkFlow = (
      flow: z.infer<typeof flowStateSchema> | undefined,
      taskId?: string,
      moduleId?: string,
    ) => {
      if (flow?.materials?.some((e) => e.target.moduleId !== moduleId))
        c.addIssue({ code: "custom", message: "学习材料不属于当前工具" });
      if (
        flow?.inputs.some(
          (p) =>
            p.connection &&
            (p.connection.workspaceId !== w.id ||
              p.connection.taskId !== taskId),
        )
      )
        c.addIssue({ code: "custom", message: "模块连接内容归属无效" });
    };
    w.modules.forEach((m) => checkFlow(m.data?.flow, undefined, m.id));
    w.tasks?.forEach((t) =>
      Object.entries(t.moduleStates || {}).forEach(([moduleId, s]) =>
        checkFlow(s.data?.flow, t.id, moduleId),
      ),
    );
    w.modules.forEach((m) => checkRuns(m.id, m.data?.custom));
    w.tasks?.forEach((t) =>
      Object.entries(t.moduleStates || {}).forEach(([id, s]) =>
        checkRuns(id, s.data?.custom, t.id),
      ),
    );

    const unique = (ids: string[]) => new Set(ids).size === ids.length;
    if (
      !unique(w.modules.map((m) => m.id)) ||
      !unique((w.tasks || []).map((t) => t.id)) ||
      !unique(notes.map((n) => n.id))
    )
      c.addIssue({ code: "custom", message: "重复的对象 ID" });
    if (w.activeTaskId && !taskIds.has(w.activeTaskId))
      c.addIssue({ code: "custom", message: "活动任务不存在" });
    if (
      (w.tasks || []).some(
        (t) => (t.status === "active") !== (t.id === w.activeTaskId),
      )
    )
      c.addIssue({ code: "custom", message: "任务活动状态不一致" });
    for (const n of notes)
      if (n.workspaceId !== w.id || (n.taskId && !taskIds.has(n.taskId)))
        c.addIssue({ code: "custom", message: "笔记归属无效" });
    for (const t of w.tasks || [])
      if (
        !unique(t.steps.map((s) => s.id)) ||
        t.artifacts.some((a) => !t.steps.some((s) => s.id === a.stepId))
      )
        c.addIssue({ code: "custom", message: "成果步骤关联无效" });
  });
export type CloudPayload = z.infer<typeof cloudPayloadSchema>;
export type CloudRecord = {
  workspace_id: string;
  revision: number;
  payload: CloudPayload;
  updated_at: string;
};
export function parseCloudPayload(value: unknown): CloudPayload {
  if (new TextEncoder().encode(JSON.stringify(value)).length > 5 * 1024 * 1024)
    throw Error("单个工作台云端内容上限为 5 MB，请精简后重试");
  return cloudPayloadSchema.parse(value);
}
export function cloudPayload(w: Workspace, notes: Note[]): CloudPayload {
  const { cloud: _cloud, ...workspace } = w;
  return parseCloudPayload(
    JSON.parse(
      JSON.stringify({
        version: 1,
        workspace,
        notes: notes.filter((n) => n.workspaceId === w.id),
      }),
    ),
  );
}
export async function payloadHash(payload: CloudPayload) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function cloudCopy(payload: CloudPayload): {
  workspace: Workspace;
  notes: Note[];
} {
  const copy = structuredClone(payload),
    workspaceId = uid();
  const mapping = new Map(copy.notes.map((n) => [n.id, uid()]));
  const remap = (value: any): void => {
    if (!value || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (key === "workspaceId" && value[key] === payload.workspace.id)
        value[key] = workspaceId;
      else if (
        (key === "noteId" || key === "resourceId") &&
        mapping.has(value[key])
      )
        value[key] = mapping.get(value[key]);
      else remap(value[key]);
    }
  };
  remap(copy);
  const mapState = (s: {
    activeNoteId?: string;
    data?: { custom?: import("./customAI.js").CustomRuntime };
  }) => {
    s.data?.custom?.runs.forEach((r) => {
      r.workspaceId = workspaceId;
    });
    if (s.activeNoteId) s.activeNoteId = mapping.get(s.activeNoteId);
  };
  copy.workspace.id = workspaceId;
  copy.workspace.title = copy.workspace.title.slice(0, 72) + "（云端副本）";
  copy.workspace.modules.forEach(mapState);
  copy.workspace.tasks?.forEach((t) => {
    Object.values(t.moduleStates || {}).forEach(mapState);
    [
      ...(t.assistantLog || []),
      ...(t.learningSummary ? [t.learningSummary] : []),
    ].forEach((entry) =>
      entry.evidence.forEach((e) => {
        if (e.noteId) e.noteId = mapping.get(e.noteId) || e.noteId;
      }),
    );
    t.artifacts.forEach((a) => {
      if (a.kind === "note" && mapping.has(a.key.slice(5)))
        a.key = `note:${mapping.get(a.key.slice(5))}`;
    });
  });
  return {
    workspace: copy.workspace,
    notes: copy.notes.map((n) => ({
      ...n,
      id: mapping.get(n.id)!,
      workspaceId,
    })),
  };
}
