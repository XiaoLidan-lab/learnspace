import type { ModuleType } from "./definitions";
import type { Source } from "./model";
export type SelectionContext = Source & {
  text: string;
  moduleId: string;
  createdAt: number;
};
export type WorkspaceEvents = {
  "selection.changed": SelectionContext;
  "selection.cleared": { moduleId?: string };
  "content.insert": {
    targetId: string;
    type: ModuleType;
    text: string;
    source?: Source;
    automatic?: boolean;
  };
  "source.navigate": Source;
  "module.focus": { moduleId: string };
};
export class WorkspaceBus {
  readonly workspaceId: string;
  selection: SelectionContext | null = null;
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
    }
    if (event === "selection.cleared") this.selection = null;
    this.emitting.add(event);
    try {
      this.handlers.get(event)?.forEach((h) => h(payload));
    } finally {
      this.emitting.delete(event);
    }
  }
  dispose() {
    this.handlers.clear();
    this.selection = null;
  }
}
