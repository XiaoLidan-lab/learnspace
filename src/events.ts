import type { ModuleType } from "./definitions";
import type { ContentKind, Source } from "./model";
export type SelectionContext = Source & {
  text: string;
  moduleId: string;
  createdAt: number;
};
export type WorkspaceEvents = {
  "material.edit": { moduleId: string };
  "material.action": {
    moduleId: string;
    type: "chat" | "translate" | "mindmap" | "cards" | "quiz";
    range: "selection" | "document";
  };
  "connection.request": {
    moduleId: string;
    port: "text" | "selection" | "output" | "note";
    noteId?: string;
  };
  "selection.changed": SelectionContext;
  "selection.cleared": { moduleId?: string };
  "content.insert": {
    targetId: string;
    type: ModuleType;
    text: string;
    source?: Source;
    automatic?: boolean;
    contentKind?: ContentKind;
  };
  "source.navigate": Source;
  "file.navigate": Source;
  "module.focus": { moduleId: string };
  "module.reveal": { moduleId: string };
};
export class WorkspaceBus {
  readonly workspaceId: string;
  selection: SelectionContext | null = null;
  readonly selections: Record<string, SelectionContext> = {};
  readonly pendingRuns = new Set<string>();
  private handlers = new Map<
    keyof WorkspaceEvents,
    Set<(payload: any) => void>
  >();
  private emitting = new Set<string>();
  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }
  on<K extends keyof WorkspaceEvents>(
    event: K,
    handler: (p: WorkspaceEvents[K]) => void,
  ) {
    const set = this.handlers.get(event) || new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler);
    };
  }
  emit<K extends keyof WorkspaceEvents>(event: K, payload: WorkspaceEvents[K]) {
    if (this.emitting.has(event)) return;
    if (event === "selection.changed") {
      const next = payload as SelectionContext;
      if (
        this.selection?.moduleId === next.moduleId &&
        this.selection.text === next.text &&
        this.selection.page === next.page &&
        this.selection.timestamp === next.timestamp &&
        this.selection.resourceId === next.resourceId &&
        this.selection.version === next.version &&
        this.selection.start === next.start &&
        this.selection.end === next.end &&
        this.selection.url === next.url
      )
        return;
      this.selection = next;
      this.selections[next.moduleId] = next;
    }
    if (event === "selection.cleared") {
      const { moduleId } = payload as { moduleId?: string };
      if (!moduleId || this.selection?.moduleId === moduleId)
        this.selection = null;
      // Keep each source's last explicit fragment when focus moves to another tool.
      if (!moduleId)
        for (const id of Object.keys(this.selections))
          delete this.selections[id];
    }
    this.emitting.add(event);
    try {
      this.handlers.get(event)?.forEach((h) => h(payload));
    } finally {
      this.emitting.delete(event);
    }
  }
  dispose() {
    this.handlers.clear();
    this.pendingRuns.clear();
    this.selection = null;
    for (const id of Object.keys(this.selections)) delete this.selections[id];
  }
}
