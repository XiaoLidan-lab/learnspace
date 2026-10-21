import { z } from "zod";
import { validateLayoutPlan } from "./layoutPlan.js";
export const cardsSchema = z
  .object({
    cards: z
      .array(
        z
          .object({
            front: z.string().min(1).max(1000),
            back: z.string().min(1).max(5000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const mindmapSchema = z
  .object({
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            parentId: z.string().max(80).optional(),
            text: z.string().min(1).max(300),
            x: z.number().min(0).max(1800),
            y: z.number().min(0).max(1400),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .superRefine((value, c) => {
    const ids = value.nodes.map((n) => n.id);
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "节点 ID 重复" });
    value.nodes.forEach((n) => {
      if (n.parentId && !ids.includes(n.parentId))
        c.addIssue({ code: "custom", message: "父节点不存在" });
      let parent = n.parentId;
      const seen = new Set([n.id]);
      while (parent) {
        if (seen.has(parent)) {
          c.addIssue({ code: "custom", message: "节点不能形成循环" });
          break;
        }
        seen.add(parent);
        parent = value.nodes.find((n) => n.id === parent)?.parentId;
      }
    });
  });
export const quizSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            type: z.literal("choice"),
            question: z.string().min(1).max(1000),
            options: z.array(z.string().trim().min(1).max(500)).min(2).max(6),
            answer: z.string().min(1).max(3000),
            explanation: z.string().max(5000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
  .superRefine((v, c) =>
    v.questions.forEach((q) => {
      if (!q.options.includes(q.answer))
        c.addIssue({ code: "custom", message: "选择题答案必须属于选项" });
      if (new Set(q.options.map((o) => o.trim())).size !== q.options.length)
        c.addIssue({ code: "custom", message: "选择题选项不能重复" });
    }),
  );
export function validateAIResult(action: string, content: string) {
  if (action === "documentDigest")
    return z.string().trim().min(1).max(1800).parse(content);
  if (content.length > 100000) throw Error("模型返回内容过大");
  if (action === "layout") return validateLayoutPlan(JSON.parse(content));
  if (action === "cards") return cardsSchema.parse(JSON.parse(content));
  if (action === "mindmap") return mindmapSchema.parse(JSON.parse(content));
  if (action === "quiz") return quizSchema.parse(JSON.parse(content));
  return z.string().min(1).parse(content);
}
