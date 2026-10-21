import type { Mod, Workspace } from "./model.js";
import type { z } from "zod";
import type { connectionSchema } from "./customAI.js";
type Connection = z.infer<typeof connectionSchema>;
export function materialEdges(mod: Mod, workspace: Workspace): Connection[] {
  if (mod.data?.flow?.materials?.some((e) => e.target.moduleId !== mod.id))
    throw Error("学习材料不属于当前工具，请重新选择");
  return (
    mod.data?.flow?.materials ??
    (workspace.connections || []).filter((e) => e.target.moduleId === mod.id)
  );
}
export function workspaceMaterials(workspace: Workspace): Connection[] {
  return workspace.modules.flatMap((m) => materialEdges(m, workspace));
}
