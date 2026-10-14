import { useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  Sparkles,
  ShieldCheck,
  GripVertical,
  Copy,
  Lock,
  Unlock,
  Maximize2,
  Minimize2,
  Columns2,
  Layers,
  Split,
  X,
  Pencil,
} from "lucide-react";
import {
  types,
  categories,
  MAX_MODULES,
  definitions,
  type ModuleType,
} from "./definitions";
import { registry, ModuleIcon } from "./registry";
import { ModuleBody } from "./ModuleBody";
import type { Mod, Workspace } from "./model";
import type { ModuleProps } from "./moduleProps";
import {
  arrange,
  canPlace,
  stackModules,
  unstack,
  splitModules,
  type LayoutPreset,
} from "./layout";
type Props = {
  workspace: Workspace;
  edit: boolean;
  add: (type: ModuleType, position?: { x: number; y: number }) => void;
  change: (modules: Mod[]) => void;
  duplicate: (mod: Mod) => void;
  moduleProps: (mod: Mod) => ModuleProps;
  notify: (s: string) => void;
  ai: () => void;
};
export function WorkspaceEditor({
  workspace,
  edit,
  add,
  change,
  duplicate,
  moduleProps,
  notify,
  ai,
}: Props) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [focus, setFocus] = useState<string>(),
    [tabs, setTabs] = useState<Record<string, string>>({}),
    [drag, setDrag] = useState<{
      id: string;
      layout: Mod["layout"];
      valid: boolean;
    }>(),
    [dropping, setDropping] = useState<{
      type: ModuleType;
      layout: Mod["layout"];
      valid: boolean;
    }>(),
    [operation, setOperation] = useState<{
      id: string;
      kind: "stack" | "split";
    }>(),
    [target, setTarget] = useState(""),
    [side, setSide] = useState<"左" | "右" | "上" | "下">("右");
  const grid = useRef<HTMLDivElement>(null),
    draggedType = useRef<ModuleType>("pdf");
  const modules = workspace.modules;
  const bus = moduleProps(
    modules[0] || {
      id: "",
      type: "pdf",
      title: "",
      layout: { x: 0, y: 0, w: 6, h: 6 },
    },
  ).bus;
  useEffect(() => {
    setFocus(undefined);
    setTabs({});
    setOperation(undefined);
    setDropping(undefined);
    setDrag(undefined);
  }, [workspace.id]);
  useEffect(
    () =>
      bus.on("module.focus", ({ moduleId }) => {
        const mod = modules.find((m) => m.id === moduleId);
        if (mod?.group) setTabs((t) => ({ ...t, [mod.group!]: mod.id }));
        setFocus(moduleId);
      }),
    [bus, modules],
  );
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(undefined);
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const visible = types.filter(
    (t) =>
      (category === "全部" || definitions[t].category === category) &&
      (definitions[t].name + definitions[t].description)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const otherModules = drag
    ? modules.filter(
        (m) =>
          m.id !== drag.id &&
          (!m.group ||
            m.group !== modules.find((x) => x.id === drag.id)?.group),
      )
    : [];
  const verticalGuides = drag
    ? [drag.layout.x, drag.layout.x + drag.layout.w].filter((x) =>
        otherModules.some(
          (m) => m.layout.x === x || m.layout.x + m.layout.w === x,
        ),
      )
    : [];
  const horizontalGuides = drag
    ? [drag.layout.y, drag.layout.y + drag.layout.h].filter((y) =>
        otherModules.some(
          (m) => m.layout.y === y || m.layout.y + m.layout.h === y,
        ),
      )
    : [];
  const active = (m: Mod) =>
    !m.group ||
    (tabs[m.group] || modules.find((x) => x.group === m.group)?.id) === m.id;
  function updateLayout(m: Mod, layout: Mod["layout"]) {
    return modules.map((x) =>
      x.id === m.id || (m.group && x.group === m.group)
        ? { ...x, layout: { ...layout } }
        : x,
    );
  }
  function pointer(e: React.PointerEvent, m: Mod, resize = false) {
    if (
      !edit ||
      m.locked ||
      !grid.current ||
      window.matchMedia("(max-width:700px)").matches
    )
      return;
    e.preventDefault();
    const startX = e.clientX,
      startY = e.clientY,
      col = (grid.current.clientWidth + 10) / 12;
    const element = e.currentTarget as HTMLElement;
    element.setPointerCapture(e.pointerId);
    let proposed = { ...m.layout };
    const move = (event: PointerEvent) => {
      const dx = Math.round((event.clientX - startX) / col),
        dy = Math.round((event.clientY - startY) / 54);
      proposed = resize
        ? {
            ...m.layout,
            w: Math.max(3, Math.min(12 - m.layout.x, m.layout.w + dx)),
            h: Math.max(3, Math.min(20, m.layout.h + dy)),
          }
        : {
            ...m.layout,
            x: Math.max(0, Math.min(12 - m.layout.w, m.layout.x + dx)),
            y: Math.max(0, Math.min(100, m.layout.y + dy)),
          };
      setDrag({
        id: m.id,
        layout: proposed,
        valid: canPlace(modules, m.id, proposed),
      });
    };
    const finish = (cancel = false) => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", cancelled);
      setDrag(undefined);
      if (cancel) return;
      if (!canPlace(modules, m.id, proposed))
        return notify("位置已有模块，请选择空白区域");
      if (JSON.stringify(proposed) !== JSON.stringify(m.layout))
        change(updateLayout(m, proposed));
    };
    const end = () => finish();
    const cancelled = () => finish(true);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", cancelled);
  }
  function drop(e: React.DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/learnspace") as ModuleType;
    if (edit && types.includes(type)) {
      if (dropping && !dropping.valid) notify("此位置已有模块");
      else add(type, dropping?.layout);
    }
    setDropping(undefined);
  }
  return (
    <div className="editor-body">
      {edit && !focus && (
        <aside className="module-library expanded-library">
          <div className="library-heading">
            <h3>模块库</h3>
            <span>{types.length}</span>
          </div>
          <p className="library-description">拖入画布，或点击添加</p>
          <div className="search-field">
            <Search size={14} />
            <input
              aria-label="搜索模块"
              placeholder="搜索模块…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="library-filter"
            aria-label="模块分类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["全部", ...categories].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <div className="library-scroll">
            {categories
              .filter((c) => category === "全部" || category === c)
              .map((c) => (
                <div className="library-category" key={c}>
                  <h4>{c}</h4>
                  {visible
                    .filter((t) => definitions[t].category === c)
                    .map((type) => (
                      <button
                        className="library-module"
                        key={type}
                        draggable
                        onDragStart={(e) => {
                          draggedType.current = type;
                          e.dataTransfer.setData(
                            "application/learnspace",
                            type,
                          );
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => add(type)}
                      >
                        <ModuleIcon type={type} size={22} />
                        <span>
                          <b>{registry[type].name}</b>
                          <small>{registry[type].description}</small>
                        </span>
                        <Plus size={13} />
                      </button>
                    ))}
                </div>
              ))}
          </div>
          <div className="library-footer">
            <ShieldCheck size={13} />
            默认分享布局，资料和笔记可在发布时选择
          </div>
        </aside>
      )}
      <div
        className={`canvas-area ${edit ? "editing" : ""} ${focus ? "focus-canvas" : ""}`}
        onDragOver={(e) => {
          if (!edit || !e.dataTransfer.types.includes("application/learnspace"))
            return;
          e.preventDefault();
          if (!grid.current) return;
          const type = draggedType.current;
          const size = definitions[type]?.size || { w: 6, h: 6 };
          const rect = grid.current.getBoundingClientRect();
          const layout = {
            x: Math.max(
              0,
              Math.min(
                12 - size.w,
                Math.floor((e.clientX - rect.left) / ((rect.width + 10) / 12)),
              ),
            ),
            y: Math.max(
              0,
              Math.min(100, Math.floor((e.clientY - rect.top) / 54)),
            ),
            ...size,
          };
          setDropping({
            type,
            layout,
            valid: canPlace(modules, "new", layout),
          });
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDropping(undefined);
        }}
        onDrop={drop}
      >
        <div className="canvas-status">
          <span>
            {focus ? "专注模式" : edit ? "搭建模式" : "专注学习"} ·{" "}
            {modules.length} / {MAX_MODULES} 个模块
          </span>
          {focus ? (
            <button className="btn mini" onClick={() => setFocus(undefined)}>
              <Minimize2 size={13} />
              退出专注 · Esc
            </button>
          ) : edit ? (
            <div className="layout-presets">
              <label>
                <Columns2 size={14} />
                <select
                  aria-label="一键布局"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      if (
                        modules.some((m) => m.locked) &&
                        !confirm(
                          "布局切换将排列所有模块，包括已锁定模块，继续？",
                        )
                      )
                        return;
                      change(arrange(modules, e.target.value as LayoutPreset));
                    }
                  }}
                >
                  <option value="">一键布局</option>
                  {["双栏", "三栏", "四宫格", "主次", "自适应"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <button className="text-button" onClick={ai}>
                <Sparkles size={13} />
                AI 调整
              </button>
            </div>
          ) : (
            <span>双击模块标题进入专注模式</span>
          )}
        </div>
        {operation && (
          <div className="layout-operation">
            <b>
              {operation.kind === "stack"
                ? "堆叠成标签页"
                : "将当前模块分屏到目标旁边"}
            </b>
            <select
              aria-label="目标模块"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">选择目标模块</option>
              {modules
                .filter((m) => m.id !== operation.id && !m.locked)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
            </select>
            {operation.kind === "split" && (
              <select
                aria-label="分屏方向"
                value={side}
                onChange={(e) => setSide(e.target.value as typeof side)}
              >
                {["左", "右", "上", "下"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            <button
              className="btn primary"
              disabled={!target}
              onClick={() => {
                try {
                  change(
                    operation.kind === "stack"
                      ? stackModules(modules, operation.id, target)
                      : splitModules(modules, operation.id, target, side),
                  );
                  setOperation(undefined);
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              应用
            </button>
            <button
              title="取消排版操作"
              onClick={() => setOperation(undefined)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!modules.length ? (
          <div className="empty-canvas">
            <div className="canvas-empty-icon">
              <Plus size={34} />
            </div>
            <h2>这里，装下你的学习世界</h2>
            <p>从模块库添加工具，自由组合你的学习空间。</p>
            <button className="btn primary" onClick={() => add("pdf")}>
              <Plus size={16} />
              添加 PDF 阅读器
            </button>
          </div>
        ) : (
          <div
            className="workspace-canvas"
            ref={grid}
            style={{
              gridTemplateRows: `repeat(${Math.max(12, ...modules.map((m) => m.layout.y + m.layout.h), dropping ? dropping.layout.y + dropping.layout.h : 0) + 2},44px)`,
            }}
          >
            {verticalGuides.map((x) => (
              <i
                key={"x" + x}
                className="alignment-guide vertical"
                style={{ left: `${(x / 12) * 100}%` }}
              />
            ))}
            {horizontalGuides.map((y) => (
              <i
                key={"y" + y}
                className="alignment-guide horizontal"
                style={{ top: Math.max(0, y * 54 - 5) }}
              />
            ))}
            {dropping && (
              <div
                className={`grid-placeholder ${dropping.valid ? "valid" : "invalid"}`}
                style={{
                  gridColumn: `${dropping.layout.x + 1} / span ${dropping.layout.w}`,
                  gridRow: `${dropping.layout.y + 1} / span ${dropping.layout.h}`,
                }}
              >
                {dropping.valid ? "松开放置" : "此处已有模块"}
              </div>
            )}
            {modules.map((m) => {
              const grouped = modules.filter(
                (x) => x.group && x.group === m.group,
              );
              const moving =
                drag &&
                (drag.id === m.id ||
                  (m.group &&
                    modules.find((x) => x.id === drag.id)?.group === m.group))
                  ? drag.layout
                  : m.layout;
              const hidden = !active(m) || (!!focus && focus !== m.id);
              return (
                <section
                  data-module-id={m.id}
                  key={m.id}
                  className={`canvas-module module-${m.type} ${m.locked ? "locked" : ""} ${focus === m.id ? "focused-module" : ""} ${drag?.id === m.id ? (drag.valid ? "drag-valid" : "drag-invalid") : ""}`}
                  style={{
                    display: hidden ? "none" : undefined,
                    gridColumn: `${moving.x + 1} / span ${moving.w}`,
                    gridRow: `${moving.y + 1} / span ${moving.h}`,
                  }}
                >
                  <header className="module-header">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`${m.title}标题，双击专注，方向键移动`}
                      className={`module-title ${edit && !m.locked ? "draggable" : ""}`}
                      onDoubleClick={() =>
                        setFocus((f) => (f === m.id ? undefined : m.id))
                      }
                      onPointerDown={(e) => pointer(e, m)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setFocus(m.id);
                          return;
                        }
                        if (
                          !edit ||
                          m.locked ||
                          ![
                            "ArrowUp",
                            "ArrowDown",
                            "ArrowLeft",
                            "ArrowRight",
                          ].includes(e.key)
                        )
                          return;
                        e.preventDefault();
                        const l = {
                          ...m.layout,
                          x: Math.max(
                            0,
                            Math.min(
                              12 - m.layout.w,
                              m.layout.x +
                                (e.key === "ArrowLeft"
                                  ? -1
                                  : e.key === "ArrowRight"
                                    ? 1
                                    : 0),
                            ),
                          ),
                          y: Math.max(
                            0,
                            m.layout.y +
                              (e.key === "ArrowUp"
                                ? -1
                                : e.key === "ArrowDown"
                                  ? 1
                                  : 0),
                          ),
                        };
                        if (canPlace(modules, m.id, l))
                          change(updateLayout(m, l));
                      }}
                    >
                      {edit && !m.locked && <GripVertical size={12} />}
                      <ModuleIcon type={m.type} size={14} />
                      <span>{m.title}</span>
                      {m.locked && <Lock size={11} />}
                    </div>
                    <div className="module-controls">
                      {edit && (
                        <>
                          <button
                            title="修改模块标题"
                            onClick={() => {
                              const title = prompt("模块标题", m.title);
                              if (title?.trim())
                                change(
                                  modules.map((x) =>
                                    x.id === m.id
                                      ? { ...x, title: title.slice(0, 80) }
                                      : x,
                                  ),
                                );
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            title="复制模块及内容"
                            onClick={() => duplicate(m)}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            title={m.locked ? "解锁模块" : "锁定模块"}
                            onClick={() =>
                              change(
                                modules.map((x) =>
                                  x.id === m.id ||
                                  (m.group && x.group === m.group)
                                    ? { ...x, locked: !m.locked }
                                    : x,
                                ),
                              )
                            }
                          >
                            {m.locked ? (
                              <Unlock size={12} />
                            ) : (
                              <Lock size={12} />
                            )}
                          </button>
                          <button
                            title="分屏"
                            disabled={m.locked}
                            onClick={() => {
                              setOperation({ id: m.id, kind: "split" });
                              setTarget("");
                            }}
                          >
                            <Columns2 size={12} />
                          </button>
                          <button
                            title="堆叠标签页"
                            disabled={m.locked}
                            onClick={() => {
                              setOperation({ id: m.id, kind: "stack" });
                              setTarget("");
                            }}
                          >
                            <Layers size={12} />
                          </button>
                          {m.group && (
                            <button
                              title="拆出标签页"
                              disabled={m.locked}
                              onClick={() => {
                                try {
                                  change(unstack(modules, m.id));
                                } catch (e) {
                                  notify((e as Error).message);
                                }
                              }}
                            >
                              <Split size={12} />
                            </button>
                          )}
                        </>
                      )}
                      <button
                        title={focus === m.id ? "退出专注" : "专注模式"}
                        onClick={() =>
                          setFocus((f) => (f === m.id ? undefined : m.id))
                        }
                      >
                        {focus === m.id ? (
                          <Minimize2 size={13} />
                        ) : (
                          <Maximize2 size={13} />
                        )}
                      </button>
                      {edit && (
                        <button
                          title="删除模块"
                          disabled={m.locked}
                          onClick={() => {
                            change(modules.filter((x) => x.id !== m.id));
                            if (focus === m.id) setFocus(undefined);
                            notify(
                              "模块已移除，可撤销恢复；共享资料和笔记仍保留",
                            );
                          }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </header>
                  {m.group && (
                    <div className="stack-tabs">
                      {grouped.map((g) => (
                        <button
                          className={g.id === m.id ? "selected" : ""}
                          key={g.id}
                          onClick={() => {
                            setTabs((t) => ({ ...t, [m.group!]: g.id }));
                            if (focus) setFocus(g.id);
                          }}
                        >
                          <ModuleIcon type={g.type} size={11} />
                          {g.title}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="module-body">
                    <ModuleBody {...moduleProps(m)} />
                  </div>
                  {edit && !m.locked && !focus && (
                    <button
                      className="resize-handle"
                      title="拖动调整模块大小"
                      onPointerDown={(e) => pointer(e, m, true)}
                    >
                      <span />
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
