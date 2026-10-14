import { z } from "zod";
import { templateSchema, types } from "./model.js";
import { arrange } from "./layout.js";
export const planningSchema = z
  .object({
    goal: z.string().min(1).max(300),
    steps: z
      .array(
        z
          .object({
            title: z.string().min(1).max(80),
            description: z.string().min(1).max(300),
            moduleTypes: z.array(z.enum(types)).min(1).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    assumptions: z.array(z.string().min(1).max(200)).max(4).optional(),
    layoutReason: z.string().min(1).max(500),
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
export function validateLayoutPlan(value: unknown) {
  const valid = layoutResultSchema.safeParse(value);
  if (valid.success) return valid.data;
  // Only repair geometry. Metadata, settings and private-field rules remain strict.
  const candidate = repairableSchema.parse(value);
  const arranged = arrange(
    candidate.modules.map((m, i) => ({ ...m, id: `plan-${i}` })),
    "主次",
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
