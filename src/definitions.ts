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
] as const;
export type ModuleType = (typeof types)[number];
export const categories = [
  "内容输入",
  "AI 辅助",
  "学习与输出",
  "通用工具",
] as const;
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
  pdf: {
    type: "pdf",
    name: "PDF 阅读",
    category: "内容输入",
    description: "阅读、搜索与选段引用",
    size: { w: 6, h: 8 },
    capabilities: ["selection", "source", "file"],
  },
  web: {
    type: "web",
    name: "网页浏览",
    category: "内容输入",
    description: "网页嵌入与原站打开",
    size: { w: 6, h: 7 },
    capabilities: ["selection", "source", "url"],
  },
  video: {
    type: "video",
    name: "视频学习",
    category: "内容输入",
    description: "视频播放与文字稿学习",
    size: { w: 6, h: 7 },
    capabilities: ["selection", "source", "file", "url"],
  },
  text: {
    type: "text",
    name: "文本编辑器",
    category: "内容输入",
    description: "独立文本与 Markdown 编辑",
    size: { w: 6, h: 6 },
    capabilities: ["selection", "source", "insert"],
  },
  chat: {
    type: "chat",
    name: "AI 问答",
    category: "AI 辅助",
    description: "带来源的学习对话",
    size: { w: 6, h: 6 },
    capabilities: ["context", "ai"],
  },
  translate: {
    type: "translate",
    name: "AI 翻译",
    category: "AI 辅助",
    description: "多语言翻译与选区同步",
    size: { w: 6, h: 6 },
    capabilities: ["context", "ai"],
  },
  summary: {
    type: "summary",
    name: "AI 总结",
    category: "AI 辅助",
    description: "摘要、详解与要点提炼",
    size: { w: 6, h: 6 },
    capabilities: ["context", "ai"],
  },
  mindmap: {
    type: "mindmap",
    name: "思维导图",
    category: "AI 辅助",
    description: "自由编辑与 AI 生成节点",
    size: { w: 6, h: 8 },
    capabilities: ["context", "ai", "insert"],
  },
  note: {
    type: "note",
    name: "笔记",
    category: "学习与输出",
    description: "Markdown 与来源引用",
    size: { w: 6, h: 6 },
    capabilities: ["context", "insert", "source"],
  },
  cards: {
    type: "cards",
    name: "知识卡片",
    category: "学习与输出",
    description: "问答卡片与翻转复习",
    size: { w: 4, h: 6 },
    capabilities: ["context", "ai", "insert"],
  },
  todo: {
    type: "todo",
    name: "待办清单",
    category: "学习与输出",
    description: "任务管理与拖动排序",
    size: { w: 4, h: 6 },
    capabilities: ["insert"],
  },
  quiz: {
    type: "quiz",
    name: "测验练习",
    category: "学习与输出",
    description: "选择题、简答题与解析",
    size: { w: 6, h: 7 },
    capabilities: ["context", "ai"],
  },
  pomodoro: {
    type: "pomodoro",
    name: "番茄钟",
    category: "通用工具",
    description: "专注、休息与计时",
    size: { w: 4, h: 5 },
    capabilities: [],
  },
  calendar: {
    type: "calendar",
    name: "日历",
    category: "通用工具",
    description: "月视图与学习日程",
    size: { w: 6, h: 7 },
    capabilities: [],
  },
  sticky: {
    type: "sticky",
    name: "便签",
    category: "通用工具",
    description: "随手记录与自动保存",
    size: { w: 4, h: 5 },
    capabilities: ["selection", "source", "insert"],
  },
  image: {
    type: "image",
    name: "图片展示",
    category: "通用工具",
    description: "图片上传、缩放与预览",
    size: { w: 6, h: 6 },
    capabilities: ["file", "url"],
  },
};
export const labels = Object.fromEntries(
  types.map((t) => [t, definitions[t].name]),
) as Record<ModuleType, string>;
export const MAX_MODULES = 24;
