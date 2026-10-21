import { definitions, type ModuleType } from "./definitions.js";
import { defaultCustomConfig } from "./customAI.js";
import { nextPosition } from "./layout.js";
import type { Template, Workspace } from "./model.js";
import type { LayoutPlanning } from "./layoutPlan.js";
export function draftWorkspace(t: Template): Workspace {
  return {
    id: "draft",
    title: t.title,
    description: t.description,
    createdAt: 0,
    updatedAt: 0,
    modules: t.modules.map((m, i) => ({
      ...m,
      id: m.instanceId || `preview-${i}`,
    })),
    connections: t.connections || [],
  };
}
export function addDraftModule(
  t: Template,
  plan: LayoutPlanning,
  type: ModuleType,
) {
  if (t.modules.length >= 24) throw Error("最多24个模块");
  if (t.version === 1 && type === "custom-ai")
    throw Error("V1布局调整不支持新增自定义配置，请从首页新建AI组合方案");
  const d = definitions[type],
    id = `m${Math.max(0, ...t.modules.map((m) => Number(m.instanceId?.slice(1)) || 0)) + 1}`;
  const module = {
    type,
    title: d.name,
    layout: nextPosition(draftWorkspace(t).modules, d.size.w, d.size.h),
    ...(t.version === 2 ? { instanceId: id } : {}),
    ...(type === "custom-ai" ? { customConfig: defaultCustomConfig() } : {}),
  };
  return {
    template: { ...t, modules: [...t.modules, module] },
    plan: {
      ...plan,
      ...(t.version === 2
        ? {
            moduleRoles: [
              ...(plan.moduleRoles || []),
              { moduleId: id, purpose: d.description },
            ],
          }
        : {}),
    },
  };
}
export function removeDraftModule(
  t: Template,
  plan: LayoutPlanning,
  index: number,
) {
  const removed = t.modules[index];
  const modules = t.modules.filter((_, i) => i !== index);
  return {
    template: {
      ...t,
      modules,
      ...(t.connections
        ? {
            connections: t.connections.filter(
              (e) =>
                e.source.moduleId !== removed.instanceId &&
                e.target.moduleId !== removed.instanceId,
            ),
          }
        : {}),
    },
    plan: {
      ...plan,
      ...(plan.moduleRoles
        ? {
            moduleRoles: plan.moduleRoles.filter(
              (r) => r.moduleId !== removed.instanceId,
            ),
          }
        : {}),
      steps: plan.steps.map((s) => ({
        ...s,
        moduleTypes: s.moduleTypes.filter((type) =>
          modules.some((m) => m.type === type),
        ),
      })),
    },
  };
}
