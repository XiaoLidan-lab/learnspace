import { MessageCircle, ClipboardCheck, Network } from "lucide-react";
import type { ModuleProps } from "./moduleProps";
export function FileActions({ p }: { p: ModuleProps }) {
  return (
    <div
      className="file-quick-actions"
      role="toolbar"
      aria-label="文件快捷操作"
    >
      {(
        [
          ["chat", MessageCircle, "提问"],
          ["mindmap", Network, "生成导图"],
          ["quiz", ClipboardCheck, "生成练习"],
        ] as const
      ).map(([type, Icon, label]) => (
        <button
          key={type}
          title={`根据整篇文档${label}`}
          onClick={() => {
            p.bus.emit("material.action", {
              moduleId: p.mod.id,
              type,
              range: "document",
            });
          }}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}
