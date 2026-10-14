import { useEffect, useState } from "react";
import {
  Languages,
  MessageCircle,
  NotebookPen,
  ListCollapse,
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
  useEffect(() => {
    if (text)
      bus.emit("selection.changed", {
        ...source,
        text,
        moduleId: source.moduleId!,
        createdAt: Date.now(),
      });
    else bus.emit("selection.cleared", { moduleId: source.moduleId });
  }, [text, source.moduleId, source.page, source.timestamp]);
  if (!text) return null;
  return (
    <div className="selection-tools">
      <span>{text.length} 字</span>
      {(
        [
          ["translate", Languages, "翻译"],
          ["chat", MessageCircle, "提问"],
          ["note", NotebookPen, "笔记"],
          ["summary", ListCollapse, "总结"],
          ["cards", Layers, "卡片"],
        ] as const
      ).map(([type, I, label]) => (
        <button key={type} onClick={() => send(type, text, source)}>
          <I size={13} />
          {label}
        </button>
      ))}
    </div>
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
        ? ` · 第 ${source.page} 页`
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
}: {
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
  return (
    <div className="context-controls">
      {selection && selection.moduleId !== mod.id && (
        <button
          className="text-button"
          onClick={() => update({ input: selection.text, source: selection })}
        >
          使用当前选区 · {selection.text.length} 字
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
