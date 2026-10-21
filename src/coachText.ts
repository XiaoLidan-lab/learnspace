import type { Workspace } from "./model";
// Keep provider prose readable without showing internal object identifiers.
// Stored answers and evidence excerpts remain unchanged.
export function coachText(text: string, w: Workspace) {
  let result = text;
  for (const object of [
    ...w.modules,
    ...(w.tasks || []),
    ...(w.tasks || []).flatMap((t) => t.steps),
  ])
    result = result.split(object.id).join(object.title);
  return result
    .replace(/\bmoduleId\s*[:：=]\s*/gi, "模块：")
    .replace(/\bhasArtifacts\s*[:：=]\s*true/gi, "已有成果")
    .replace(/\bhasArtifacts\s*[:：=]\s*false/gi, "尚无成果")
    .replace(/\bdone\s*[:：=]\s*true/gi, "步骤已完成")
    .replace(/\bdone\s*[:：=]\s*false/gi, "步骤待完成")
    .replace(/\bmastery\b/g, "掌握证据");
}
