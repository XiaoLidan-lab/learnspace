import { z } from "zod";
const fieldId = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/,
    "变量名须以小写字母开头，仅含字母、数字和下划线",
  );
export const customConfigSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(500),
    fields: z
      .array(
        z
          .object({
            id: fieldId,
            label: z.string().trim().min(1).max(80),
            required: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    prompt: z.string().trim().min(1).max(4000),
    display: z.enum(["text", "markdown"]),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.fields.map((f) => f.id)).size !== v.fields.length)
      c.addIssue({
        code: "custom",
        path: ["fields"],
        message: "输入变量名不能重复",
      });
    const keys = new Set(v.fields.map((f) => f.id));
    for (const match of v.prompt.matchAll(/\{\{([^{}]*)\}\}/g))
      if (!keys.has(match[1]))
        c.addIssue({
          code: "custom",
          path: ["prompt"],
          message: `未声明的变量：${match[1]}`,
        });
    if (/[{}]/.test(v.prompt.replace(/\{\{[a-z][a-z0-9_]{0,31}\}\}/g, "")))
      c.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "占位符格式应为 {{变量名}}，不支持代码或表达式",
      });
  });
export type CustomConfig = z.infer<typeof customConfigSchema>;
export const customSourceSchema = z
  .object({
    contentKind: z
      .enum(["original", "ai", "user", "mixed", "unknown"])
      .optional(),
    kind: z.enum(["pdf", "web", "video", "text"]).optional(),
    moduleId: z.string().max(100).optional(),
    noteId: z.string().max(100).optional(),
    resourceId: z.string().max(100),
    resourceName: z.string().max(300).optional(),
    version: z.string().max(100),
    page: z.number().finite(),
    text: z.string().max(1200),
    url: z.string().max(4000).optional(),
    timestamp: z.number().finite().optional(),
    start: z.number().finite().optional(),
    end: z.number().finite().optional(),
    createdAt: z.number().finite().optional(),
  })
  .strict();
