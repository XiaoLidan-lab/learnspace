export type GenerationState = {
  busy: boolean;
  error: string;
  progress: string;
  partial: string;
};
const idle: GenerationState = { busy: false, error: "", progress: "", partial: "" };

/** Application-lifetime tasks: navigation unsubscribes a view, not its request. */
export class GenerationTasks {
  private jobs = new Map<string, {
    state: GenerationState;
    controller: AbortController;
    valid: () => boolean;
    done?: Promise<void>;
  }>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = (key: string) => this.jobs.get(key)?.state || idle;
  private emit() { this.listeners.forEach(listener => listener()); }
  hasRunning() { return [...this.jobs.values()].some(job => job.state.busy); }
  run(
    key: string,
    valid: () => boolean,
    execute: (signal: AbortSignal, report: (patch: Partial<GenerationState>) => void) => Promise<void | (() => void)>,
  ): Promise<void> {
    const previous = this.jobs.get(key);
    if (previous?.state.busy) return previous.done || Promise.resolve();
    const job = { state: { ...idle, busy: true }, controller: new AbortController(), valid, done: undefined as Promise<void> | undefined };
    this.jobs.set(key, job);
    const current = () => this.jobs.get(key) === job && !job.controller.signal.aborted;
    const report = (patch: Partial<GenerationState>) => {
      if (current()) { job.state = { ...job.state, ...patch }; this.emit(); }
    };
    job.done = Promise.resolve().then(async () => {
      if (!current()) return;
      if (!valid()) throw Error("工作台、模块或学习材料已变化，请重新生成");
      const commit = await execute(job.controller.signal, report);
      if (!current()) return;
      if (!valid()) throw Error("工作台、模块或学习材料已变化，请重新生成");
      // Mark finished before committing React state; the result itself changes
      // the input fingerprint and must not be mistaken for an external edit.
      job.state = { ...job.state, busy: false };
      commit?.();
    }).then(() => {
      report({ ...idle });
      job.valid = () => true;
    }, error => {
      report({ ...idle, error: error instanceof Error ? error.message : "生成失败，请重试" });
      job.valid = () => true;
    });
    this.emit();
    return job.done;
  }
  cancel(key: string, error = "") {
    const job = this.jobs.get(key);
    if (!job) return;
    job.controller.abort();
    job.valid = () => true;
    job.state = { ...idle, error };
    this.emit();
  }
  clearPartial(key: string) {
    const job = this.jobs.get(key);
    if (job) { job.state = { ...job.state, partial: "" }; this.emit(); }
  }
  reconcile() {
    for (const [key, job] of this.jobs) {
      if (!job.state.busy) continue;
      let valid = false;
      try { valid = job.valid(); } catch { /* Changed or removed source. */ }
      if (!valid) this.cancel(key, "工作台、模块或学习材料已变化，已停止旧任务，请重新生成");
    }
  }
  dispose() {
    this.jobs.forEach(job => job.controller.abort());
    this.jobs.clear();
    this.emit();
  }
}
