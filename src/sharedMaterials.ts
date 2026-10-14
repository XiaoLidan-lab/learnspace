import { z } from "zod";
import { safeUrl } from "./platforms";
import {
  uid,
  type Workspace,
  type Resource,
  type Note,
  type Template,
} from "./model";
export const MATERIAL_BUCKET = "learnspace-materials";
export const MAX_SHARED_FILE = 50 * 1024 * 1024;
export const sharedMimeTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
];
const base = {
  moduleIndex: z.number().int().min(0).max(23),
  name: z.string().min(1).max(200),
};
const url = z
  .string()
  .max(4000)
  .refine((value) => {
    try {
      return !!safeUrl(value);
    } catch {
      return false;
    }
  }, "链接无效");
export const sharedMaterialSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("file"),
      path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/),
      mime: z.enum(sharedMimeTypes as [string, ...string[]]),
      size: z.number().int().min(1).max(MAX_SHARED_FILE),
    })
    .strict(),
  z.object({ ...base, kind: z.literal("url"), url }).strict(),
  z
    .object({
      ...base,
      kind: z.literal("text"),
      text: z.string().min(1).max(50000),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("transcript"),
      text: z.string().min(1).max(50000),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("note"),
      noteIndex: z.number().int().min(0).max(99),
      text: z.string().min(1).max(50000),
    })
    .strict(),
]);
export const sharedMaterialsSchema = z
  .array(sharedMaterialSchema)
  .max(72)
  .superRefine((items, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(items)).length > 524288)
      ctx.addIssue({
        code: "custom",
        message: "附带文本和资料清单合计不能超过 512 KB",
      });
    if (
      items.reduce((sum, m) => sum + (m.kind === "file" ? m.size : 0), 0) >
      100 * 1024 * 1024
    )
      ctx.addIssue({ code: "custom", message: "附带文件合计不能超过 100 MB" });
    const seen = new Set<string>();
    for (const item of items) {
      const key = `${item.moduleIndex}:${item.kind}:${item.kind === "note" ? item.noteIndex : ""}`;
      if (seen.has(key))
        ctx.addIssue({ code: "custom", message: "同一模块不能有重复资料" });
      seen.add(key);
    }
  });
