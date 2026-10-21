export const types = [
  "pdf",
  "web",
  "video",
  "text",
  "chat",
  "translate",
  "summary",
  "mindmap",
  "note",
  "cards",
  "todo",
  "quiz",
  "pomodoro",
  "calendar",
  "sticky",
  "image",
  "custom-ai",
] as const;
export type ModuleType = (typeof types)[number];
// Legacy types remain readable; new creation uses this single catalog.
export const creatableTypes = types.filter(
  (t) => !["text", "sticky", "custom-ai", "summary"].includes(t),
);
export const categories = [
  "内容来源",
  "理解与整理",
  "练习巩固",
  "辅助工具",
] as const;
export function dataFlowRole(type: ModuleType): (typeof categories)[number] {
  if (["pdf", "web", "video", "image", "text", "sticky"].includes(type))
    return "内容来源";
  if (["cards", "quiz"].includes(type)) return "练习巩固";
  if (["todo", "calendar", "pomodoro"].includes(type)) return "辅助工具";
  return "理解与整理";
}
export type ModuleCategory = (typeof categories)[number];
export type ModuleDefinition = {
  type: ModuleType;
  name: string;
  category: ModuleCategory;
  description: string;
  size: { w: number; h: number };
  capabilities: readonly string[];
};
export const definitions: Record<ModuleType, ModuleDefinition> = {
  "custom-ai": {
    type: "custom-ai",
    name: "自定义 AI 模块",
    category: "理解与整理",
    description: "命名输入、提示词与独立运行",
    size: { w: 6, h: 10 },
    capabilities: ["context", "ai"],
  },
  pdf: {
    type: "pdf",
    name: "文件阅读",
    category: "内容来源",
    description: "PDF、Word、Markdown 与文本阅读",
    size: { w: 8, h: 16 },
    capabilities: ["selection", "source", "file"],
  },
  web: {
    type: "web",
    name: "网页浏览",
    category: "内容来源",
    description: "网页嵌入与原站打开",
    size: { w: 6, h: 7 },
    capabilities: ["selection", "source", "url"],
  },
  video: {
    type: "video",
    name: "视频学习",
    category: "内容来源",
    description: "视频播放与文字稿学习",
    size: { w: 6, h: 7 },
    capabilities: ["selection", "source", "file", "url"],
  },
  text: {
    type: "text",
    name: "文本",
    category: "内容来源",
    description: "输入材料、选段发送，可切换便签样式",
    size: { w: 6, h: 6 },
    capabilities: ["selection", "source", "insert"],
  },
  chat: {
    type: "chat",
    name: "AI 问答",
    category: "理解与整理",
    description: "资料问答、总结与解释",
    size: { w: 6, h: 6 },
    capabilities: ["context", "ai"],
  },
  translate: {
    type: "translate",
    name: "AI 翻译",
    category: "理解与整理",
    description: "多语言翻译与学习材料处理",
    size: { w: 6, h: 6 },
    capabilities: ["context", "ai"],
  },
  summary: {
    type: "summary",
    name: "AI 总结",
    category: "理解与整理",
    description: "摘要、详解与要点提炼",
    size: { w: 6, h: 6 },
    capabilities: ["context", "ai"],
  },
  mindmap: {
    type: "mindmap",
    name: "思维导图",
    category: "理解与整理",
    description: "自由编辑与 AI 生成节点",
    size: { w: 6, h: 8 },
    capabilities: ["context", "ai", "insert"],
  },
  note: {
    type: "note",
    name: "笔记",
    category: "理解与整理",
    description: "Markdown 与来源引用",
    size: { w: 6, h: 6 },
    capabilities: ["context", "insert", "source"],
  },
  cards: {
    type: "cards",
    name: "知识卡片",
    category: "练习巩固",
    description: "问答卡片与翻转复习",
    size: { w: 4, h: 5 },
    capabilities: ["context", "ai", "insert"],
  },
  todo: {
    type: "todo",
    name: "待办清单",
    category: "辅助工具",
    description: "任务管理与拖动排序",
    size: { w: 4, h: 6 },
    capabilities: ["insert"],
  },
  quiz: {
    type: "quiz",
    name: "测验练习",
    category: "练习巩固",
    description: "选择题、自测与解析",
    size: { w: 6, h: 7 },
    capabilities: ["context", "ai"],
  },
  pomodoro: {
    type: "pomodoro",
    name: "番茄钟",
    category: "辅助工具",
    description: "专注、休息与计时",
    size: { w: 4, h: 5 },
    capabilities: [],
  },
  calendar: {
    type: "calendar",
    name: "日历",
    category: "辅助工具",
    description: "月视图与学习日程",
    size: { w: 6, h: 7 },
    capabilities: [],
  },
  sticky: {
    type: "sticky",
    name: "文本",
    category: "内容来源",
    description: "文本的便签显示方式",
    size: { w: 4, h: 5 },
    capabilities: ["selection", "source", "insert"],
  },
  image: {
    type: "image",
    name: "图片展示",
    category: "内容来源",
    description: "图片上传、缩放与预览",
    size: { w: 6, h: 6 },
    capabilities: ["file", "url"],
  },
};
export const labels = Object.fromEntries(
  types.map((t) => [t, definitions[t].name]),
) as Record<ModuleType, string>;
export const MAX_MODULES = 24;
