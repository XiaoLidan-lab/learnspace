import { z } from "zod";
import { types, labels, MAX_MODULES, type ModuleType } from "./definitions";
export { types, labels, MAX_MODULES } from "./definitions";
export type { ModuleType } from "./definitions";
export const layoutSchema = z
  .object({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(100),
    w: z.number().int().min(3).max(12),
    h: z.number().int().min(3).max(20),
  })
  .strict()
  .refine((l) => l.x + l.w <= 12, "模块超出画布");
export const publicSettingsSchema = z
  .object({
    language: z
      .enum(["简体中文", "English", "日本語", "한국어", "Français"])
      .optional(),
    sourceLanguage: z
      .enum(["自动检测", "简体中文", "English", "日本語", "한국어", "Français"])
      .optional(),
    summaryStyle: z.enum(["brief", "detailed", "bullets"]).optional(),
    focusMinutes: z.number().int().min(1).max(120).optional(),
    breakMinutes: z.number().int().min(1).max(60).optional(),
    fit: z.enum(["contain", "cover"]).optional(),
    format: z.enum(["plain", "markdown"]).optional(),
  })
  .strict();
const moduleSchema = z
  .object({
    type: z.enum(types),
    title: z.string().min(1).max(80),
    layout: layoutSchema,
    settings: publicSettingsSchema.optional(),
    group: z.string().min(1).max(80).optional(),
    locked: z.boolean().optional(),
    instanceId: z.string().max(80).optional(),
  })
  .strict();
export const templateSchema = z
  .object({
    version: z.literal(1),
    title: z.string().min(1).max(80),
    description: z.string().max(1000),
    modules: z.array(moduleSchema).max(MAX_MODULES),
  })
  .strict()
  .superRefine((t, c) => {
    t.modules.forEach((a, i) =>
      t.modules.slice(i + 1).forEach((b) => {
        if (a.group && a.group === b.group) {
          if (JSON.stringify(a.layout) !== JSON.stringify(b.layout))
            c.addIssue({ code: "custom", message: "同组模块必须使用相同布局" });
          return;
        }
        if (
          a.layout.x < b.layout.x + b.layout.w &&
          a.layout.x + a.layout.w > b.layout.x &&
          a.layout.y < b.layout.y + b.layout.h &&
          a.layout.y + a.layout.h > b.layout.y
        )
          c.addIssue({ code: "custom", message: "模块布局存在重叠" });
      }),
    );
  });
