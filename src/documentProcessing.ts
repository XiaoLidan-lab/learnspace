import type { ReadContext, ConnectedInput } from "./connections";
import type { Resource, Source } from "./model";
export type DocumentReport = {
  resourceId: string;
  version: string;
  name: string;
  method: "direct" | "retrieval" | "digest";
  pages: number;
  parts: number;
};
export type DocumentReader = (
  resource: Resource,
  moduleId: string,
) => Promise<Pick<ConnectedInput, "text" | "kind" | "sources">>;
export type DigestCall = (
  action: string,
  payload: unknown,
  signal?: AbortSignal,
) => Promise<any>;
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
};
let cache: ReturnType<typeof import("idb").openDB> | undefined;
async function summaryCache() {
  if (!cache) {
    const { openDB } = await import("idb");
    cache = openDB("learnspace-document-analysis-v1", 1, {
      upgrade(db) {
        db.createObjectStore("summaries");
      },
    });
  }
  return cache;
}
// Only summaries are cached locally, scoped to workspace, task, module and file version.
export async function digestText(
  text: string,
  scope: string,
  call: DigestCall,
  signal?: AbortSignal,
) {
  check(signal);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const key = JSON.stringify([
    scope,
    Array.from(new Uint8Array(hash), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join(""),
  ]);
  const db = await summaryCache().catch(() => undefined);
  const cached = await db?.get("summaries", key).catch(() => undefined);
  if (typeof cached === "string" && cached.trim() && cached.length <= 1800) {
    check(signal);
    return cached;
  }
  check(signal);
  const result = await call("documentDigest", { text }, signal);
  check(signal);
  if (typeof result !== "string" || !result.trim() || result.length > 1800)
    throw Error("分段分析返回格式不正确，请重试；已完成的分段可复用");
  if (!db) return result;
  // This is a disposable derived cache, not a growing copy of learning history.
  try {
    if ((await db.count("summaries")) >= 512) {
      const first = await db.getAllKeys("summaries", undefined, 1);
      if (first.length) await db.delete("summaries", first[0]);
    }
    await db.put("summaries", result, key);
  } catch {
    /* Cache quota must not discard a successful analysis. */
  }
  return result;
}
export async function reduceDigests(
  pieces: string[],
  budget: number,
  summarize: (text: string) => Promise<string>,
  signal?: AbortSignal,
) {
  let level = pieces;
  while (level.join("\n\n").length > budget) {
    const next: string[] = [];
    let batch = "";
    const flush = async () => {
      if (!batch) return;
      check(signal);
      const compact = await summarize(batch);
      if (compact.length >= batch.length)
        throw Error("分段汇总未能缩小内容，请重试");
      next.push(compact);
      batch = "";
    };
    for (const piece of level) {
      if (batch.length + piece.length + 2 > 7000) await flush();
      batch += (batch ? "\n\n" : "") + piece;
    }
    await flush();
    level = next;
    if (level.length === 1 && level[0].length > budget)
      throw Error("所选文档过多，汇总仍超过单次材料预算，请减少文档");
  }
  return level.join("\n\n");
}
export function createDocumentReader(options: {
  ctx: ReadContext;
  targetId: string;
  budget: number;
  query?: string;
  call: DigestCall;
  signal?: AbortSignal;
  progress?: (message: string) => void;
  reports?: DocumentReport[];
}): DocumentReader {
  return async (resource, moduleId) => {
    const { ctx, budget, query, call, signal, progress } = options;
    const { ensurePdfIndex, documentParts, retrievePdf } = await import(
      "./pdfIndex.js"
    );
    progress?.(`正在解析 ${resource.name}…`);
    const index = await ensurePdfIndex(resource, {
      signal,
      progress: (state) =>
        progress?.(`正在解析 ${resource.name} ${state.indexed}/${state.pages}`),
    });
    const source = (
      page: number,
      text: string,
      start = 0,
      end = start + text.length,
    ): Source => ({
      kind: "pdf",
      contentKind: "original",
      moduleId,
      resourceId: resource.id,
      version: resource.version,
      resourceName: resource.name.slice(0, 300),
      page,
      text: text.slice(0, 1200),
      start,
      end: Math.min(end, start + 1200),
    });
    // Targeted questions search the complete index rather than document prefixes.
    if (
      query &&
      !/总结|概述|概览|全文|整篇|全篇|核心|主旨|整体|主要内容|讲什么|讲了什么|结构|overview|summari[sz]|whole|entire/i.test(
        query,
      )
    ) {
      progress?.(`正在检索 ${resource.name} 中的相关段落…`);
      const hits = await retrievePdf(resource, query, signal, 3);
      if (!hits.length)
        throw Error(
          `“${resource.name}”中未检索到相关正文，请换个问法或选择具体段落；扫描页不支持 OCR。`,
        );
      const sources = hits.map((hit) =>
        source(
          hit.page,
          hit.text.slice(0, Math.min(1200, Math.floor((budget - 300) / 3))),
          hit.start,
          hit.end,
        ),
      );
      options.reports?.push({
        resourceId: resource.id,
        version: resource.version,
        name: resource.name.slice(0, 300),
        method: "retrieval",
        pages: index.pages,
        parts: sources.length,
      });
      return {
        text: sources
          .map((s) => `【${s.resourceName} · 定位 ${s.page}】\n${s.text}`)
          .join("\n\n"),
        kind: "original",
        sources,
      };
    }
    let total = 0,
      raw = "",
      long = false;
    for await (const part of documentParts(resource, signal)) {
      total++;
      const text = `【${resource.name} · 定位 ${part.page} · 分段 ${part.number}】\n${part.text}`;
      if (!long && raw.length + text.length + 2 <= budget)
        raw += (raw ? "\n\n" : "") + text;
      else {
        long = true;
        raw = "";
      }
      if (long && total > 128)
        throw Error(
          "文档超过128个处理分段，请按章节拆分文件；本次尚未调用 AI。",
        );
    }
    const reports = options.reports;
    const sources: Source[] = [];
    const pieces: string[] = [];
    // Cache identity includes task and module, and the precise file version.
    const scope = JSON.stringify([
      ctx.workspace.id,
      ctx.workspace.activeTaskId || "free",
      options.targetId,
      resource.id,
      resource.version,
      "digest-v1",
    ]);
    for await (const part of documentParts(resource, signal)) {
      check(signal);
      if ([1, Math.ceil(total / 2), total].includes(part.number))
        sources.push(source(part.page, part.text, part.start, part.end));
      if (!long) continue;
      progress?.(
        `正在分析 ${resource.name} ${part.number}/${total}，已完成分段会保留以便重试`,
      );
      try {
        pieces.push(
          await digestText(
            `【${resource.name} · 定位 ${part.page} · 分段 ${part.number}/${total}】\n${part.text}`,
            scope,
            call,
            signal,
          ),
        );
      } catch (error) {
        if (signal?.aborted) throw error;
        throw Error(
          `“${resource.name}”第 ${part.number}/${total} 段分析失败：${error instanceof Error ? error.message : "请求失败"}。原结果未替换，重新生成将复用已完成分段。`,
        );
      }
    }
    progress?.(
      long ? `正在合并 ${resource.name} 的全文知识点…` : "正在生成结果…",
    );
    const text = long
      ? await reduceDigests(
          pieces,
          Math.max(1800, budget - 200),
          (text) => digestText(text, scope, call, signal),
          signal,
        )
      : raw;
    reports?.push({
      resourceId: resource.id,
      version: resource.version,
      name: resource.name.slice(0, 300),
      method: long ? "digest" : "direct",
      pages: index.pages,
      parts: total,
    });
    return {
      text: long
        ? `【全文${total}段均已分析；以下为 AI 提取的学习要点，非逐字原文。来源定位仅为参考，不应编造引用。】\n${text}`
        : text,
      kind: long ? "ai" : "original",
      sources,
    };
  };
}
