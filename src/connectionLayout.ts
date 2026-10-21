import { dataFlowRole } from "./definitions";
import type { Mod } from "./model";
import type { Connection } from "./connections";
import { inputPorts, outputPorts, type Port } from "./connectionGraph";
// Presentation defaults only; the full capability registry remains compatible.
const primaryOutput: Record<Mod["type"], Port> = {
  pdf: "selection",
  text: "selection",
  sticky: "selection",
  web: "text",
  video: "transcript",
  image: "text",
  note: "note",
  chat: "answer",
  summary: "output",
  translate: "output",
  "custom-ai": "output",
  mindmap: "outline",
  cards: "cards",
  todo: "tasks",
  quiz: "results",
  calendar: "events",
  pomodoro: "timer",
};
export function graphOutputs(m: Mod, edges: Connection[]) {
  return outputPorts(m.type).filter(
    (port) =>
      ((dataFlowRole(m.type) === "内容来源" ||
        dataFlowRole(m.type) === "理解与整理") &&
        port === primaryOutput[m.type]) ||
      edges.some((e) => e.source.moduleId === m.id && e.source.port === port),
  );
}
export function graphInputs(m: Mod, edges: Connection[]) {
  const primary =
    m.type === "video"
      ? "transcript"
      : m.type === "image"
        ? "caption"
        : m.type === "pdf" || m.type === "web"
          ? undefined
          : inputPorts(m)[0]?.id;
  return inputPorts(m).filter(
    (field) =>
      (dataFlowRole(m.type) !== "内容来源" &&
        dataFlowRole(m.type) !== "辅助工具" &&
        (m.type === "custom-ai" || field.id === primary)) ||
      edges.some(
        (e) => e.target.moduleId === m.id && e.target.field === field.id,
      ),
  );
}
export const graphCardWidth = 272;
export const graphPortTop = 88;
export const graphPortGap = 34;
/** A view-only layout. Learning layouts and content are never modified. */
export function connectionLayout(modules: Mod[], edges: Connection[]) {
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> =
    {};
  const rows = [56, 56, 56];
  const roles = ["内容来源", "理解与整理", "练习巩固"];
  for (const m of modules) {
    const column = roles.indexOf(dataFlowRole(m.type));
    if (column < 0) continue;
    const h =
      112 +
      Math.max(graphInputs(m, edges).length, graphOutputs(m, edges).length) *
        graphPortGap;
    boxes[m.id] = {
      x: 24 + column * 376,
      y: rows[column],
      w: graphCardWidth,
      h,
    };
    rows[column] += h + 28;
  }
  return { boxes, size: { w: 1072, h: Math.max(260, ...rows) } };
}
