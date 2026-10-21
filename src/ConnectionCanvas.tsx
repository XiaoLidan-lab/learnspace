import { useEffect, useRef, useState, useMemo, useId } from "react";
import {
  connectionLayout,
  graphInputs,
  graphOutputs,
  graphPortTop,
  graphPortGap,
} from "./connectionLayout";
import { definitions, dataFlowRole } from "./definitions";
import { ModuleIcon } from "./registry";
import type { Workspace, Note } from "./model";
import { uid } from "./model";
import {
  outputPorts,
  portNames,
  directConnection,
  connectionError,
  type Port,
} from "./connectionGraph";
import type { Connection } from "./connections";
import { ConnectionBinding, FlowInputs } from "./FlowInputs";
import { ModuleConnections } from "./ModuleConnections";
import type { ModuleProps } from "./moduleProps";
import { X, Unlink, Settings2 } from "lucide-react";
type Point = { x: number; y: number };
export function ConnectionCanvas({
  workspace,
  notes,
  save,
  notify,
  navigate,
  initialSource,
  moduleProps,
}: {
  workspace: Workspace;
  notes: Note[];
  save: (c: Connection[]) => void;
  notify: (s: string) => void;
  navigate: (id: string) => void;
  initialSource?: { id: string; port: Port; noteId?: string };
  moduleProps?: (mod: import("./model").Mod) => ModuleProps;
}) {
  const [source, setSource] = useState<{
      id: string;
      port: Port;
      noteId?: string;
    }>(),
    [pointer, setPointer] = useState<Point>(),
    [selected, setSelected] = useState<string>(),
    [binding, setBinding] = useState(false),
    [error, setError] = useState("");
  const graph = useRef<HTMLDivElement>(null);
  const arrowId = `flow-arrow-${useId().replace(/:/g, "")}`;
  useEffect(() => {
    if (initialSource) setSource(initialSource);
  }, [initialSource]);
  const dragged = useRef(false),
    live = useRef({ workspace, notes, save });
  live.current = { workspace, notes, save };
  const modules = workspace.modules.filter(
      (m) => dataFlowRole(m.type) !== "辅助工具",
    ),
    edges = workspace.connections || [];
  const { boxes, size } = useMemo(
    () => connectionLayout(modules, edges),
    [modules, edges],
  );
  useEffect(() => {
    if (
      source &&
      !modules.some(
        (m) => m.id === source.id && outputPorts(m.type).includes(source.port),
      )
    ) {
      setSource(undefined);
      setPointer(undefined);
    }
    if (selected && !edges.some((e) => e.id === selected))
      setSelected(undefined);
  }, [modules, edges, source, selected]);
  const output = (id: string, port: Port) => {
    const b = boxes[id];
    const m = modules.find((m) => m.id === id);
    return b && m
      ? {
          x: b.x + b.w,
          y:
            b.y +
            graphPortTop +
            graphOutputs(m, edges).indexOf(port) * graphPortGap,
        }
      : undefined;
  };
  const input = (id: string, field: string) => {
    const b = boxes[id];
    const m = modules.find((m) => m.id === id);
    return b && m
      ? {
          x: b.x,
          y:
            b.y +
            graphPortTop +
            graphInputs(m, edges).findIndex((p) => p.id === field) *
              graphPortGap,
        }
      : undefined;
  };
  const curve = (a: Point, b: Point) =>
    `M${a.x} ${a.y} C${a.x + 75} ${a.y},${b.x - 75} ${b.y},${b.x} ${b.y}`;
  const connect = (target: string, field: string, from = source) => {
    if (!from) return setError("请先选择来源输出，再选择目标输入");
    try {
      const state = live.current;
      const sourceMod = state.workspace.modules.find((m) => m.id === from.id);
      const targetMod = state.workspace.modules.find((m) => m.id === target);
      if (!sourceMod || !targetMod) throw Error("连接模块已移除");
      if (
        ["练习巩固", "辅助工具"].includes(dataFlowRole(sourceMod.type)) ||
        ["内容来源", "辅助工具"].includes(dataFlowRole(targetMod.type))
      )
        throw Error("请从内容来源或处理工具的输出，连接到处理工具或成果的输入");
      const activeNote = state.notes.find(
        (n) =>
          n.id === (from.noteId || sourceMod?.activeNoteId) &&
          n.moduleId === from.id &&
          n.workspaceId === state.workspace.id &&
          n.taskId === state.workspace.activeTaskId,
      );
      const connection = directConnection(
        state.workspace.modules,
        state.workspace.connections || [],
        from.id,
        from.port,
        target,
        field,
        uid(),
        activeNote?.id,
      );
      state.save([...(state.workspace.connections || []), connection]);
      setSelected(connection.id);
      setBinding(false);
      setError("");
      setSource(undefined);
      setPointer(undefined);
      notify("连接已保存，未读取资料或运行 AI。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
      setPointer(undefined);
    }
  };
  const outputLabel = (_id: string, port: Port) =>
    (port === "selection" && modules.find((m) => m.id === _id)?.type === "pdf"
      ? "文件内容"
      : port === "text" && modules.find((m) => m.id === _id)?.type === "image"
        ? "图片说明"
        : port === "text" && modules.find((m) => m.id === _id)?.type === "web"
          ? "网页摘录"
          : undefined) ||
    (
      {
        selection: "选中的片段",
        text: "文字内容",
        output: "生成结果",
        note: "选定的笔记",
        answer: "AI 回答",
        transcript: "文字稿",
        outline: "导图内容",
        cards: "学习卡片",
        tasks: "待办清单",
        results: "测验结果",
        events: "学习日程",
        timer: "计时状态",
      } as Partial<Record<Port, string>>
    )[port] ||
    portNames[port];
  const current = edges.find((e) => e.id === selected);
  const contentTarget = workspace.modules.find(
    (m) => m.id === current?.target.moduleId,
  );
  const selectConnection = (edge: Connection) => {
    setSelected(edge.id);
    setBinding(false);
  };
  const unavailable = edges.filter(
    (e) =>
      !output(e.source.moduleId, e.source.port) ||
      !input(e.target.moduleId, e.target.field),
  );
  const overlay = (
    <div
      className="compact-flow-map"
      ref={graph}
      style={{ width: size.w, height: size.h }}
      aria-label="模块关系图"
    >
      {["内容来源", "理解与整理", "练习巩固"].map((label, i) => (
        <div
          key={label}
          className="flow-column-label"
          style={{ left: 24 + i * 376 }}
        >
          {label}
        </div>
      ))}
      {modules.map((m) => (
        <article
          key={m.id}
          className="compact-flow-card"
          style={{
            left: boxes[m.id].x,
            top: boxes[m.id].y,
            width: boxes[m.id].w,
            height: boxes[m.id].h,
          }}
          aria-label={`模块：${m.title}`}
        >
          <header>
            <ModuleIcon type={m.type} size={18} />
            <div>
              <strong title={m.title}>{m.title}</strong>
              <small>{definitions[m.type].name}</small>
            </div>
            <button
              className="text-button"
              aria-label={`打开 ${m.title}`}
              onClick={() => navigate(m.id)}
            >
              ↗
            </button>
          </header>
          <div className="compact-flow-port-head">
            <span>{graphInputs(m, edges).length ? "参考内容" : ""}</span>
            <span>{graphOutputs(m, edges).length ? "可用内容" : ""}</span>
          </div>
        </article>
      ))}
      <svg
        className="connection-overlay-wires"
        width={size.w}
        height={size.h}
        aria-label="连接线"
      >
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0 L10 5 L0 10 z" fill="#8191d8" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = output(e.source.moduleId, e.source.port),
            b = input(e.target.moduleId, e.target.field);
          if (!a || !b) return null;
          return (
            <g key={e.id}>
              <path
                className={`connection-wire ${selected === e.id ? "selected" : ""} ${e.source.needsBinding ? "unbound" : ""}`}
                d={curve(a, b)}
                markerEnd={`url(#${arrowId})`}
              />
              <path
                className="connection-wire-hit"
                d={curve(a, b)}
                role="button"
                tabIndex={0}
                aria-label={`查看连接：${modules.find((m) => m.id === e.source.moduleId)?.title}到${modules.find((m) => m.id === e.target.moduleId)?.title}`}
                onClick={() => selectConnection(e)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectConnection(e);
                  }
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    save(edges.filter((c) => c.id !== e.id));
                  }
                }}
              />
            </g>
          );
        })}
        {source && pointer && output(source.id, source.port) && (
          <path
            className="connection-wire drawing"
            d={curve(output(source.id, source.port)!, pointer)}
          />
        )}
      </svg>
      {modules
        .filter((m) => boxes[m.id])
        .flatMap((m) => [
          ...graphOutputs(m, edges).map((port) => {
            const point = output(m.id, port)!;
            return (
              <button
                key={`out:${m.id}:${port}`}
                className={`flow-port-anchor output ${source?.id === m.id && source.port === port ? "selected" : ""}`}
                style={{ left: point.x - 12, top: point.y - 12 }}
                aria-label={`选择输出：${m.title} · ${outputLabel(m.id, port)}`}
                title={outputLabel(m.id, port)}
                onClick={() => {
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  setSource({ id: m.id, port });
                  setError("");
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  dragged.current = false;
                  const from = { id: m.id, port };
                  setSource(from);
                  setError("");
                  const el = e.currentTarget;
                  el.setPointerCapture(e.pointerId);
                  const move = (event: PointerEvent) => {
                    dragged.current = true;
                    const r = graph.current!.getBoundingClientRect();
                    setPointer({
                      x: event.clientX - r.left,
                      y: event.clientY - r.top,
                    });
                  };
                  const cleanup = () => {
                    el.removeEventListener("pointermove", move);
                    el.removeEventListener("pointerup", up);
                    el.removeEventListener("pointercancel", cancel);
                  };
                  const up = (event: PointerEvent) => {
                    cleanup();
                    setPointer(undefined);
                    const node = document
                      .elementFromPoint(event.clientX, event.clientY)
                      ?.closest<HTMLElement>("[data-flow-target]");
                    if (node)
                      connect(
                        node.dataset.flowTarget!,
                        node.dataset.flowField!,
                        from,
                      );
                  };
                  const cancel = () => {
                    cleanup();
                    setSource(undefined);
                    setPointer(undefined);
                  };
                  el.addEventListener("pointermove", move);
                  el.addEventListener("pointerup", up);
                  el.addEventListener("pointercancel", cancel);
                }}
              >
                <i />
                <span>{outputLabel(m.id, port)}</span>
              </button>
            );
          }),
          ...graphInputs(m, edges).map((field) => {
            const point = input(m.id, field.id)!;
            const compatible =
              !source ||
              (source.id !== m.id && field.accept.includes(source.port));
            return (
              <button
                key={`in:${m.id}:${field.id}`}
                className={`flow-port-anchor input ${!compatible ? "incompatible" : ""}`}
                style={{ left: point.x - 12, top: point.y - 12 }}
                data-flow-target={m.id}
                data-flow-field={field.id}
                aria-label={`连接到 ${m.title} 的 ${field.label}`}
                aria-disabled={!compatible}
                title={
                  compatible
                    ? `${field.label}${field.multiple ? "（支持多来源）" : "（单来源）"}`
                    : "类型不匹配或不能连接自身"
                }
                onClick={() => connect(m.id, field.id)}
              >
                <i />
                <span>
                  {field.label}
                  {field.multiple ? " ＋" : ""}
                </span>
              </button>
            );
          }),
        ])}
    </div>
  );
  return (
    <div className="compact-flow-view">
      <section className="connection-inspector" aria-label="可视化数据连接">
        <div>
          <b>连接模式</b>
          <span>
            从右侧可用内容拖到另一工具的参考内容，或依次点击两端。有效连接立即保存，不自动取数或运行
            AI。
          </span>
        </div>
        {source && (
          <p role="status">
            已选择：{modules.find((m) => m.id === source.id)?.title} ·{" "}
            {outputLabel(source.id, source.port)}{" "}
            <button
              className="text-button"
              onClick={() => {
                setSource(undefined);
                setPointer(undefined);
              }}
            >
              取消选择
            </button>
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {!!unavailable.length && (
          <button
            className="text-button"
            onClick={() =>
              selectConnection(
                unavailable.find((e) => e.id !== selected) || unavailable[0],
              )
            }
          >
            检查不可用连接（{unavailable.length}）
          </button>
        )}
        {current && (
          <div className="connection-quick-actions" aria-label="所选连线操作">
            {current.source.port === "selection" &&
              modules.find((m) => m.id === current.source.moduleId)?.type ===
                "pdf" && (
                <label className="connection-range">
                  数据范围
                  <select
                    aria-label="连接数据范围"
                    value={current.source.range || "selection"}
                    onChange={(e) => {
                      const next = edges.map((edge) =>
                        edge.id === current.id
                          ? {
                              ...edge,
                              source: {
                                ...edge.source,
                                range: e.target.value as
                                  | "selection"
                                  | "document",
                              },
                            }
                          : edge,
                      );
                      const issue = connectionError(workspace.modules, next);
                      if (issue) {
                        setError(issue);
                        return;
                      }
                      try {
                        save(next);
                        setError("");
                        notify(
                          "数据范围已保存，再次传递内容或提问时生效；未运行 AI。",
                        );
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : "数据范围保存失败",
                        );
                      }
                    }}
                  >
                    <option value="selection">选中内容</option>
                    <option value="document">整篇文档</option>
                  </select>
                </label>
              )}
            {contentTarget &&
              moduleProps &&
              (contentTarget.type === "custom-ai" ? (
                <ModuleConnections
                  compact
                  connectionId={current.id}
                  key={current.id}
                  {...moduleProps(contentTarget)}
                />
              ) : (
                <FlowInputs
                  compact
                  connectionId={current.id}
                  key={current.id}
                  {...moduleProps(contentTarget)}
                />
              ))}
            <button
              className="text-button"
              onClick={() => navigate(current.source.moduleId)}
            >
              打开来源
            </button>
            {(current.source.needsBinding ||
              ["note", "retrieval"].includes(current.source.port)) && (
              <button
                className="text-button"
                aria-expanded={binding}
                onClick={() => setBinding(!binding)}
              >
                <Settings2 size={14} />
                选择来源
              </button>
            )}
            <button
              className="text-button"
              onClick={() => {
                save(edges.filter((e) => e.id !== current.id));
                setSelected(undefined);
                notify("连接已断开，已传递的内容和历史保留");
              }}
            >
              <Unlink size={14} />
              断开连接
            </button>
            <button
              className="text-button"
              aria-label="取消选中连线"
              onClick={() => {
                setSelected(undefined);
                setBinding(false);
              }}
            >
              <X size={15} />
            </button>
            {binding && (
              <div className="connection-binding-popover">
                <ConnectionBinding
                  edge={current}
                  workspace={workspace}
                  notes={notes}
                  save={save}
                />
              </div>
            )}
          </div>
        )}
      </section>
      <div className="compact-flow-legend">
        <span>
          {modules.length} 个工具 · {edges.length} 条连接
        </span>
        <span>辅助工具不参与连线 · 虚线表示来源待绑定</span>
      </div>
      {!modules.length ? (
        <p className="muted">先返回学习画布添加工具，再建立连接。</p>
      ) : (
        <div
          className="compact-flow-scroll"
          tabIndex={0}
          aria-label="模块关系图，可滚动查看"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSource(undefined);
              setPointer(undefined);
              setSelected(undefined);
            }
          }}
        >
          {overlay}
        </div>
      )}
    </div>
  );
}
