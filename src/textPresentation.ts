import type { Mod } from "./model";
/** Legacy sticky is retained as the compact presentation discriminator. */
export function withTextPresentation(mod: Mod, compact: boolean): Mod {
  if (mod.type !== "text" && mod.type !== "sticky") return mod;
  return { ...mod, type: compact ? "sticky" : "text" };
}