export const customInputSchema = z
  .object({
    text: z.string().max(8000),
    kind: z.enum(["original", "ai", "user", "mixed", "unknown"]),
    sources: z.array(customSourceSchema).max(3),
    connection: z
      .object({
        id: z.string().max(100),
        workspaceId: z.string().max(100),
        taskId: z.string().max(100).optional(),
        moduleId: z.string().max(100),
        port: z.string().max(30),
        range: z.enum(["selection", "document"]).optional(),
        noteId: z.string().max(100).optional(),
        version: z.string().max(100),
        fetchedAt: z.number().finite(),
        edited: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
// Standard modules can consume a bounded whole document. Custom AI field limits stay unchanged.
export const connectedInputSchema = customInputSchema.extend({
  text: z.string().max(23000),
});
export const customInputsSchema = z
  .record(fieldId, customInputSchema)
  .refine(
    (v) => Object.values(v).reduce((n, i) => n + i.text.length, 0) <= 12000,
    "输入合计最多 12000 字符",
  );
export const customRequestSchema = z
  .object({ config: customConfigSchema, inputs: customInputsSchema })
  .strict()
  .superRefine((v, c) => {
    const keys = new Set(v.config.fields.map((f) => f.id));
    if (Object.keys(v.inputs).some((k) => !keys.has(k)))
      c.addIssue({ code: "custom", message: "存在未声明的输入字段" });
    for (const f of v.config.fields)
      if (f.required && !v.inputs[f.id]?.text.trim())
        c.addIssue({
          code: "custom",
          path: ["inputs", f.id],
          message: `请填写${f.label}`,
        });
    if (!v.config.fields.some((f) => v.inputs[f.id]?.text.trim()))
      c.addIssue({ code: "custom", message: "至少填写一项输入" });
    if (new TextEncoder().encode(JSON.stringify(v)).length > 85000)
      c.addIssue({ code: "custom", message: "输入与来源过大，请缩短后重试" });
  });
export const customResultSchema = z
  .object({
    text: z.string().trim().min(1).max(12000),
    citations: z.array(z.string().regex(/^S\d+$/)).max(24),
  })
  .strict();
export function customEvidence(request: z.infer<typeof customRequestSchema>) {
  return request.config.fields
    .flatMap((f) =>
      (request.inputs[f.id]?.sources || []).map((source) => ({
        field: f.id,
        source,
      })),
    )
    .map((v, i) => ({ ...v, id: `S${i + 1}` }));
}
export function renderCustomPrompt(
  request: z.infer<typeof customRequestSchema>,
) {
  return request.config.prompt.replace(
    /\{\{([a-z][a-z0-9_]{0,31})\}\}/g,
    (_, id: string) => request.inputs[id]?.text || "",
  );
}
export function validateCustomResult(
  value: unknown,
  request: z.infer<typeof customRequestSchema>,
) {
  const result = customResultSchema.parse(value),
    allowed = new Set(customEvidence(request).map((e) => e.id));
  if (
    result.citations.some((id) => !allowed.has(id)) ||
    [...result.text.matchAll(/\[(S\d+)\]/g)].some(
      (m) => !result.citations.includes(m[1]),
    )
  )
    throw Error("模型引用不属于本次来源，请重试");
  return result;
}
export const customRunSchema = z
  .object({
    id: z.string().min(1).max(100),
    workspaceId: z.string().min(1).max(100),
    moduleId: z.string().min(1).max(100),
    taskId: z.string().max(100).optional(),
    retryOf: z.string().max(100).optional(),
    config: customConfigSchema,
    inputs: customInputsSchema,
    startedAt: z.number().finite(),
    finishedAt: z.number().finite().optional(),
    status: z.enum([
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "interrupted",
    ]),
    result: customResultSchema.optional(),
    error: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((run, c) => {
    if (
      !customRequestSchema.safeParse({ config: run.config, inputs: run.inputs })
        .success
    )
      c.addIssue({ code: "custom", message: "运行输入快照无效" });
    if (run.status === "succeeded" && !run.result)
      c.addIssue({ code: "custom", message: "成功运行必须保留结果" });
    if (run.status !== "succeeded" && run.result)
      c.addIssue({ code: "custom", message: "非成功运行不能包含结果" });
    if (
      run.status === "running"
        ? run.finishedAt !== undefined
        : run.finishedAt === undefined
    )
      c.addIssue({ code: "custom", message: "运行状态与结束时间不一致" });
    if (run.result)
      try {
        validateCustomResult(run.result, run);
      } catch {
        c.addIssue({ code: "custom", message: "运行结果引用无效" });
      }
  });
export const customRuntimeSchema = z
  .object({
    inputs: customInputsSchema,
    runs: z.array(customRunSchema).max(10),
  })
  .strict();
export type CustomRuntime = z.infer<typeof customRuntimeSchema>;
export type CustomRun = z.infer<typeof customRunSchema>;
export const connectionSchema = z
  .object({
    id: z.string().min(1).max(100),
    source: z
      .object({
        moduleId: z.string().min(1),
        port: z.enum([
          "text",
          "selection",
          "output",
          "note",
          "retrieval",
          "answer",
          "transcript",
          "outline",
          "cards",
          "tasks",
          "questions",
          "results",
          "events",
          "timer",
          "document",
          "web_url",
          "video_ref",
          "image_ref",
        ]),
        range: z.enum(["selection", "document"]).optional(),
        query: z.string().trim().min(1).max(500).optional(),
        noteId: z.string().optional(),
        itemId: z.string().min(1).max(100).optional(),
        needsBinding: z.literal(true).optional(),
      })
      .strict(),
    target: z.object({ moduleId: z.string().min(1), field: fieldId }).strict(),
    trigger: z.literal("manual"),
    mode: z.literal("replace"),
  })
  .strict();
export function defaultCustomConfig(): CustomConfig {
  return {
    version: 1,
    name: "自定义 AI 模块",
    purpose: "依据输入资料回答问题并辅助学习",
    fields: [
      { id: "paper", label: "论文内容", required: true },
      { id: "question", label: "用户问题", required: true },
      { id: "goal", label: "学习目标", required: false },
    ],
    prompt:
      "依据以下资料回答问题；资料不支持的结论请明确说明。\n资料：{{paper}}\n问题：{{question}}\n学习目标：{{goal}}",
    display: "markdown",
  };
}
export function nextCustomRuntime(
  previous: CustomRuntime | undefined,
  id: string,
  patch: Partial<CustomRun>,
): CustomRuntime {
  return {
    ...(previous || { inputs: {}, runs: [] }),
    runs: (previous?.runs || []).map((r) =>
      r.id === id ? { ...r, ...patch } : r,
    ),
  };
}

export function completeCustomRun(
  mod: import("./model.js").Mod,
  id: string,
  patch: Pick<CustomRun, "status"> & Partial<CustomRun>,
): Partial<import("./model.js").Mod> {
  if (
    !mod.data?.custom?.runs.some((r) => r.id === id && r.status === "running")
  )
    return {};
  return {
    ...(patch.status === "succeeded" && patch.result
      ? { output: patch.result.text }
      : {}),
    data: {
      ...mod.data,
      custom: nextCustomRuntime(mod.data.custom, id, patch),
    },
  };
}

// Compare schema-normalized values, not incidental object property order.
export function customStateKey(
  config: CustomConfig,
  inputs: CustomRuntime["inputs"],
) {
  return JSON.stringify([
    customConfigSchema.parse(config),
    config.fields.map((f) => [
      f.id,
      inputs[f.id] ? customInputSchema.parse(inputs[f.id]) : null,
    ]),
  ]);
}

// Explicit content reuse is a copy, not a fresh read from the target task's connection.
export function copiedCustomInputs(
  inputs: CustomRuntime["inputs"],
  noteIds = new Map<string, string>(),
) {
  return Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => {
      const { connection: _connection, ...input } = structuredClone(value);
      input.sources = input.sources.map((source) => ({
        ...source,
        ...(source.noteId && noteIds.has(source.noteId)
          ? {
              noteId: noteIds.get(source.noteId),
              resourceId: noteIds.get(source.noteId)!,
            }
          : {}),
      }));
      return [key, input];
    }),
  );
}
