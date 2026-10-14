import { uid, type Mod, type Template } from "./model";
import { definitions } from "./definitions";
export type LayoutPreset = "双栏" | "三栏" | "四宫格" | "主次" | "自适应";
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
      : current.find((m) => m.type === p.type && !used.has(m.id));
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
