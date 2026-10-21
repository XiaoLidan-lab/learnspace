import { flowSource } from "./flowData.js";
import type { Mod, Note, Resource, Source, Workspace } from "./model.js";
import {
  connectionSchema,
  customEvidence,
  connectedInputSchema,
  customInputsSchema,
} from "./customAI.js";
import type { z } from "zod";
import type { SelectionContext } from "./events.js";
export type Connection = z.infer<typeof connectionSchema>;
export type ConnectedInput = z.infer<typeof connectedInputSchema>;
export { outputPorts, portNames, connectionError } from "./connectionGraph.js";
import { connectionError } from "./connectionGraph.js";
// A bounded deterministic content version for update notices, not an authorization token.
export function contentVersion(value: unknown) {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `c1-${text.length}-${(h >>> 0).toString(16)}`;
}
export type ReadContext = {
  workspace: Workspace;
  notes: Note[];
  resources: Resource[];
  selection: SelectionContext | null;
  selections?: Record<string, SelectionContext>;
};
function bound(c: Connection, ctx: ReadContext) {
  if (c.source.needsBinding)
    throw Error(
      "来源尚未绑定，请在来源设置中重新绑定篇目、检索关键词或当前资料",
    );
  const issue = connectionError(ctx.workspace.modules, [c]);
  if (issue) throw Error(issue);
  const m = ctx.workspace.modules.find((m) => m.id === c.source.moduleId)!;
  const note =
    c.source.port === "note"
      ? ctx.notes.find(
          (n) =>
            n.id === c.source.noteId &&
            n.moduleId === m.id &&
            n.workspaceId === ctx.workspace.id &&
            n.taskId === ctx.workspace.activeTaskId,
        )
      : undefined;
  if (c.source.port === "note" && !note)
    throw Error(
      "指定笔记在当前任务中不可用；不会读取其他篇目或其他任务。请重新选择篇目。",
    );
  return { m, note };
}
export function upstreamVersion(c: Connection, ctx: ReadContext): string {
  const { m, note } = bound(c, ctx);
  if (c.source.port === "note")
    return contentVersion([note!.content, note!.contentKind, note!.sources]);
  if (c.source.port === "text")
    return contentVersion([
      m.data?.text || "",
      m.data?.flow?.inputs.map((p) => p.kind),
    ]);
  if (c.source.port === "output")
    return contentVersion([
      m.output,
      m.source,
      m.data?.custom?.runs.filter((r) => r.status === "succeeded").at(-1)?.id,
    ]);
  if (c.source.port === "timer") return contentVersion(m.data?.timer);
  if (!["selection", "retrieval"].includes(c.source.port))
    return contentVersion([
      flowSource(m, c.source.port, ctx, c),
      ctx.resources.find(
        (r) => r.id === (m.resourceId || m.data?.mediaResourceId),
      )?.version,
    ]);
  const r =
    m.type === "pdf"
      ? ctx.resources.find((r) => r.id === m.resourceId)
      : undefined;
  if (m.type === "pdf" && !r)
    throw Error("原文件不可用，请在此设备重新绑定原始文件");
  if (c.source.port === "retrieval")
    return contentVersion([r!.id, r!.version, c.source.query]);
  if (c.source.range === "document")
    return contentVersion([r!.id, r!.version, "document"]);
  const s = ctx.selections?.[m.id] || ctx.selection;
  if (
    !s ||
    s.moduleId !== m.id ||
    !s.text.trim() ||
    (r && (s.resourceId !== r.id || s.version !== r.version))
  )
    throw Error(`请先在指定来源模块“${m.title}”中选择文字或检索片段，再重试`);
  // Reject stale text selections after upstream edits.
  if (
    m.type !== "pdf" &&
    !(m.type === "video" ? m.data?.transcript : m.data?.text)?.includes(s.text)
  )
    throw Error("选区已不属于最新正文，请重新选择");
  return contentVersion([
    r?.version,
    m.data?.text,
    s.text,
    s.page,
    s.start,
    s.end,
  ]);
}
export async function readConnection(
  c: Connection,
  ctx: ReadContext,
  signal?: AbortSignal,
  documentReader?: import("./documentProcessing").DocumentReader,
): Promise<ConnectedInput> {
  const { m, note } = bound(c, ctx),
    version = upstreamVersion(c, ctx);
  let text = "",
    kind: ConnectedInput["kind"] = "user",
    sources: Source[] = [];
  const local = (
    value: string,
    contentKind: ConnectedInput["kind"],
    noteId?: string,
  ): Source => ({
    kind: "text",
    contentKind,
    moduleId: m.id,
    resourceId: noteId || m.id,
    noteId,
    resourceName: m.title.slice(0, 300),
    version,
    page: 1,
    text: value.slice(0, 1200),
    start: 0,
    end: Math.min(1200, value.length),
  });
  if (
    !["text", "note", "output", "selection", "retrieval"].includes(
      c.source.port,
    )
  ) {
    const value = flowSource(m, c.source.port, ctx, c);
    text = value.text;
    kind = value.kind;
    sources = [local(text, kind)];
    if (c.source.port === "answer")
      sources.push(
        ...(m.messages
          ?.filter((v) => v.role === "assistant")
          .at(-1)
          ?.sources?.slice(0, 2) || []),
      );
    if (m.type === "web" || m.type === "video")
      sources[0] = {
        ...sources[0],
        kind: m.type,
        url: m.data?.url,
        timestamp: undefined,
      };
  }
  if (c.source.port === "text") {
    text = m.data?.text || "";
    kind = m.data?.flow?.inputs.length ? "mixed" : "user";
    sources = [
      local(text, kind),
      ...(m.data?.flow?.inputs.flatMap((p) => p.sources).slice(0, 2) || []),
    ];
  }
  if (c.source.port === "note") {
    text = note!.content;
    kind = note!.contentKind || "unknown";
    sources = [
      local(text, kind, note!.id),
      ...note!.sources.slice(0, 2).map((s) => ({
        ...s,
        text: s.text.slice(0, 1200),
        resourceName: s.resourceName?.slice(0, 300),
      })),
    ];
  }
  if (c.source.port === "output") {
    text = m.output || "";
    kind = "ai";
    const run = m.data?.custom?.runs
      .filter((r) => r.status === "succeeded")
      .at(-1);
    const lineage =
      run?.result?.text === text
        ? customEvidence(run)
            .filter((e) => run.result?.citations.includes(e.id))
            .map((e) => e.source)
        : []; // Legacy summary/translation has no immutable output-to-input snapshot.

    sources = [
      local(text, "ai"),
      ...lineage.slice(0, 2).map((s) => ({
        ...s,
        text: s.text.slice(0, 1200),
        resourceName: s.resourceName?.slice(0, 300),
      })),
    ];
  }
  if (c.source.port === "selection" && c.source.range === "document") {
    const resource = ctx.resources.find((r) => r.id === m.resourceId)!;
    if (documentReader) {
      const result = await documentReader(resource, m.id);
      text = result.text;
      kind = result.kind;
      sources = result.sources;
    } else {
      const { readFullDocument } = await import("./pdfIndex.js");
      const target = ctx.workspace.modules.find(
        (t) => t.id === c.target.moduleId,
      );
      const full = await readFullDocument(resource, {
        signal,
        maxChars: target?.type === "custom-ai" ? 8000 : 23000,
      });
      text = full.text;
      kind = "original";
      sources = full.locations.map((p) => ({
        kind: "pdf" as const,
        contentKind: "original" as const,
        moduleId: m.id,
        resourceId: resource.id,
        resourceName: resource.name.slice(0, 300),
        version: resource.version,
        page: p.page,
        text: p.text.slice(0, 1200),
        start: 0,
        end: Math.min(1200, p.text.length),
      }));
    }
  }
  if (c.source.port === "selection" && c.source.range !== "document") {
    const selected = ctx.selections?.[m.id] || ctx.selection!;
    text = selected.text;
    kind = m.type === "pdf" ? "original" : selected.contentKind || "user";
    sources = [
      {
        ...selected,
        contentKind: kind,
        text: text.slice(0, 1200),
        resourceName: selected.resourceName?.slice(0, 300),
        version: m.type === "pdf" ? selected.version : version,
      },
    ];
  }
  if (c.source.port === "retrieval") {
    const resource = ctx.resources.find((r) => r.id === m.resourceId)!;
    const { ensurePdfIndex, retrievePdf } = await import("./pdfIndex.js");
    await ensurePdfIndex(resource, { signal });
    const hits = await retrievePdf(resource, c.source.query!, signal, 3);
    if (!hits.length)
      throw Error("文件检索无相关片段；请修改关键词。扫描页暂不支持 OCR。");
    sources = hits.map((h) => ({
      kind: "pdf",
      contentKind: "original",
      moduleId: m.id,
      resourceId: resource.id,
      resourceName: resource.name.slice(0, 300),
      version: resource.version,
      page: h.page,
      text: h.text.slice(0, 1200),
      start: h.start,
      end: h.end,
    }));
    text = sources
      .map(
        (s) =>
          `【${s.resourceName} · ${/\.pdf$/i.test(s.resourceName || "") ? "第 " + s.page + " 页" : "文本区段 " + s.page}】\n${s.text}`,
      )
      .join("\n\n");
    kind = "original";
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!text.trim()) throw Error("来源内容为空，请先在来源模块保存内容");
  const limit = c.source.range === "document" ? 23000 : 8000;
  if (text.length > limit)
    throw Error(`来源超过 ${limit} 字符，请缩小内容范围；未截断或覆盖输入`);
  return connectedInputSchema.parse({
    text,
    kind,
    sources,
    connection: {
      id: c.id,
      workspaceId: ctx.workspace.id,
      taskId: ctx.workspace.activeTaskId,
      moduleId: m.id,
      port: c.source.port,
      ...(c.source.range ? { range: c.source.range } : {}),
      noteId: note?.id,
      version,
      fetchedAt: Date.now(),
    },
  });
}
export function applyConnectedInput(
  mod: Mod,
  c: Connection,
  input: ConnectedInput,
  workspaceId: string,
  taskId: string | undefined,
  expected: string,
): Partial<Mod> {
  if (
    input.connection?.id !== c.id ||
    input.connection.workspaceId !== workspaceId ||
    input.connection.taskId !== taskId ||
    mod.id !== c.target.moduleId
  )
    throw Error("取数任务作用域已变化，请重新获取");
  const runtime = mod.data?.custom || { inputs: {}, runs: [] };
  if (JSON.stringify(runtime.inputs[c.target.field] || null) !== expected)
    throw Error("输入已被编辑，请重新获取；本次未覆盖");
  const inputs = customInputsSchema.parse({
    ...runtime.inputs,
    [c.target.field]: input,
  });
  return { data: { ...mod.data, custom: { ...runtime, inputs } } };
}
