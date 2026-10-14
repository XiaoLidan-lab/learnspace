import type {
  Mod,
  Note,
  Resource,
  Source,
  ModuleType,
  ModuleData,
} from "./model";
import type { WorkspaceBus } from "./events";
export type ModuleProps = {
  mod: Mod;
  resources: Resource[];
  notes: Note[];
  workspaceId: string;
  bus: WorkspaceBus;
  update: (p: Partial<Mod>) => void;
  upload: (f: File) => Promise<void>;
  saveResource: (f: File) => Promise<string>;
  send: (type: ModuleType, text: string, source?: Source) => void;
  saveNote: (n: Note) => void;
  deleteNote: (id: string) => void;
  jump: (s: Source) => void;
  notify: (s: string) => void;
};
export function patchData(mod: Mod, p: Partial<ModuleData>): Partial<Mod> {
  return { data: { ...mod.data, ...p } };
}
