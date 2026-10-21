import { z } from "zod";
const id = z.string().min(1).max(100);
export const feedbackSchema = z
  .object({
    id,
    stepId: id.optional(),
    level: z.enum(["stuck", "unsure", "confident"]),
    text: z.string().max(300),
    createdAt: z.number().finite(),
  })
  .strict();
export const evidenceSchema = z
  .object({
    id,
    label: z.string().max(300),
    text: z.string().max(3000),
    kind: z.enum(["original", "user", "ai", "mixed", "unknown"]),
    moduleId: id.optional(),
    noteId: id.optional(),
    locator: z
      .object({
        resourceId: id,
        version: id,
        page: z.number().int().min(1),
        timestamp: z.number().finite().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const proposalStepSchema = z
  .object({
    id: id.optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().max(300),
    moduleIds: z.array(id).max(24),
  })
  .strict();
// Some models echo read-only context flags. Validate their types, then discard them;
// only the user's existing completion state can be preserved by applyAdjustment.
const generatedStepSchema = proposalStepSchema
  .extend({
    done: z.boolean().optional(),
    hasArtifacts: z.boolean().optional(),
  })
  .transform(({ done: _done, hasArtifacts: _hasArtifacts, ...step }) => step);
export const coachResultSchema = z
  .object({
    answer: z.string().min(1).max(6000),
    citations: z
      .array(
        id.transform((value) => value.trim().replace(/^\[(E\d+)\]$/, "$1")),
      )
      .max(20),
    next: z
      .object({
        label: z.string().min(1).max(80),
        reason: z.string().max(1000),
        moduleId: id.optional(),
      })
      .strict(),
    adjustment: z
      .object({
        reason: z.string().min(1).max(1000),
        steps: z.array(generatedStepSchema).min(1).max(20),
      })
      .strict()
      .optional(),
    summary: z
      .object({
        knowledge: z.array(z.string().max(500)).max(10),
        weaknesses: z.array(z.string().max(500)).max(10),
        review: z.array(z.string().max(500)).max(10),
      })
      .strict()
      .optional(),
  })
  .strict();
export const taskContextSchema = z
  .object({
    workspaceId: id,
    taskId: id,
    goal: z.string().max(300),
    status: z.enum(["active", "paused", "completed"]),
    steps: z
      .array(
        proposalStepSchema.extend({
          id,
          done: z.boolean(),
          hasArtifacts: z.boolean(),
        }),
      )
      .min(1)
      .max(20),
    modules: z
      .array(
        z
          .object({ id, type: z.string().max(30), title: z.string().max(80) })
          .strict(),
      )
      .max(24),
    outcomes: z.array(z.string().max(300)).max(20),
    feedback: z
      .array(feedbackSchema.omit({ id: true, createdAt: true }))
      .max(20),
    mastery: z.string().max(3000),
    evidence: z.array(evidenceSchema).max(40),
    coverage: z.array(z.string().max(300)).max(30),
  })
  .strict();
export const coachRequestSchema = z
  .object({
    mode: z.enum(["ask", "adjust", "summary"]),
    question: z.string().min(1).max(1000),
    context: taskContextSchema,
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(6000),
          })
          .strict(),
      )
      .max(6),
  })
  .strict()
  .refine(
    (value) => new TextEncoder().encode(JSON.stringify(value)).length <= 85000,
    "任务上下文过大，请缩短计划或问题后重试",
  );
export type TaskContext = z.infer<typeof taskContextSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type CoachResult = z.infer<typeof coachResultSchema>;
export const exchangeSchema = z
  .object({
    id,
    question: z.string().max(1000),
    result: coachResultSchema,
    coverage: z.array(z.string().max(300)).max(30).optional(),
    evidence: z.array(evidenceSchema).max(40),
    contextKey: z.string().max(100),
    createdAt: z.number().finite(),
  })
  .strict();
export const summarySchema = z
  .object({
    result: coachResultSchema,
    coverage: z.array(z.string().max(300)).max(30).optional(),
    evidence: z.array(evidenceSchema).max(40),
    contextKey: z.string().max(100),
    createdAt: z.number().finite(),
  })
  .strict();
export const planHistorySchema = z
  .object({
    createdAt: z.number().finite(),
    reason: z.string().max(1000),
    steps: z
      .array(proposalStepSchema.extend({ id, done: z.boolean() }))
      .min(1)
      .max(20),
  })
  .strict();
export const quizAttemptSchema = z
  .object({
    id,
    createdAt: z.number().finite(),
    questions: z
      .array(
        z
          .object({
            id,
            question: z.string().max(1000),
            type: z.enum(["choice", "short"]),
            answer: z.string().max(3000),
            response: z.string().max(3000),
            correct: z.boolean().optional(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export function validateCoachResult(
  value: unknown,
  request: z.infer<typeof coachRequestSchema>,
): CoachResult {
  // A finished-task summary does not need a model-selected next action. Some
  // providers omit it or return null; use a controlled review hint in this mode.
  const normalized =
    request.mode === "summary" &&
    value &&
    typeof value === "object" &&
    (!("next" in value) || value.next == null)
      ? {
          ...value,
          next: {
            label: "回顾成果与安排复习",
            reason: "任务已完成，可核对成果并安排复习。",
          },
        }
      : value;
  const r = coachResultSchema.parse(normalized),
    c = request.context;
  const moduleIds = new Set(c.modules.map((m) => m.id));
  const inline = [...r.answer.matchAll(/\[(E\d+)\]/g)].map((m) => m[1]);
  if (inline.some((id) => !r.citations.includes(id)))
    throw Error("回答引用与来源列表不一致，请重试");
  if (r.citations.some((id) => !c.evidence.some((e) => e.id === id))) {
    throw Error("AI 引用了未提供的来源，请重试");
  }
  if (r.next.moduleId && !moduleIds.has(r.next.moduleId))
    throw Error("AI 推荐的模块不存在，请重试");
  if (request.mode === "adjust") {
    if (!r.adjustment) throw Error("AI 未返回可预览的计划，请重试");
    const steps = r.adjustment.steps;
    const ids = steps.flatMap((s) => (s.id ? [s.id] : []));
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !c.steps.some((s) => s.id === id))
    )
      throw Error("AI 步骤标识无效，请重试");
    if (steps.some((s) => s.moduleIds.some((id) => !moduleIds.has(id))))
      throw Error("AI 步骤引用了不存在的模块，请重试");
    if (c.steps.some((s) => (s.done || s.hasArtifacts) && !ids.includes(s.id)))
      throw Error("不能移除已完成或有关联成果的步骤");
  } else if (r.adjustment) throw Error("此操作不能调整计划");
  if (request.mode === "summary" && !r.summary)
    throw Error("AI 未返回总结，请重试");
  if (request.mode !== "summary" && r.summary)
    throw Error("此操作不能生成完成总结");
  return r;
}
