import { workspaceMaterials } from "./materialBindings.js";
import { z } from "zod";
import {
  customConfigSchema,
  connectionSchema,
  defaultCustomConfig,
} from "./customAI.js";
import { connectionError, privateConnectionSource } from "./connectionGraph.js";
import { types, labels, MAX_MODULES, type ModuleType } from "./definitions.js";
import type { LearningTask } from "./tasks.js";
export { types, labels, MAX_MODULES } from "./definitions.js";
export type { ModuleType } from "./definitions.js";
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
    instanceId: z.string().min(1).max(80).optional(),
    customConfig: customConfigSchema.optional(),
  })
  .strict();
export const templateSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    title: z.string().min(1).max(80),
    description: z.string().max(1000),
    modules: z.array(moduleSchema).max(MAX_MODULES),
    connections: z.array(connectionSchema).max(48).optional(),
  })
  .strict()
  .superRefine((t, c) => {
    const issue = (message: string) => c.addIssue({ code: "custom", message });
    if (new TextEncoder().encode(JSON.stringify(t)).length > 102400)
      issue("模板不能超过 100 KB");
    if (
      t.version === 2 &&
      /(?:sk-[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9_.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,})/.test(
        JSON.stringify(t),
      )
    )
      issue("模板疑似包含 API Key 或凭证，请移除后保存");
    if (t.version === 1) {
      if (
        t.connections !== undefined ||
        t.modules.some((m) => m.customConfig || m.type === "custom-ai")
      )
        issue("自定义模块及连接需要 V2 模板");
    } else {
      if (!t.connections) issue("V2 模板缺少连接列表");
      const ids = t.modules.map((m) => m.instanceId);
      if (
        ids.some((id) => !id || !/^m[1-9][0-9]*$/.test(id)) ||
        new Set(ids).size !== ids.length
      )
        issue("模板模块标识无效或重复");
      if (t.modules.some((m) => m.group && !/^g[1-9][0-9]*$/.test(m.group)))
        issue("模板分组标识无效");
      if (t.modules.some((m) => (m.type === "custom-ai") !== !!m.customConfig))
        issue("模块配置不兼容");
      for (const e of t.connections || []) {
        const source = t.modules.find(
          (m) => m.instanceId === e.source.moduleId,
        );
        const privateSource = privateConnectionSource(
          source?.type,
          e.source.port,
        );
        if (
          !/^c[1-9][0-9]*$/.test(e.id) ||
          e.source.noteId ||
          e.source.query ||
          e.source.itemId ||
          !!e.source.needsBinding !== privateSource
        )
          issue("模板连接不得携带私人绑定，私人来源必须重新绑定");
      }
      const error = connectionError(
        t.modules.map((m) => ({ ...m, id: m.instanceId! })),
        t.connections || [],
      );
      if (error) issue(error);
    }

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
  noteId?: string;
  contentKind?: ContentKind;
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
  custom?: import("./customAI.js").CustomRuntime;
  flow?: import("./flowSchema.js").FlowState;
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
  quizAttempts?: import("zod").z.infer<
    typeof import("./taskAssistantSchemas.js").quizAttemptSchema
  >[];
  imageZoom?: number;
  autoSync?: boolean;
  autoTranslate?: boolean;
  webMode?: "embed" | "external";
};
export type Mod = {
  customConfig?: import("./customAI.js").CustomConfig;
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
  activeNoteId?: string;
  messages?: {
    role: "user" | "assistant";
    content: string;
    source?: Source;
    sources?: Source[];
  }[];
};
export type Workspace = {
  id: string;
  title: string;
  description: string;
  modules: Mod[];
  connections?: import("zod").z.infer<
    typeof import("./customAI.js").connectionSchema
  >[];
  updatedAt: number;
  createdAt: number;
  origin?: string;
  tasks?: LearningTask[];
  activeTaskId?: string;
  isolationVersion?: 1;
  cloud?: {
    ownerId: string;
    revision: number;
    syncedHash: string;
    syncedAt: number;
  };
};
export type Note = {
  id: string;
  workspaceId: string;
  moduleId: string;
  content: string;
  sources: Source[];
  contentKind?: ContentKind;
  originRun?: { moduleId: string; runId: string };
  taskId?: string;
};
export type ContentKind = "original" | "ai" | "user" | "mixed" | "unknown";
export type Resource = {
  extractedText?: string;
  id: string;
  name: string;
  version: string;
  file: Blob;
  createdAt: number;
};
export const uid = () => crypto.randomUUID();
export function safeTemplate(w: Workspace): Template {
  const v2 =
    w.modules.some((m) => m.type === "custom-ai") ||
    !!workspaceMaterials(w).length;
  const ids = new Map(w.modules.map((m, i) => [m.id, `m${i + 1}`]));
  const groups = new Map<string, string>();
  const result = {
    version: v2 ? (2 as const) : (1 as const),
    title: w.title,
    description: w.description,
    modules: w.modules.map((m) => {
      if (m.group && !groups.has(m.group))
        groups.set(m.group, `g${groups.size + 1}`);
      return {
        type: m.type,
        title: m.title,
        layout: { ...m.layout },
        ...(v2 ? { instanceId: ids.get(m.id) } : {}),
        ...(m.group ? { group: groups.get(m.group) } : {}),
        ...(m.locked ? { locked: true } : {}),
        ...(m.settings
          ? { settings: publicSettingsSchema.parse(m.settings) }
          : {}),
        ...(v2 && m.type === "custom-ai"
          ? {
              customConfig: structuredClone(
                m.customConfig || defaultCustomConfig(),
              ),
            }
          : {}),
      };
    }),
    ...(v2
      ? {
          connections: workspaceMaterials(w)
            .filter(
              (e) =>
                w.modules.some((m) => m.id === e.source.moduleId) &&
                w.modules.some((m) => m.id === e.target.moduleId),
            )
            .map((e, i) => ({
              id: `c${i + 1}`,
              source: {
                moduleId: ids.get(e.source.moduleId)!,
                port: e.source.port,
                ...(e.source.range ? { range: e.source.range } : {}),
                ...(e.source.itemId ||
                privateConnectionSource(
                  w.modules.find((m) => m.id === e.source.moduleId)?.type,
                  e.source.port,
                )
                  ? { needsBinding: true as const }
                  : {}),
              },
              target: {
                moduleId: ids.get(e.target.moduleId)!,
                field: e.target.field,
              },
              trigger: "manual" as const,
              mode: "replace" as const,
            })),
        }
      : {}),
  };
  return result;
}
export function fromTemplate(input: Template, origin?: string): Workspace {
  const raw = { ...input } as Record<string, unknown>;
  for (const key of [
    "id",
    "category",
    "author",
    "uses",
    "color",
    "sharedMaterials",
  ])
    delete raw[key];
  const t = templateSchema.parse(raw);
  const groups = new Map<string, string>(),
    ids = new Map(t.modules.map((m) => [m.instanceId, uid()]));
  t.modules.forEach((m) => {
    if (m.group && !groups.has(m.group)) groups.set(m.group, uid());
  });
  return {
    id: uid(),
    isolationVersion: 1,
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
      id: t.version === 2 ? ids.get(m.instanceId)! : uid(),
      layout: { ...m.layout },
      ...(m.customConfig
        ? {
            customConfig: structuredClone(
              m.customConfig || defaultCustomConfig(),
            ),
          }
        : {}),
    })),
    ...(t.version === 2
      ? {
          connections: (t.connections || []).map((e) => ({
            ...structuredClone(e),
            id: uid(),
            source: { ...e.source, moduleId: ids.get(e.source.moduleId)! },
            target: { ...e.target, moduleId: ids.get(e.target.moduleId)! },
          })),
        }
      : {}),
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
      { type: "pdf", title: "文件阅读", layout: { x: 0, y: 0, w: 6, h: 8 } },
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
