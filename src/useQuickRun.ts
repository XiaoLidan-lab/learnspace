import { useEffect } from "react";
import type { ModuleProps } from "./moduleProps";
// One-shot, in-memory user intent. Never replayed on refresh or task switching.
export function scheduleQuickRun(
  pending: Set<string>,
  id: string,
  busy: boolean,
  execute: () => void,
) {
  let active = true;
  queueMicrotask(() => {
    if (active && !busy && pending.delete(id)) execute();
  });
  return () => {
    active = false;
  };
}
export function useQuickRun(
  p: ModuleProps,
  busy: boolean,
  execute: () => void,
) {
  useEffect(() => scheduleQuickRun(p.bus.pendingRuns, p.mod.id, busy, execute));
}
