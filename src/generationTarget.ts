import type { Workspace, Note, Resource } from "./model";
import { projectWorkspace, scopedNotes } from "./tasks";

export type GenerationTarget = {
  workspaceId: string;
  moduleId: string;
  taskId?: string;
  owner?: string;
};
export function readGenerationTarget(
  state: { workspaces: Workspace[]; notes: Note[]; resources: Resource[]; owner?: string; blocked: boolean },
  target: GenerationTarget,
) {
  if (state.blocked || state.owner !== target.owner) return undefined;
  const raw = state.workspaces.find(w => w.id === target.workspaceId);
  if (!raw || (target.taskId && !raw.tasks?.some(t => t.id === target.taskId))) return undefined;
  const scoped = { ...raw, activeTaskId: target.taskId };
  const workspace = projectWorkspace(scoped);
  const mod = workspace.modules.find(m => m.id === target.moduleId);
  return mod ? { mod, ctx: {
    workspace,
    notes: scopedNotes(scoped, state.notes),
    resources: state.resources,
    selection: null,
  } } : undefined;
}
