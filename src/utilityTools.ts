import type { Mod, ModuleType } from "./model.js";
export const utilityTypes = ["todo", "calendar", "pomodoro"] as const;
export function isUtilityTool(
  type: ModuleType,
): type is (typeof utilityTypes)[number] {
  return (utilityTypes as readonly string[]).includes(type);
}
export function timerRemaining(mod: Mod, now: number) {
  const timer = mod.data?.timer;
  return Math.max(
    0,
    timer?.endsAt
      ? Math.ceil((timer.endsAt - now) / 1000)
      : (timer?.remaining ?? (mod.settings?.focusMinutes || 25) * 60),
  );
}
export function timerLabel(mod: Mod, now: number) {
  const seconds = timerRemaining(mod, now);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
