import type { Workspace, Note } from "./model";

const prefix = "learnspace-unsaved-v1:";
export type LocalDraft = {
  savedAt: number;
  workspaces: Workspace[];
  notes: Note[];
};

// A distinct key per page load also protects drafts when a browser duplicates a tab.
export function createDraftJournal(
  storage: Storage | (() => Storage),
  id: string,
) {
  const key = prefix + id;
  const getStorage = () =>
    typeof storage === "function" ? storage() : storage;
  return {
    retain(workspaces: Workspace[], notes: Note[]) {
      const text = JSON.stringify({ savedAt: Date.now(), workspaces, notes });
      getStorage().setItem(key, text); // Synchronous: pagehide cannot rely on IndexedDB finishing.
      return text;
    },
    acknowledge(text: string) {
      // A late save must not discard a newer pending draft.
      if (getStorage().getItem(key) === text) getStorage().removeItem(key);
    },
    drafts(): LocalDraft[] {
      const storage = getStorage();
      const result: LocalDraft[] = [];
      for (let i = 0; i < storage.length; i++) {
        const candidate = storage.key(i);
        if (!candidate?.startsWith(prefix)) continue;
        const value = JSON.parse(storage.getItem(candidate)!);
        if (Array.isArray(value.workspaces) && Array.isArray(value.notes))
          result.push(value);
      }
      return result;
    },
  };
}
