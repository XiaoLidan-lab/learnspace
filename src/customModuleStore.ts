import { openDB } from "idb";
import { customConfigSchema, type CustomConfig } from "./customAI.js";
import { templateSchema, uid, type Mod } from "./model.js";
import { nextPosition } from "./layout.js";
const db = openDB("learnspace-custom-modules-v1", 1, {
  upgrade(d) {
    d.createObjectStore("modules", { keyPath: "id" });
  },
});
export type SavedCustomModule = {
  id: string;
  config: CustomConfig;
  updatedAt: number;
};
export function reusableConfig(input: unknown): CustomConfig {
  const config = customConfigSchema.parse(input);
  // Reuse template privacy checks. Never accept runtime, content, or credentials.
  templateSchema.parse({
    version: 2,
    title: config.name,
    description: "",
    modules: [
      {
        instanceId: "m1",
        type: "custom-ai",
        title: config.name,
        customConfig: config,
        layout: { x: 0, y: 0, w: 6, h: 10 },
      },
    ],
    connections: [],
  });
  return structuredClone(config);
}
export const customModuleStore = {
  async list(): Promise<SavedCustomModule[]> {
    const rows = await (await db).getAll("modules");
    return rows
      .map((r) => ({ ...r, config: reusableConfig(r.config) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async save(config: CustomConfig, id: string = uid()) {
    const row = { id, config: reusableConfig(config), updatedAt: Date.now() };
    await (await db).put("modules", row);
    return row;
  },
  async remove(id: string) {
    await (await db).delete("modules", id);
  },
};
export function instantiateCustomModule(
  input: CustomConfig,
  modules: Mod[],
): Mod {
  const config = reusableConfig(input);
  return {
    id: uid(),
    type: "custom-ai",
    title: config.name,
    customConfig: config,
    layout: nextPosition(modules, 6, 12),
  };
}
