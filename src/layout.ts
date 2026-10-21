import { uid, type Mod, type Template } from "./model.js";
import { definitions } from "./definitions.js";
import { isUtilityTool } from "./utilityTools.js";
export type LayoutPreset =
  | "双栏"
  | "三栏"
  | "四宫格"
  | "主次"
  | "自适应"
  | "按用途";
export function overlaps(a: Mod["layout"], b: Mod["layout"]) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
export function canPlace(modules: Mod[], id: string, layout: Mod["layout"]) {
  const mod = modules.find((m) => m.id === id);
  return (
    layout.x >= 0 &&
    layout.y >= 0 &&
    layout.x + layout.w <= 12 &&
    layout.w >= 3 &&
    layout.h >= 3 &&
    !modules.some(
      (m) =>
        m.id !== id &&
        (!mod?.group || m.group !== mod.group) &&
        overlaps(layout, m.layout),
    )
  );
}
export function containers(modules: Mod[]) {
  return modules.filter(
    (m, i) => !m.group || modules.findIndex((x) => x.group === m.group) === i,
  );
}
export function arrange(modules: Mod[], preset: LayoutPreset): Mod[] {
  if (modules.some((m) => isUtilityTool(m.type))) {
    const main = arrange(
      modules.filter((m) => !isUtilityTool(m.type)),
      preset,
    );
    return parkUtilityModules(
      modules.map((m) => main.find((x) => x.id === m.id) || m),
    );
  }
  if (preset === "按用途") return arrangeForLearning(modules);
  const boxes = containers(modules);
  const positions = new Map<string, Mod["layout"]>();
  let y = 0;
  const cols =
    preset === "三栏"
      ? 3
      : preset === "四宫格" || preset === "双栏"
        ? 2
        : preset === "自适应"
          ? Math.min(3, Math.max(1, boxes.length))
          : 2;
  for (let i = 0; i < boxes.length; i += cols) {
    const row = boxes.slice(i, i + cols);
    const h = Math.max(6, ...row.map((m) => definitions[m.type].size.h));
    row.forEach((m, j) => {
      let x = (j * 12) / cols,
        w = 12 / cols;
      if (preset === "主次") {
        x = j === 0 ? 0 : 8;
        w = j === 0 ? 8 : 4;
      }
      positions.set(m.group || m.id, { x, y, w, h });
    });
    y += h;
  }
  return modules.map((m) => ({
    ...m,
    layout: { ...positions.get(m.group || m.id)! },
  }));
}
export function nextPosition(modules: Mod[], w: number, h: number) {
  for (let y = 0; y <= 100; y++) {
    for (let x = 0; x <= 12 - w; x++) {
      const layout = { x, y, w, h };
      if (!modules.some((m) => overlaps(layout, m.layout))) return layout;
    }
  }
  throw Error("画布已满，请调整布局或移除模块");
}
// Keep compact legacy layout metadata for templates; tools have no canvas body.
export function parkUtilityModules(modules: Mod[]): Mod[] {
  if (!modules.some((m) => isUtilityTool(m.type))) return modules;
  const placed = modules.filter((m) => !isUtilityTool(m.type));
  const parked = new Map<string, Mod>();
  for (const m of modules.filter((m) => isUtilityTool(m.type))) {
    const next = { ...m, group: undefined, layout: nextPosition(placed, 3, 3) };
    placed.push(next);
    parked.set(m.id, next);
  }
  return modules.map((m) => parked.get(m.id) || m);
}
export function stackModules(
  modules: Mod[],
  sourceId: string,
  targetId: string,
) {
  const source = modules.find((m) => m.id === sourceId),
    target = modules.find((m) => m.id === targetId);
  if (
    !source ||
    !target ||
    source.locked ||
    target.locked ||
    source.id === target.id
  )
    return modules;
  const group = target.group || uid();
  return modules.map((m) =>
    m.id === sourceId ||
    m.id === targetId ||
    (source.group && m.group === source.group) ||
    (target.group && m.group === target.group)
      ? { ...m, group, layout: { ...target.layout } }
      : m,
  );
}
export function unstack(modules: Mod[], id: string) {
  const mod = modules.find((m) => m.id === id);
  if (!mod?.group) return modules;
  const remaining = modules.filter((m) => m.id !== id);
  const layout = nextPosition(remaining, mod.layout.w, mod.layout.h);
  const result = modules.map((m) =>
    m.id === id ? { ...m, group: undefined, layout } : m,
  );
  const peers = result.filter((m) => m.group === mod.group);
  return peers.length === 1
    ? result.map((m) => (m.id === peers[0].id ? { ...m, group: undefined } : m))
    : result;
}
export function splitModules(
  modules: Mod[],
  id: string,
  targetId: string,
  side: "左" | "右" | "上" | "下",
) {
  let clean = modules;
  const source = clean.find((m) => m.id === id),
    target = clean.find((m) => m.id === targetId);
  if (!source || !target || source.locked || target.locked) return modules;
  if (source.group) clean = unstack(clean, id);
  if (target.group) clean = unstack(clean, targetId);
  const base = clean.find((m) => m.id === targetId)!.layout;
  let a: Mod["layout"], b: Mod["layout"];
  if (side === "左" || side === "右") {
    if (base.w < 6) throw Error("目标模块至少需要 6 列宽才能左右分屏");
    const half = Math.floor(base.w / 2);
    a = { ...base, w: half };
    b = { ...base, x: base.x + half, w: base.w - half };
  } else {
    if (base.h < 6) throw Error("目标模块至少需要 6 行高才能上下分屏");
    const half = Math.floor(base.h / 2);
    a = { ...base, h: half };
    b = { ...base, y: base.y + half, h: base.h - half };
  }
  const sourceLayout = side === "左" || side === "上" ? a : b,
    targetLayout = side === "左" || side === "上" ? b : a;
  return clean.map((m) =>
    m.id === id
      ? { ...m, group: undefined, layout: sourceLayout }
      : m.id === targetId
        ? { ...m, group: undefined, layout: targetLayout }
        : m,
  );
}
export function applyPlan(current: Mod[], template: Template) {
  const used = new Set<string>();
  return template.modules.map((p) => {
    const old = p.instanceId
      ? current.find((m) => m.id === p.instanceId && m.type === p.type)
      : undefined;
    if (p.instanceId && !old) throw Error("方案引用了不存在的模块");
    if (old && used.has(old.id)) throw Error("方案重复引用模块");
    if (old) used.add(old.id);
    return {
      ...old,
      type: p.type,
      title: p.title,
      layout: { ...p.layout },
      group: p.group,
      locked: p.locked,
      settings: p.settings || old?.settings,
      id: old?.id || uid(),
    };
  });
}
export function restoreStructure(snapshot: Mod[], cache: Map<string, Mod>) {
  return snapshot.map((m) => {
    const live = cache.get(m.id);
    return {
      ...m,
      ...live,
      id: m.id,
      type: m.type,
      title: m.title,
      layout: { ...m.layout },
      group: m.group,
      locked: m.locked,
    };
  });
}

