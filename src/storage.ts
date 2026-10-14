import { openDB } from "idb";
import type { Workspace, Note, Resource } from "./model";
const db = openDB("learnspace-v1", 1, {
  upgrade(d) {
    d.createObjectStore("workspaces", { keyPath: "id" });
    d.createObjectStore("notes", { keyPath: "id" });
    d.createObjectStore("resources", { keyPath: "id" });
  },
});
export const store = {
  saveInstallation: async (
    workspace: Workspace,
    notes: Note[],
    resources: Resource[],
  ) => {
    const tx = (await db).transaction(
      ["workspaces", "notes", "resources"],
      "readwrite",
    );
    try {
      await Promise.all([
        Promise.resolve().then(() =>
          tx.objectStore("workspaces").put(workspace),
        ),
        ...notes.map((n) =>
          Promise.resolve().then(() => tx.objectStore("notes").put(n)),
        ),
        ...resources.map((r) =>
          Promise.resolve().then(() => tx.objectStore("resources").put(r)),
        ),
      ]);
      await tx.done;
    } catch (e) {
      try {
        tx.abort();
      } catch {}
      await tx.done.catch(() => {});
      throw e;
    }
  },
  saveSnapshot: async (workspaces: Workspace[], notes: Note[]) => {
    const tx = (await db).transaction(["workspaces", "notes"], "readwrite");
    await Promise.all([
      ...workspaces.map((w) => tx.objectStore("workspaces").put(w)),
      ...notes.map((n) => tx.objectStore("notes").put(n)),
    ]);
    await tx.done;
  },
  workspaces: async () =>
    (await db).getAll("workspaces") as Promise<Workspace[]>,
  save: async (w: Workspace) => {
    await (await db).put("workspaces", w);
  },
  remove: async (id: string) => {
    await (await db).delete("workspaces", id);
  },
  notes: async () => (await db).getAll("notes") as Promise<Note[]>,
  saveNote: async (n: Note) => {
    await (await db).put("notes", n);
  },
  removeNote: async (id: string) => {
    await (await db).delete("notes", id);
  },
  resources: async () => (await db).getAll("resources") as Promise<Resource[]>,
  saveResource: async (r: Resource) => {
    const limit = r.file.type.startsWith("video/") ? 200 : 50;
    if (r.file.size > limit * 1024 * 1024)
      throw Error(`单个文件不能超过 ${limit} MB`);
    await (await db).put("resources", r);
  },
};
