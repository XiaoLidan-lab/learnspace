import { openDB } from "idb";
import type { Workspace, Note, Resource } from "./model";

export class LocalConflictError extends Error {
  constructor() {
    super(
      "其他标签页已修改或删除这些内容。本页内容未覆盖对方，请先下载未保存草稿，再刷新读取最新内容。",
    );
    this.name = "LocalConflictError";
  }
}

// Each page owns its read baseline. No schema/version change or user-data rewrite.
export function createLocalStore(name = "learnspace-v1") {
  const db = openDB(name, undefined, {
    upgrade(d) {
      for (const key of ["workspaces", "notes", "resources"])
        d.createObjectStore(key, { keyPath: "id" });
    },
  });
  type Table = "workspaces" | "notes";
  type RecordValue = Workspace | Note;
  const baseline = {
    workspaces: new Map<string, string | null>(),
    notes: new Map<string, string | null>(),
  };
  const conflictListeners = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const fingerprint = (value: RecordValue | undefined) =>
    value === undefined ? undefined : JSON.stringify(value);
  const read = async <T extends RecordValue>(table: Table): Promise<T[]> => {
    const rows = (await (await db).getAll(table)) as T[];
    // A later list/read (e.g. cloud copy collision checks) must not rebase old UI.
    for (const row of rows)
      if (!baseline[table].has(row.id))
        baseline[table].set(row.id, fingerprint(row)!);
    return rows;
  };
  type Change = { table: Table; id: string; value?: RecordValue };
  const write = (
    changes: Change[],
    resources: Resource[] = [],
    installation = false,
  ) => {
    // Freeze caller-owned values before awaiting the queue/transaction.
    const frozen = structuredClone(changes);
    return serial(async () => {
      const tx = (await db).transaction(
        ["workspaces", "notes", "resources"],
        "readwrite",
      );
      const applied: Change[] = [];
      try {
        for (const change of frozen) {
          const { table, id, value } = change;
          const expected = baseline[table].get(id);
          const desired = fingerprint(value);
          if (!installation && value !== undefined && desired === expected)
            continue;
          const actual = await tx.objectStore(table).get(id);
          // Installation is insert-only; deletions retain a page-local tombstone.
          if (
            (installation && actual !== undefined) ||
            expected === null ||
            fingerprint(actual) !== expected
          )
            throw new LocalConflictError();
          if (table === "notes" && value) {
            const owner = (value as Note).workspaceId;
            if (
              baseline.workspaces.has(owner) &&
              !(await tx.objectStore("workspaces").get(owner))
            )
              throw new LocalConflictError();
          }
          if (value === undefined) await tx.objectStore(table).delete(id);
          else await tx.objectStore(table).put(value);
          applied.push(change);
        }
        for (const resource of resources)
          await tx.objectStore("resources").add(resource);
        await tx.done;
        // Never advance a baseline on an aborted transaction.
        for (const { table, id, value } of applied)
          baseline[table].set(
            id,
            value === undefined ? null : fingerprint(value)!,
          );
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* already completed/aborted */
        }
        await tx.done.catch(() => {});
        if (error instanceof LocalConflictError)
          for (const listener of conflictListeners) listener();
        throw error;
      }
    });
  };
  return {
    onConflict(listener: () => void) {
      conflictListeners.add(listener);
      return () => {
        conflictListeners.delete(listener);
      };
    },
    saveInstallation: (
      workspace: Workspace,
      notes: Note[],
      resources: Resource[],
    ) =>
      write(
        [
          { table: "workspaces", id: workspace.id, value: workspace },
          ...notes.map((value) => ({
            table: "notes" as const,
            id: value.id,
            value,
          })),
        ],
        resources,
        true,
      ),
    saveSnapshot: (workspaces: Workspace[], notes: Note[]) =>
      write([
        ...workspaces.map((value) => ({
          table: "workspaces" as const,
          id: value.id,
          value,
        })),
        ...notes.map((value) => ({
          table: "notes" as const,
          id: value.id,
          value,
        })),
      ]),
    workspaces: () => read<Workspace>("workspaces"),
    notes: () => read<Note>("notes"),
    save: (value: Workspace) =>
      write([{ table: "workspaces", id: value.id, value }]),
    remove: (id: string) => write([{ table: "workspaces", id }]),
    saveNote: (value: Note) => write([{ table: "notes", id: value.id, value }]),
    removeNote: (id: string) => write([{ table: "notes", id }]),
    resources: async () =>
      (await db).getAll("resources") as Promise<Resource[]>,
    removeResource: (id: string) => serial(async () => {
      await (await db).delete("resources", id);
    }),
    saveResource: async (r: Resource) => {
      const limit = r.file.type.startsWith("video/") ? 200 : 50;
      if (r.file.size > limit * 1024 * 1024)
        throw Error(`单个文件不能超过 ${limit} MB`);
      // Resources are immutable, newly assigned IDs. Never overwrite an existing file.
      await (await db).add("resources", r);
    },
  };
}
export const store = createLocalStore();
