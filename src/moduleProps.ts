import type {
  ContentKind,
  Mod,
  Note,
  Resource,
  Source,
  ModuleType,
  ModuleData,
} from "./model";
import type { WorkspaceBus } from "./events";
export type ModuleProps = {
  generation?: {
    tasks: import("./generationTasks").GenerationTasks;
    owner: string;
    read: () => { mod: Mod; ctx: import("./connections").ReadContext } | undefined;
  };
  mod: Mod;
  workspace: import("./model").Workspace;
  setConnections: (edges: import("./connections").Connection[]) => void;
  taskId?: string;
  noteTargets: { id: string; title: string }[];
  saveCustomNote: (targetId: string, runId: string) => Promise<void>;
  configure: (config: import("./customAI").CustomConfig) => void;
  mutate: (transform: (mod: Mod) => Partial<Mod>) => void;
  resources: Resource[];
  notes: Note[];
  workspaceId: string;
  bus: WorkspaceBus;
  update: (p: Partial<Mod>) => void;
  upload: (f: File) => Promise<void>;
  saveResource: (f: File) => Promise<string>;
  send: (
    type: ModuleType,
    text: string,
    source?: Source,
    contentKind?: ContentKind,
  ) => void;
  saveNote: (n: Note) => Promise<boolean>;
  deleteNote: (id: string) => void;
  jump: (s: Source) => void;
  notify: (s: string) => void;
};
export function patchData(mod: Mod, p: Partial<ModuleData>): Partial<Mod> {
  return { data: { ...mod.data, ...p } };
}
