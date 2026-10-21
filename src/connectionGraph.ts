import type { Mod } from "./model.js";
import { connectionSchema } from "./customAI.js";
import type { z } from "zod";
type Connection = z.infer<typeof connectionSchema>;
export type Port = Connection["source"]["port"];
const readable: Port[] = [
  "text",
  "selection",
  "output",
  "note",
  "retrieval",
  "answer",
  "transcript",
  "outline",
  "cards",
  "tasks",
  "questions",
  "results",
  "events",
  "timer",
];
export const portNames: Record<Port, string> = {
  text: "文字内容",
  selection: "当前选区／检索片段",
  output: "最新成功输出",
  note: "指定笔记",
  retrieval: "关键词检索片段",
  answer: "最新 AI 回答",
  transcript: "已导入文字稿",
  outline: "导图大纲",
  cards: "卡片组",
  tasks: "待办事项",
  questions: "测验题目",
  results: "已提交测验结果",
  events: "学习日程",
  timer: "当前计时状态（非历史）",
  document: "PDF 文件引用",
  web_url: "网页地址",
  video_ref: "视频引用",
  image_ref: "图片引用",
};
export function outputPorts(type: Mod["type"]): Port[] {
  switch (type) {
    case "pdf":
      return ["selection", "retrieval", "document"];
    case "text":
    case "sticky":
      return ["text", "selection"];
    case "web":
      return ["text", "web_url"];
    case "video":
      return ["transcript", "video_ref"];
    case "image":
      return ["text", "image_ref"];
    case "note":
      return ["note"];
    case "chat":
      return ["answer"];
    case "summary":
    case "translate":
    case "custom-ai":
      return ["output"];
    case "mindmap":
      return ["outline"];
    case "cards":
      return ["cards"];
    case "todo":
      return ["tasks"];
    case "quiz":
      return ["questions", "results"];
    case "calendar":
      return ["events"];
    case "pomodoro":
      return ["timer"];
  }
}
export type InputPort = {
  id: string;
  label: string;
  accept: Port[];
  multiple: boolean;
};
export function inputPorts(m: Pick<Mod, "type" | "customConfig">): InputPort[] {
  const text = (id: string, label: string, multiple = true): InputPort => ({
    id,
    label,
    accept: readable,
    multiple,
  });
  switch (m.type) {
    case "custom-ai":
      return (m.customConfig?.fields || []).map((f) =>
        text(f.id, f.label, false),
      );
    case "chat":
      return [text("context", "参考资料")];
    case "translate":
    case "summary":
    case "quiz":
      return [text("input", "学习材料")];
    case "cards":
      return [
        text("input", "制卡材料"),
        { id: "import", label: "导入卡片", accept: ["cards"], multiple: true },
      ];
    case "mindmap":
      return [
        text("input", "梳理材料"),
        {
          id: "import",
          label: "导入大纲",
          accept: ["outline"],
          multiple: true,
        },
      ];
    case "text":
    case "sticky":
    case "note":
      return [text("append", "追加内容")];
    case "todo":
      return [text("items", "添加待办")];
    case "calendar":
      return [
        {
          id: "schedule",
          label: "添加学习日程",
          accept: ["tasks", "events", "text", "note"],
          multiple: true,
        },
      ];
    case "pomodoro":
      return [
        {
          id: "focus",
          label: "本次专注内容",
          accept: ["text", "selection", "note", "tasks"],
          multiple: false,
        },
      ];
    case "pdf":
      return [
        {
          id: "file",
          label: "PDF 文件",
          accept: ["document"],
          multiple: false,
        },
      ];
    case "web":
      return [
        { id: "url", label: "网页地址", accept: ["web_url"], multiple: false },
      ];
    case "video":
      return [
        { id: "file", label: "视频", accept: ["video_ref"], multiple: false },
        text("transcript", "追加文字稿"),
      ];
    case "image":
      return [
        { id: "file", label: "图片", accept: ["image_ref"], multiple: false },
        text("caption", "图片说明"),
      ];
  }
}
export function privateConnectionSource(
  type: Mod["type"] | undefined,
  port: Port,
) {
  return (
    type === "pdf" ||
    [
      "note",
      "selection",
      "document",
      "web_url",
      "video_ref",
      "image_ref",
      "tasks",
      "cards",
      "events",
    ].includes(port)
  );
}
export function connectionError(
  modules: Mod[],
  edges: Connection[],
): string | undefined {
  if (edges.length > 48) return "每个工作台最多 48 条连接";
  const ids = new Set<string>(),
    targets = new Set<string>(),
    graph = new Map<string, string[]>();
  for (const e of edges) {
    if (!connectionSchema.safeParse(e).success)
      return "连接格式或输入输出类型无效";
    const from = modules.find((m) => m.id === e.source.moduleId),
      to = modules.find((m) => m.id === e.target.moduleId);
    const input = to && inputPorts(to).find((p) => p.id === e.target.field);
    if (!from || !to || from.id === to.id || !input)
      return "模块连接端点无效，请重新选择模块和输入字段";
    if (
      e.source.range &&
      (from.type !== "pdf" || e.source.port !== "selection")
    )
      return "数据范围仅适用于文件阅读的内容连接";
    if (
      e.source.itemId &&
      !["tasks", "cards", "events"].includes(e.source.port)
    )
      return "此输出不支持条目选择";
    if (!outputPorts(from.type).includes(e.source.port))
      return "来源模块不支持此输出类型";
    if (!input.accept.includes(e.source.port))
      return "输入输出类型不匹配：此目标不能接收该内容";
    if (
      e.source.needsBinding &&
      (e.source.noteId || e.source.query || e.source.itemId)
    )
      return "未绑定连接不能携带私人来源";
    if (
      !e.source.needsBinding &&
      (e.source.port === "note" ? !e.source.noteId : !!e.source.noteId)
    )
      return "笔记连接必须指定具体篇目，其他输出不能绑定笔记";
    if (
      !e.source.needsBinding &&
      (e.source.port === "retrieval"
        ? !e.source.query?.trim()
        : !!e.source.query)
    )
      return "PDF 检索必须指定关键词，其他输出不能绑定检索条件";
    if (edges.filter((edge) => edge.target.moduleId === to.id).length > 12)
      return "每个工具最多连接12个来源";
    const key = `${to.id}:${e.target.field}`;
    if (ids.has(e.id) || (!input.multiple && targets.has(key)))
      return "连接标识或目标输入重复；每个输入只允许一条连接";
    if (
      edges.some(
        (other) =>
          other !== e &&
          other.source.moduleId === e.source.moduleId &&
          other.source.port === e.source.port &&
          other.source.noteId === e.source.noteId &&
          other.source.query === e.source.query &&
          other.source.itemId === e.source.itemId &&
          other.target.moduleId === e.target.moduleId &&
          other.target.field === e.target.field,
      )
    )
      return "重复连接：相同的数据连接已经存在";
    ids.add(e.id);
    targets.add(key);
    graph.set(from.id, [...(graph.get(from.id) || []), to.id]);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function cyclic(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((graph.get(id) || []).some(cyclic)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  if ([...graph.keys()].some(cyclic)) return "模块连接不能形成依赖环";
}
export function directConnection(
  modules: Mod[],
  edges: Connection[],
  sourceId: string,
  port: Port,
  targetId: string,
  field: string,
  id: string,
  noteId?: string,
): Connection {
  const source = modules.find((m) => m.id === sourceId);
  const sourceBinding =
    port === "note"
      ? noteId
        ? { noteId }
        : { needsBinding: true as const }
      : port === "retrieval"
        ? { needsBinding: true as const }
        : {};
  const connection: Connection = {
    id,
    source: {
      moduleId: sourceId,
      port,
      ...sourceBinding,
      ...(source?.type === "pdf" && port === "selection"
        ? {
            range:
              modules.find((m) => m.id === targetId)?.type === "mindmap"
                ? ("document" as const)
                : ("selection" as const),
          }
        : {}),
    },
    target: { moduleId: targetId, field },
    trigger: "manual",
    mode: "replace",
  };
  const error = connectionError(modules, [...edges, connection]);
  if (error) throw Error(error);
  return connection;
}
