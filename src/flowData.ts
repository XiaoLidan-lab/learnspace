import { z } from "zod";
import { customInputSchema, customSourceSchema } from "./customAI.js";
import type { Mod, Note, Resource, Source } from "./model.js";
import type { Connection, ConnectedInput, ReadContext } from "./connections.js";
import { uid } from "./model.js";
import { inputPorts, type Port } from "./connectionGraph.js";
import { appendNote } from "./noteContent.js";
import { flowStateSchema } from "./flowSchema.js";
const small = z.string().max(4000);
const taskRows = z
  .array(
    z
      .object({ id: z.string().max(100), text: small, done: z.boolean() })
      .strict(),
  )
  .max(100);
const cardRows = z
  .array(
    z.object({ id: z.string().max(100), front: small, back: small }).strict(),
  )
  .max(100);
const eventRows = z
  .array(
    z
      .object({
        id: z.string().max(100),
        title: small,
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((value) => {
            const d = new Date(value + "T00:00:00Z");
            return (
              Number.isFinite(d.getTime()) &&
              d.toISOString().slice(0, 10) === value
            );
          }, "日期无效"),
        time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict(),
  )
  .max(100);
const outlineRows = z
  .array(
    z
      .object({
        id: z.string().max(100),
        parentId: z.string().max(100).optional(),
        text: small,
      })
      .strict(),
  )
  .max(100);
const mediaSchema = z
  .object({
    resourceId: z.string().max(100).optional(),
    url: z.string().max(4000).optional(),
  })
  .strict();
function httpUrl(value: string) {
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("仅支持不含登录凭证的HTTP/HTTPS网址");
  return u.href;
}
export function flowSource(
  m: Mod,
  port: Port,
  ctx: ReadContext,
  c: Connection,
) {
  let value: unknown,
    text = "",
    kind: ConnectedInput["kind"] = "user";
  const pick = <T extends { id: string }>(rows: T[]) => {
    if (!c.source.itemId) return rows;
    const row = rows.find((r) => r.id === c.source.itemId);
    if (!row) throw Error("所选条目在当前任务不可用，请重新选择");
    return [row];
  };
  switch (port) {
    case "answer":
      text =
        m.messages?.filter((v) => v.role === "assistant").at(-1)?.content || "";
      kind = "ai";
      break;
    case "transcript":
      text = m.data?.transcript || "";
      kind = m.data?.flow?.inputs.length ? "mixed" : "user";
      break;
    case "outline":
      kind = m.source || m.data?.flow?.inputs.length ? "mixed" : "user";
      value = outlineRows.parse(
        (m.data?.nodes || []).map(({ id, parentId, text }) => ({
          id,
          parentId,
          text,
        })),
      );
      break;
    case "cards":
      value = cardRows.parse(
        pick(
          (m.data?.cards || []).map(({ id, front, back }) => ({
            id,
            front,
            back,
          })),
        ),
      );
      kind = m.data?.cards?.some((c) => c.source) ? "mixed" : "user";
      break;
    case "tasks":
      value = taskRows.parse(pick(m.data?.tasks || []));
      break;
    case "events":
      value = eventRows.parse(pick(m.data?.events || []));
      break;
    case "questions":
      value = m.data?.quiz || [];
      kind = "mixed";
      break;
    case "results":
      if (!m.data?.submitted)
        throw Error("请先提交测验，未提交的作答不能作为结果输出");
      value = (m.data.quiz || []).map((q) => ({
        question: q.question,
        type: q.type,
        answer: q.answer,
        userAnswer: m.data?.answers?.[q.id] || "",
        correct:
          q.type === "choice" ? m.data?.answers?.[q.id] === q.answer : "未评分",
        explanation: q.explanation,
      }));
      kind = "mixed";
      break;
    case "timer":
      value = m.data?.timer
        ? {
            ...m.data.timer,
            remaining: m.data.timer.endsAt
              ? Math.max(
                  0,
                  Math.ceil((m.data.timer.endsAt - Date.now()) / 1000),
                )
              : m.data.timer.remaining,
            label: "当前计时状态，不是已完成专注记录",
          }
        : undefined;
      break;
    case "web_url":
      text = httpUrl(m.data?.url || "");
      break;
    case "document":
    case "video_ref":
    case "image_ref": {
      const id = port === "document" ? m.resourceId : m.data?.mediaResourceId;
      const resource = ctx.resources.find((r) => r.id === id);
      const expected =
        port === "document"
          ? "application/pdf"
          : port === "video_ref"
            ? "video/"
            : "image/";
      if (resource && !resource.file.type.startsWith(expected))
        throw Error("文件类型与输出不匹配");
      if (resource) value = { resourceId: resource.id };
      else if (port !== "document" && m.data?.url)
        value = { url: httpUrl(m.data.url) };
      else throw Error("本设备未绑定对应文件，请先选择资料");
      break;
    }
    default:
      throw Error("此输出没有读取适配器");
  }
  if (value !== undefined) {
    if (Array.isArray(value) && !value.length) throw Error("来源没有可用条目");
    text = JSON.stringify(value);
  }
  if (!text.trim()) throw Error("来源内容为空，请先填写或生成内容");
  return { text, kind };
}
export function readableInput(p: ConnectedInput) {
  const port = p.connection?.port;
  if (
    ![
      "outline",
      "cards",
      "tasks",
      "questions",
      "results",
      "events",
      "timer",
    ].includes(port || "")
  )
    return p.text;
  const v = JSON.parse(p.text);
  if (!Array.isArray(v)) return `当前计时状态（不代表完成记录）：${p.text}`;
  return v
    .map((r: any) =>
      port === "cards"
        ? `问：${r.front}\n答：${r.back}`
        : port === "tasks"
          ? `${r.done ? "[已完成]" : "[未完成]"} ${r.text}`
          : port === "outline"
            ? r.text
            : port === "events"
              ? `${r.date} ${r.time} ${r.title}`
              : port === "results"
                ? `${r.question}\n作答：${r.userAnswer}\n结果：${r.correct === true ? "正确" : r.correct === false ? "错误" : "简答题未评分"}\n参考答案：${r.answer}\n${r.explanation}`
                : `${r.question}\n${r.answer}\n${r.explanation || ""}`,
    )
    .join("\n\n");
}
export function flowInputSignature(m: Mod) {
  return JSON.stringify([
    m.input,
    m.output,
    m.messages,
    m.data,
    m.source,
    m.activeNoteId,
    m.resourceId,
  ]);
}
export function flowPatch(
  m: Mod,
  edges: Connection[],
  packets: ConnectedInput[],
  workspaceId: string,
  taskId: string | undefined,
  options: { note?: Note; date?: string; time?: string } = {},
): { patch: Partial<Mod>; note?: Note } {
  const incoming = edges.filter((e) => e.target.moduleId === m.id);
  for (const p of packets) {
    const receipt = p.connection;
    const e = incoming.find((e) => e.id === receipt?.id);
    if (
      !e ||
      receipt?.workspaceId !== workspaceId ||
      receipt.taskId !== taskId ||
      receipt.moduleId !== e.source.moduleId ||
      receipt.port !== e.source.port ||
      receipt.range !== e.source.range
    )
      throw Error("连接或任务已变化，未应用内容");
    if (
      !inputPorts(m)
        .find((f) => f.id === e.target.field)
        ?.accept.includes(e.source.port)
    )
      throw Error("数据类型不匹配");
  }
  const old = (m.data?.flow?.inputs || []).filter(
    (p) => !packets.some((n) => n.connection?.id === p.connection?.id),
  );
  const state = flowStateSchema.parse({
    ...m.data?.flow,
    inputs: [...old, ...packets],
  });
  const sources = packets.flatMap((p) => p.sources);
  const text = packets.map(readableInput).join("\n\n");
  let patch: Partial<Mod> = { data: { ...m.data, flow: state } };
  const isField = (p: ConnectedInput, f: string) =>
    incoming.find((e) => e.id === p.connection?.id)?.target.field === f;
  const materials = state.inputs.filter((p) => {
    const e = incoming.find((e) => e.id === p.connection?.id);
    return (
      e &&
      p.connection?.workspaceId === workspaceId &&
      p.connection.taskId === taskId &&
      ["input", "context"].includes(e.target.field)
    );
  });
  if (
    ["summary", "translate", "cards", "quiz", "mindmap"].includes(m.type) &&
    packets.some((p) => isField(p, "input"))
  ) {
    const assembled = materials.map(readableInput).join("\n\n");
    state.lastText = assembled;
    patch.input = assembled;
    patch.source = sources[0];
    if (m.output && ["summary", "translate"].includes(m.type)) {
      state.previousOutput = {
        text: m.output,
        ...(m.source
          ? {
              source: customSourceSchema.parse({
                ...m.source,
                text: m.source.text.slice(0, 1200),
              }),
            }
          : {}),
      };
      patch.output = undefined;
      flowStateSchema.parse(state);
    }

    if (m.type === "translate") {
      patch.data!.autoTranslate = false;
      patch.data!.autoSync = false;
    }
  }
  if (m.type === "chat") patch.source = state.inputs[0]?.sources[0];
  if (m.type === "text" || m.type === "sticky")
    patch.data!.text = [m.data?.text, text].filter(Boolean).join("\n\n");
  if (m.type === "video" && packets.some((p) => isField(p, "transcript")))
    patch.data!.transcript = [
      m.data?.transcript,
      ...packets.filter((p) => isField(p, "transcript")).map(readableInput),
    ]
      .filter(Boolean)
      .join("\n\n");
  if (m.type === "image" && packets.some((p) => isField(p, "caption")))
    patch.data!.text = [
      m.data?.text,
      ...packets.filter((p) => isField(p, "caption")).map(readableInput),
    ]
      .filter(Boolean)
      .join("\n\n");
  if (m.type === "cards" && packets.some((p) => isField(p, "import"))) {
    const rows = packets
      .filter((p) => isField(p, "import"))
      .flatMap((p) => cardRows.parse(JSON.parse(p.text)));
    patch.data!.cards = [
      ...(m.data?.cards || []),
      ...rows.map((r) => ({ ...r, id: uid() })),
    ];
    if (patch.data!.cards.length > 1000) throw Error("卡片数量超过上限");
  }
  if (m.type === "mindmap" && packets.some((p) => isField(p, "import"))) {
    const rows = packets
      .filter((p) => isField(p, "import"))
      .flatMap((p) => outlineRows.parse(JSON.parse(p.text)));
    const ids = new Map(rows.map((r) => [r.id, uid()]));
    if (
      ids.size !== rows.length ||
      rows.some((r) => r.parentId && !ids.has(r.parentId))
    )
      throw Error("导图层级标识无效或重复，请分批获取");
    for (const r of rows) {
      let id: string | undefined = r.id;
      const seen = new Set<string>();
      while (id) {
        if (seen.has(id)) throw Error("导图大纲不能成环");
        seen.add(id);
        id = rows.find((r) => r.id === id)?.parentId;
      }
    }
    patch.data!.nodes = [
      ...(m.data?.nodes || []),
      ...rows.map((r, i) => ({
        ...r,
        id: ids.get(r.id)!,
        parentId: r.parentId ? ids.get(r.parentId) : undefined,
        x: 30 + (r.parentId ? 200 : 0),
        y: 30 + ((m.data?.nodes?.length || 0) + i) * 60,
      })),
    ];
  }
  if (m.type === "todo") {
    const tasks = packets.flatMap((p) =>
      p.connection?.port === "tasks"
        ? taskRows.parse(JSON.parse(p.text)).map((r) => r.text)
        : readableInput(p).split(/\n+/).filter(Boolean),
    );
    if (tasks.length > 100) throw Error("一次最多添加100条事项");
    patch.data!.tasks = [
      ...(m.data?.tasks || []),
      ...tasks.map((text) => ({ id: uid(), text, done: false })),
    ];
  }
  if (m.type === "calendar") {
    const date = options.date || m.data?.selectedDate;
    const rows = packets.flatMap((p) =>
      p.connection?.port === "events"
        ? eventRows.parse(JSON.parse(p.text))
        : (p.connection?.port === "tasks"
            ? taskRows.parse(JSON.parse(p.text)).map((r) => r.text)
            : [readableInput(p)]
          ).map((title) => ({
            id: uid(),
            title,
            date: date || "",
            time: options.time || "09:00",
          })),
    );
    eventRows.parse(rows);
    patch.data!.events = [
      ...(m.data?.events || []),
      ...rows.map((r) => ({ ...r, id: uid() })),
    ];
  }
  if (m.type === "pomodoro") {
    let focus = text;
    if (packets.some((p) => p.connection?.port === "tasks")) {
      const rows = packets.flatMap((p) => taskRows.parse(JSON.parse(p.text)));
      if (rows.length !== 1)
        throw Error("一次只能绑定一项专注内容，请选择具体待办");
      focus = rows[0].text;
    }
    patch.data!.text = focus.slice(0, 300);
  }
  if (
    ["pdf", "web", "video", "image"].includes(m.type) &&
    packets.some((p) => isField(p, "file") || isField(p, "url"))
  ) {
    const p = packets.find((p) => isField(p, "file") || isField(p, "url"))!;
    if (m.type === "web") patch.data!.url = httpUrl(p.text);
    else {
      const ref = mediaSchema.parse(JSON.parse(p.text));
      if (ref.url) httpUrl(ref.url);
      if (m.type === "pdf") {
        if (!ref.resourceId) throw Error("PDF需要本设备可用文件");
        patch.resourceId = ref.resourceId;
        patch.page = 1;
      } else {
        patch.data!.mediaResourceId = ref.resourceId;
        patch.data!.url = ref.url;
      }
    }
  }
  if (m.type === "note") {
    if (
      options.note &&
      (options.note.workspaceId !== workspaceId ||
        options.note.moduleId !== m.id ||
        options.note.taskId !== taskId)
    )
      throw Error("指定笔记不属于当前任务和模块");
    const kinds = new Set(packets.map((p) => p.kind));
    let note = appendNote(
      options.note,
      workspaceId,
      m.id,
      text,
      sources[0],
      kinds.size > 1 ? "mixed" : packets[0].kind,
    );
    note = {
      ...note,
      taskId,
      sources: [...(options.note?.sources || []), ...sources],
    };
    patch.activeNoteId = note.id;
    return { patch, note };
  }
  return { patch };
}
