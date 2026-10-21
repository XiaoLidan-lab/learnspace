import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Languages,
  MessageCircle,
  NotebookPen,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import type { ModuleProps } from "./moduleProps";
import type { Source } from "./model";
export function SelectionTools({
  text,
  source,
  bus,
  send,
}: {
  text: string;
  source: Source;
  bus: ModuleProps["bus"];
  send: ModuleProps["send"];
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    if (!text) return;
    const place = () => {
      const selection = window.getSelection();
      const owner = anchor.current?.closest("[data-module-id]");
      const valid =
        selection?.rangeCount &&
        selection.toString().trim() === text &&
        (!owner || owner.contains(selection.anchorNode));
      const rect = valid
        ? selection.getRangeAt(0).getBoundingClientRect()
        : anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(380, window.innerWidth - 24);
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 60)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [text]);
  useEffect(() => {
    if (text)
      bus.emit("selection.changed", {
        ...source,
        text,
        moduleId: source.moduleId!,
        createdAt: Date.now(),
      });
    else bus.emit("selection.cleared", { moduleId: source.moduleId });
  }, [
    text,
    source.moduleId,
    source.page,
    source.timestamp,
    source.resourceId,
    source.version,
    source.contentKind,
    source.start,
    source.end,
  ]);
  if (!text) return null;
  return (
    <>
      <span ref={anchor} />
      {createPortal(
        <div
          className="selection-tools selection-popover"
          role="toolbar"
          aria-label="选区操作"
          style={position}
          onMouseDown={(e) => e.preventDefault()}
        >
          {(
            [
              ["translate", Languages, "翻译"],
              ["chat", MessageCircle, "提问"],
              ["note", NotebookPen, "添加到笔记"],
              ["cards", Layers, "制作卡片"],
            ] as const
          ).map(([type, I, label]) => (
            <button key={type} onClick={() => send(type, text, source)}>
              <I size={13} />
              {label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
export function SourceLink({
  source,
  jump,
}: {
  source?: Source;
  jump: ModuleProps["jump"];
}) {
  return source ? (
    <button className="source-chip" onClick={() => jump(source)}>
      {source.resourceName || source.kind || "原文"}
      {source.kind === "pdf" || !source.kind
        ? source.resourceName &&
          /\.(docx?|md|markdown|txt)$/i.test(source.resourceName)
          ? ` · 文本区段 ${source.page}`
          : ` · 第 ${source.page} 页`
        : source.timestamp != null
          ? ` · ${Math.floor(source.timestamp)} 秒`
          : ""}
      <ArrowUpRight size={12} />
    </button>
  ) : null;
}
export function ContextInput({
  mod,
  update,
  bus,
  jump,
  workspace,
}: {
  workspace?: ModuleProps["workspace"];
  mod: ModuleProps["mod"];
  update: ModuleProps["update"];
  bus: ModuleProps["bus"];
  jump: ModuleProps["jump"];
}) {
  const [selection, setSelection] = useState(bus.selection);
  useEffect(() => {
    setSelection(bus.selection);
    const off = bus.on("selection.changed", setSelection);
    const clear = bus.on("selection.cleared", () => setSelection(null));
    return () => {
      off();
      clear();
    };
  }, [bus]);
  const connected = workspace?.connections?.some(
    (e) => e.target.moduleId === mod.id,
  );
  if (
    ["chat", "translate", "summary", "mindmap", "cards", "quiz"].includes(
      mod.type,
    )
  )
    return null;
  return (
    <div className="context-controls">
      {!connected && selection && selection.moduleId !== mod.id && (
        <button
          className="text-button"
          onClick={() =>
            update(
              mod.type === "chat"
                ? { source: selection }
                : { input: selection.text, source: selection },
            )
          }
        >
          添加选区作为参考 · {selection.text.length} 字
        </button>
      )}
      <SourceLink source={mod.source} jump={jump} />
      {mod.source && (
        <button
          className="text-button"
          onClick={() => update({ source: undefined })}
        >
          移除引用
        </button>
      )}
    </div>
  );
}
