/** Share only in-flight work. Each consumer retains independent cancellation. */
export function createSharedRequests<T>() {
  type Entry = {
    controller: AbortController;
    promise: Promise<T>;
    waiters: number;
    settled: boolean;
  };
  const pending = new Map<string, Entry>();
  return (key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const aborted = () => new DOMException("Aborted", "AbortError");
    if (signal?.aborted) return Promise.reject(aborted());
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        waiters: 0,
        settled: false,
        promise: Promise.resolve().then(() => {
          if (controller.signal.aborted) throw aborted();
          return run(controller.signal);
        }),
      };
      pending.set(key, entry);
      const current = entry;
      const finish = () => {
        current.settled = true;
        if (pending.get(key) === current) pending.delete(key);
      };
      void current.promise.then(finish, finish);
    }
    const current = entry;
    current.waiters++;
    return new Promise<T>((resolve, reject) => {
      let active = true;
      const release = () => {
        active = false;
        signal?.removeEventListener("abort", cancel);
        current.waiters--;
        if (!current.waiters && !current.settled) {
          current.controller.abort();
          if (pending.get(key) === current) pending.delete(key);
        }
      };
      const cancel = () => {
        if (!active) return;
        release();
        reject(aborted());
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      void current.promise.then(
        value => { if (active) { release(); resolve(value); } },
        error => { if (active) { release(); reject(error); } },
      );
    });
  };
}
