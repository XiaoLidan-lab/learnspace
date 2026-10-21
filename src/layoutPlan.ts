import { z } from "zod";
import { templateSchema, types } from "./model.js";
import { arrange } from "./layout.js";
import { isUtilityTool } from "./utilityTools.js";
export const planningSchema = z
  .object({
    goal: z.string().trim().min(1).max(300),
    outcomes: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
    steps: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(80),
            description: z.string().trim().min(1).max(300),
            moduleTypes: z.array(z.enum(types)).min(1).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    assumptions: z.array(z.string().min(1).max(200)).max(4).optional(),
    layoutReason: z.string().min(1).max(500),
    moduleRoles: z
      .array(
        z
          .object({
            moduleId: z.string().min(1).max(100),
            purpose: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(24)
      .optional(),
  })
  .strict();
export type LayoutPlanning = z.infer<typeof planningSchema>;
export const layoutResultSchema = templateSchema
  .innerType()
  .extend({ planning: planningSchema })
  .strict()
  .superRefine((value, context) => {
    const { planning, ...template } = value;
    const result = templateSchema.safeParse(template);
    if (!result.success)
      result.error.issues.forEach((issue) => context.addIssue(issue));
    if (!template.modules.length)
      context.addIssue({
        code: "custom",
        message: "AI 方案至少需要一个学习模块",
      });
    if (template.version === 2) {
      const ids = new Set(template.modules.map((m) => m.instanceId));
      const roles = planning.moduleRoles || [];
      if (
        roles.length !== ids.size ||
        new Set(roles.map((r) => r.moduleId)).size !== roles.length ||
        roles.some((r) => !ids.has(r.moduleId))
      )
        context.addIssue({
          code: "custom",
          message: "请为每个模块填写唯一且有效的用途说明",
        });
      const custom = template.modules
        .filter((m) => m.customConfig)
        .map((m) =>
          JSON.stringify([
            m.customConfig!.purpose.trim(),
            m.customConfig!.prompt.trim(),
          ]),
        );
      if (new Set(custom).size !== custom.length)
        context.addIssue({
          code: "custom",
          message: "存在职责和 Prompt 完全相同的自定义模块，请合并重复功能",
        });
    }
    const chosen = new Set(template.modules.map((m) => m.type));
    planning.steps.forEach((step, i) => {
      if (step.moduleTypes.some((t) => !chosen.has(t)))
        context.addIssue({
          code: "custom",
          path: ["planning", "steps", i, "moduleTypes"],
          message: "步骤引用了方案中不存在的模块",
        });
    });
  });

const repairableSchema = templateSchema
  .innerType()
  .extend({
    planning: planningSchema,
    modules: templateSchema
      .innerType()
      .shape.modules.element.extend({
        layout: z
          .object({
            x: z.number(),
            y: z.number(),
            w: z.number(),
            h: z.number(),
          })
          .strict(),
      })
      .strict()
      .array()
      .min(1)
      .max(24),
  })
  .strict();
export function validateLayoutPlan(input: unknown) {
  // Models sometimes spell an omitted optional flag as false. Only canonicalize
  // public text/output ports; never infer or remove a required private binding.
  let value = input;
  if (input && typeof input === "object" && (input as any).version === 2) {
    const draft = structuredClone(input) as any;
    if (Array.isArray(draft.modules) && Array.isArray(draft.connections)) {
      for (const e of draft.connections) {
        const source = draft.modules.find(
          (m: any) => m?.instanceId === e?.source?.moduleId,
        );
        if (
          e?.source?.needsBinding === false &&
          source &&
          ((["text", "sticky"].includes(source.type) &&
            e.source.port === "text") ||
            (["summary", "translate", "custom-ai"].includes(source.type) &&
              e.source.port === "output"))
        )
          delete e.source.needsBinding;
      }
    }
    value = draft;
  }
  const valid = layoutResultSchema.safeParse(value);
  if (valid.success) return valid.data;
  // Only repair geometry. Metadata, settings and private-field rules remain strict.
  const candidate = repairableSchema.parse(value);
  const arranged = arrange(
    candidate.modules.map((m, i) => ({ ...m, id: `plan-${i}` })),
    "按用途",
  );
  return layoutResultSchema.parse({
    ...candidate,
    modules: candidate.modules.map((m, i) => ({
      ...m,
      layout: arranged[i].layout,
    })),
    planning: {
      ...candidate.planning,
      layoutReason: `${candidate.planning.layoutReason.slice(0, 400)}（模块位置已自动校正，保证最小宽度并避免重叠。）`,
    },
  });
}

// Local plan identifiers become real instance identifiers only at confirmed installation.
export function installedPlanning(
  plan: LayoutPlanning,
  template: import("./model.js").Template,
  modules: import("./model.js").Mod[],
): LayoutPlanning {
  const ids = new Map(
    template.modules.map((m, i) => [m.instanceId, modules[i]?.id]),
  );
  return {
    ...structuredClone(plan),
    ...(plan.moduleRoles
      ? {
          moduleRoles: plan.moduleRoles.map((r) => {
            const moduleId = ids.get(r.moduleId);
            if (!moduleId) throw Error("模块用途引用无效，未安装方案");
            return { ...r, moduleId };
          }),
        }
      : {}),
  };
}

// Only AI creation uses this policy. Imported templates and user-edited plans retain their layout.
export function prepareGeneratedPlan(input: unknown, includeCustom = false) {
  const plan = validateLayoutPlan(input);
  if (plan.modules.some((m) => m.type === "text" || m.type === "sticky"))
    throw new z.ZodError([
      {
        code: "custom",
        path: ["modules"],
        message:
          "文本模块已从新建目录移除，请用资料阅读工具提供内容，使用笔记保存成果",
      },
    ]);
  if (plan.modules.some((m) => m.type === "summary"))
    throw new z.ZodError([
      {
        code: "custom",
        path: ["modules"],
        message: "AI 总结已合并到 AI 问答，请使用 chat 模块完成总结",
      },
    ]);
  if (plan.version !== 2)
    throw new z.ZodError([
      {
        code: "custom",
        path: ["version"],
        message: "AI组合方案必须使用V2格式",
      },
    ]);
  if (!includeCustom && plan.modules.some((m) => m.type === "custom-ai"))
    throw new z.ZodError([
      {
        code: "custom",
        path: ["modules"],
        message:
          "本次仅使用标准模块，请移除自定义模块和连接，使用问答、笔记、卡片或测验等已有工具",
      },
    ]);
  const reading = plan.modules.some(
    (m) =>
      ["pdf", "web", "video"].includes(m.type) &&
      (m.layout.w < 8 || m.layout.h < 14),
  );
  const hasTools = plan.modules.some((m) => isUtilityTool(m.type));
  if (!reading && !hasTools) return plan;
  const arranged = arrange(
    plan.modules.map((m, i) => ({ ...m, id: `generated-${i}` })),
    "按用途",
  );
  return layoutResultSchema.parse({
    ...plan,
    modules: plan.modules.map((m, i) => ({
      ...m,
      layout: arranged[i].layout,
      ...(isUtilityTool(m.type) ? { group: undefined } : {}),
    })),
    planning: {
      ...plan.planning,
      layoutReason: `${plan.planning.layoutReason.slice(0, 350)}（已按用途安排主画布；所选待办、日历和番茄钟显示在工作台角落。）`,
    },
  });
}