export type SharedMaterial = z.infer<typeof sharedMaterialSchema>;
export type MaterialCandidate = {
  id: string;
  moduleIndex: number;
  moduleTitle: string;
  name: string;
  kind: SharedMaterial["kind"];
  resource?: Resource;
  value?: string;
  noteIndex?: number;
  unavailable?: string;
};
export function materialCandidates(
  workspace: Workspace,
  resources: Resource[],
  notes: Note[] = [],
): MaterialCandidate[] {
  return workspace.modules.flatMap((m, moduleIndex) => {
    const result: MaterialCandidate[] = [];
    const common = { moduleIndex, moduleTitle: m.title };
    const fileId =
      m.type === "pdf"
        ? m.resourceId
        : ["image", "video"].includes(m.type)
          ? m.data?.mediaResourceId
          : undefined;
    const resource = resources.find((r) => r.id === fileId);
    if (resource) {
      const mime =
        resource.file.type || (m.type === "pdf" ? "application/pdf" : "");
      result.push({
        ...common,
        id: `${m.id}:file`,
        kind: "file",
        name: resource.name,
        resource,
        unavailable:
          resource.file.size > MAX_SHARED_FILE
            ? "共享文件最大 50 MB"
            : !sharedMimeTypes.includes(mime)
              ? "此文件格式暂不支持共享"
              : undefined,
      });
    }
    if (["web", "video"].includes(m.type) && m.data?.url)
      result.push({
        ...common,
        id: `${m.id}:url`,
        kind: "url",
        name: m.type === "web" ? "网页链接" : "视频链接",
        value: m.data.url,
      });
    if (["text", "web"].includes(m.type) && m.data?.text?.trim())
      result.push({
        ...common,
        id: `${m.id}:text`,
        kind: "text",
        name: "文本材料",
        value: m.data.text,
        unavailable:
          m.data.text.length > 50000 ? "共享文本最多 5 万字" : undefined,
      });
    if (m.type === "video" && m.data?.transcript?.trim())
      result.push({
        ...common,
        id: `${m.id}:transcript`,
        kind: "transcript",
        name: "视频字幕 / 文稿",
        value: m.data.transcript,
        unavailable:
          m.data.transcript.length > 50000 ? "共享文稿最多 5 万字" : undefined,
      });
    if (m.type === "note")
      notes
        .filter((n) => n.workspaceId === workspace.id && n.moduleId === m.id)
        .forEach((n, noteIndex) => {
          if (n.content.trim())
            result.push({
              ...common,
              id: `${m.id}:note:${n.id}`,
              kind: "note",
              noteIndex,
              name: (
                n.content
                  .split("\n")[0]
                  .replace(/^#+\s*/, "")
                  .replace(/\*\*/g, "") || "学习笔记"
              ).slice(0, 200),
              value: n.content,
              unavailable:
                noteIndex > 99 || n.content.length > 50000
                  ? "共享笔记最多 5 万字，每模块最多 100 篇"
                  : undefined,
            });
        });
    return result;
  });
}
export function validateMaterialBindings(
  template: Template,
  materials: unknown,
): SharedMaterial[] {
  const parsed = sharedMaterialsSchema.parse(materials);
  for (const m of parsed) {
    const type = template.modules[m.moduleIndex]?.type;
    if (m.kind === "file" && !["pdf", "image", "video"].includes(type))
      throw Error("文件与模块不匹配");
    if (
      m.kind === "file" &&
      (type === "pdf"
        ? m.mime !== "application/pdf"
        : type === "image"
          ? !m.mime.startsWith("image/")
          : !m.mime.startsWith("video/"))
    )
      throw Error("文件类型与模块不匹配");
    if (m.kind === "url" && !["web", "video"].includes(type))
      throw Error("链接与模块不匹配");
    if (m.kind === "text" && !["text", "web"].includes(type))
      throw Error("文本与模块不匹配");
    if (m.kind === "note" && type !== "note") throw Error("笔记与模块不匹配");
    if (m.kind === "transcript" && type !== "video")
      throw Error("文稿与模块不匹配");
  }
  return parsed;
}
export async function attachMaterials(
  workspace: Workspace,
  template: Template,
  materials: unknown,
  download: (path: string) => Promise<Blob>,
) {
  const selected = validateMaterialBindings(template, materials);
  const resources: Resource[] = [];
  const notes: Note[] = [];
  const files = new Map<string, Resource>();
  for (const material of selected) {
    const mod = workspace.modules[material.moduleIndex];
    if (material.kind === "file") {
      let resource = files.get(material.path);
      if (!resource) {
        const blob = await download(material.path);
        if (blob.size !== material.size || blob.size > MAX_SHARED_FILE)
          throw Error("共享文件大小不匹配");
        resource = {
          id: uid(),
          name: material.name,
          version: uid(),
          file: new Blob([blob], { type: material.mime }),
          createdAt: Date.now(),
        };
        files.set(material.path, resource);
        resources.push(resource);
      }
      if (mod.type === "pdf") mod.resourceId = resource.id;
      else mod.data = { ...mod.data, mediaResourceId: resource.id };
    } else if (material.kind === "url")
      mod.data = { ...mod.data, url: safeUrl(material.url) };
    else if (material.kind === "text")
      mod.data = { ...mod.data, text: material.text };
    else if (material.kind === "transcript")
      mod.data = { ...mod.data, transcript: material.text };
    else
      notes.push({
        id: uid(),
        workspaceId: workspace.id,
        moduleId: mod.id,
        content: material.text,
        sources: [],
      });
  }
  return { workspace, resources, notes };
}
