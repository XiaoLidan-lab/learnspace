import { materialEdges, materialModePatch } from "./learningMaterials";
import type { ModuleProps } from "./moduleProps";
export function isDirectInput(p: ModuleProps) {
  return (
    p.mod.data?.flow?.materialMode === "manual" ||
    !materialEdges(p.mod, p.workspace).length
  );
}
export function LearningInput({
  p,
  label = "学习内容",
}: {
  p: ModuleProps;
  label?: string;
}) {
  if (!isDirectInput(p)) return null;
  return (
    <label className="learning-input">
      <span>{label}</span>
      <textarea
        aria-label={label}
        placeholder="输入或粘贴要学习的内容…"
        value={p.mod.input || ""}
        onChange={(e) =>
          p.update({
            ...materialModePatch(p.mod, "manual"),
            input: e.target.value,
          })
        }
      />
    </label>
  );
}
