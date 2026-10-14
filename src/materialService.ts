import type { SupabaseClient } from "@supabase/supabase-js";
import { uid, type Template } from "./model";
import {
  MATERIAL_BUCKET,
  validateMaterialBindings,
  type SharedMaterial,
  type MaterialCandidate,
} from "./sharedMaterials";
export async function uploadMaterials(
  client: SupabaseClient,
  userId: string,
  templateId: string,
  template: Template,
  candidates: MaterialCandidate[],
  selected: string[],
  uploadedPaths: string[],
) {
  const picked = candidates.filter((c) => selected.includes(c.id));
  if (picked.length !== selected.length || picked.some((c) => c.unavailable))
    throw Error("所选资料已变化，请重新选择");
  const total = picked.reduce((n, c) => n + (c.resource?.file.size || 0), 0);
  if (total > 100 * 1024 * 1024) throw Error("附带文件合计不能超过 100 MB");
  const materials: SharedMaterial[] = [];
  const files = new Map<string, string>();
  const uploads: { path: string; file: Blob; mime: string }[] = [];
  for (const c of picked) {
    const base = { moduleIndex: c.moduleIndex, name: c.name };
    if (c.kind === "file" && c.resource) {
      let path = files.get(c.resource.id);
      const mime =
        c.resource.file.type ||
        (template.modules[c.moduleIndex].type === "pdf"
          ? "application/pdf"
          : "");
      if (!path) {
        path = `${userId}/${templateId}/${uid()}`;
        uploads.push({ path, file: c.resource.file, mime });
        files.set(c.resource.id, path);
      }
      materials.push({
        ...base,
        kind: "file",
        path,
        mime,
        size: c.resource.file.size,
      });
    } else if (c.kind === "url")
      materials.push({ ...base, kind: "url", url: c.value! });
    else if (c.kind === "note")
      materials.push({
        ...base,
        kind: "note",
        noteIndex: c.noteIndex!,
        text: c.value!,
      });
    else if (c.kind === "text" || c.kind === "transcript")
      materials.push({ ...base, kind: c.kind, text: c.value! });
  }
  const validated = validateMaterialBindings(template, materials);
  for (const upload of uploads) {
    const { error } = await client.storage
      .from(MATERIAL_BUCKET)
      .upload(upload.path, upload.file, {
        contentType: upload.mime,
        upsert: false,
      });
    if (error)
      throw Error(
        "共享资料上传失败，请确认已执行 004_shared_materials.sql 并检查网络。",
      );
    uploadedPaths.push(upload.path);
  }
  return validated;
}