export type Template = z.infer<typeof templateSchema>;
export type Source = {
  kind?: "pdf" | "web" | "video" | "text";
  moduleId?: string;
  resourceId: string;
  resourceName?: string;
  version: string;
  page: number;
  text: string;
  url?: string;
  timestamp?: number;
  start?: number;
  end?: number;
  createdAt?: number;
};
export type ModuleData = {
  text?: string;
  url?: string;
  transcript?: string;
  mediaResourceId?: string;
  time?: number;
  seek?: number;
  cards?: { id: string; front: string; back: string; source?: Source }[];
  tasks?: { id: string; text: string; done: boolean }[];
  nodes?: {
    id: string;
    parentId?: string;
    text: string;
    x: number;
    y: number;
  }[];
  mapScale?: number;
  mapPan?: { x: number; y: number };
  events?: { id: string; date: string; title: string; time: string }[];
  month?: string;
  selectedDate?: string;
  timer?: { mode: "focus" | "break"; remaining: number; endsAt?: number };
  quiz?: {
    id: string;
    type: "choice" | "short";
    question: string;
    options?: string[];
    answer: string;
    explanation: string;
  }[];
  answers?: Record<string, string>;
  submitted?: boolean;
  imageZoom?: number;
  autoSync?: boolean;
  autoTranslate?: boolean;
  webMode?: "embed" | "external";
};
export type Mod = {
  id: string;
  type: ModuleType;
  title: string;
  layout: z.infer<typeof layoutSchema>;
  group?: string;
  locked?: boolean;
  settings?: z.infer<typeof publicSettingsSchema>;
  data?: ModuleData;
  resourceId?: string;
  page?: number;
  zoom?: number;
  input?: string;
  output?: string;
  language?: string;
  source?: Source;
  messages?: { role: "user" | "assistant"; content: string; source?: Source }[];
};
export type Workspace = {
  id: string;
  title: string;
  description: string;
  modules: Mod[];
  updatedAt: number;
  createdAt: number;
  origin?: string;
};
export type Note = {
  id: string;
  workspaceId: string;
  moduleId: string;
  content: string;
  sources: Source[];
};
export type Resource = {
  id: string;
  name: string;
  version: string;
  file: Blob;
  createdAt: number;
};
export const uid = () => crypto.randomUUID();
export function safeTemplate(w: Workspace): Template {
  return {
    version: 1,
    title: w.title,
    description: w.description,
    modules: w.modules.map((m) => ({
      type: m.type,
      title: m.title,
      layout: { ...m.layout },
      ...(m.group ? { group: m.group } : {}),
      ...(m.locked ? { locked: true } : {}),
      ...(m.settings
        ? { settings: publicSettingsSchema.parse(m.settings) }
        : {}),
    })),
  };
}
export function fromTemplate(t: Template, origin?: string): Workspace {
  const groups = new Map<string, string>();
  t.modules.forEach((m) => {
    if (m.group && !groups.has(m.group)) groups.set(m.group, uid());
  });
  return {
    id: uid(),
    title: t.title,
    description: t.description,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    origin,
    modules: t.modules.map((m) => ({
      type: m.type,
      title: m.title,
      settings: m.settings ? { ...m.settings } : undefined,
      locked: m.locked,
      group: m.group ? groups.get(m.group) : undefined,
      id: uid(),
      layout: { ...m.layout },
    })),
  };
}
export const builtins: (Template & {
  id: string;
  category: string;
  author: string;
  uses: string;
  color: string;
})[] = [
  {
    id: "paper",
    title: "学术论文精读",
    description: "从阅读到理解，再到知识沉淀。让每一篇论文都读有所获。",
    category: "论文阅读",
    author: "LearnSpace",
    uses: "2.1k",
    color: "lavender",
    version: 1,
    modules: [
      { type: "pdf", title: "PDF 阅读", layout: { x: 0, y: 0, w: 6, h: 8 } },
      {
        type: "translate",
        title: "AI 翻译",
        layout: { x: 6, y: 0, w: 6, h: 4 },
      },
      { type: "chat", title: "AI 问答", layout: { x: 0, y: 8, w: 6, h: 5 } },
      { type: "note", title: "阅读笔记", layout: { x: 6, y: 4, w: 6, h: 9 } },
    ],
  },
  {
    id: "language",
    title: "语言学习工作台",
    description: "读懂原文，积累表达，构建属于你的语言学习空间。",
    category: "通用学习",
    author: "Emma",
    uses: "1.5k",
    color: "mint",
    version: 1,
    modules: [
      { type: "pdf", title: "阅读材料", layout: { x: 0, y: 0, w: 7, h: 8 } },
      {
        type: "translate",
        title: "词句翻译",
        layout: { x: 7, y: 0, w: 5, h: 4 },
      },
      { type: "note", title: "词汇笔记", layout: { x: 7, y: 4, w: 5, h: 4 } },
    ],
  },
  {
    id: "course",
    title: "课程笔记整理",
    description: "串联课程资料与课堂笔记，建立清晰的知识脉络。",
    category: "课程复习",
    author: "Carol",
    uses: "980",
    color: "peach",
    version: 1,
    modules: [
      { type: "pdf", title: "课程资料", layout: { x: 0, y: 0, w: 6, h: 8 } },
      { type: "note", title: "课程笔记", layout: { x: 6, y: 0, w: 6, h: 8 } },
      { type: "chat", title: "知识答疑", layout: { x: 0, y: 8, w: 12, h: 4 } },
    ],
  },
  {
    id: "compare",
    title: "双文献对比阅读",
    description: "两篇文献并排阅读，捕捉观点之间的联系与差异。",
    category: "技术学习",
    author: "Alex",
    uses: "1.2k",
    color: "blue",
    version: 1,
    modules: [
      { type: "pdf", title: "文献 A", layout: { x: 0, y: 0, w: 4, h: 9 } },
      { type: "pdf", title: "文献 B", layout: { x: 4, y: 0, w: 4, h: 9 } },
      { type: "note", title: "对比笔记", layout: { x: 8, y: 0, w: 4, h: 9 } },
    ],
  },
];
export function suggest(prompt: string): Template {
  const b =
    builtins[
      /对比|两篇|两份/.test(prompt)
        ? 3
        : /语言|英语|单词/.test(prompt)
          ? 1
          : /课程|复习/.test(prompt)
            ? 2
            : 0
    ];
  return {
    version: 1,
    title: b.title,
    description: prompt,
    modules: b.modules.map((m) => ({ ...m, layout: { ...m.layout } })),
  };
}
