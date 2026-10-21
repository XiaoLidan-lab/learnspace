import { z } from "zod";
import {
  connectedInputSchema,
  customSourceSchema,
  connectionSchema,
} from "./customAI.js";
export const flowStateSchema = z
  .object({
    inputs: z.array(connectedInputSchema).max(12),
    materials: z.array(connectionSchema).max(12).optional(),
    materialMode: z.enum(["sources", "manual"]).optional(),
    documents: z
      .array(
        z
          .object({
            resourceId: z.string().max(100),
            version: z.string().max(100),
            name: z.string().max(300),
            method: z.enum(["direct", "retrieval", "digest"]),
            pages: z.number().int().positive(),
            parts: z.number().int().positive(),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    lastText: z.string().max(24000).optional(),
    destination: z.string().max(100).optional(),
    previousOutput: z
      .object({
        text: z.string().max(30000),
        source: customSourceSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, c) => {
    const ids = v.inputs.flatMap((input) =>
      input.connection ? [input.connection.id] : [],
    );
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", message: "连接取用快照不能重复" });
    if (v.inputs.reduce((n, p) => n + p.text.length, 0) > 24000)
      c.addIssue({ code: "custom", message: "连接内容合计最多24000字符" });
  });
export type FlowState = z.infer<typeof flowStateSchema>;