// This is a layout operation only: preserve instances, groups, content and connections.
export function arrangeForLearning(modules: Mod[]): Mod[] {
  if (modules.some((m) => isUtilityTool(m.type)))
    return arrange(modules, "按用途");
  const boxes = containers(modules);
  if (!boxes.length) return modules;
  const reading = (m: Mod) =>
    modules.some(
      (x) =>
        (x.id === m.id || (m.group && x.group === m.group)) &&
        ["pdf", "web", "video"].includes(x.type),
    );
  const primary =
    boxes.find(reading) ||
    boxes.find((m) => m.type === "quiz") ||
    boxes.find((m) => ["note", "mindmap", "text"].includes(m.type)) ||
    boxes[0];
  const positions = new Map<string, Mod["layout"]>();
  const put = (m: Mod, x: number, y: number, w: number, h: number) => {
    if (y > 100)
      throw Error("模块过多，无法按用途排列，请先移除部分模块或选择其他布局");
    positions.set(m.group || m.id, { x, y, w, h });
  };
  const rest = boxes.filter((m) => m !== primary);
  const helpers = rest.filter((m) => !reading(m)).slice(0, 2);
  const height = reading(primary) ? 16 : 14;
  put(primary, 0, 0, helpers.length ? 8 : 12, height);
  helpers.forEach((m, i) => put(m, 8, i * (height / 2), 4, height / 2));
  let y = height;
  const remaining = rest.filter((m) => !helpers.includes(m));
  for (let i = 0; i < remaining.length; ) {
    const a = remaining[i++];
    if (reading(a)) {
      put(a, 0, y, 12, 14);
      y += 14;
    } else {
      const b =
        remaining[i] && !reading(remaining[i]) ? remaining[i++] : undefined;
      put(a, 0, y, b ? 6 : 12, 8);
      if (b) put(b, 6, y, 6, 8);
      y += 8;
    }
  }
  return modules.map((m) => ({
    ...m,
    layout: { ...positions.get(m.group || m.id)! },
  }));
}
