import { openDB } from "idb";
// Derived cache is separate from user records: no upgrade lock on existing tabs.
const db = openDB("learnspace-pdf-cache-v1", 1, {
  upgrade(d) {
    d.createObjectStore("pdfPages", {
      keyPath: ["resourceId", "version", "page"],
    });
    d.createObjectStore("pdfIndexes", { keyPath: ["resourceId", "version"] });
  },
  blocking() {
    void db.then((d) => d.close());
  },
});
import type { Resource } from "./model";
export type PdfLoading = {
  promise: Promise<{
    numPages: number;
    getPage: (page: number) => Promise<{
      getTextContent: () => Promise<{
        items: ({ str: string; hasEOL?: boolean } | object)[];
      }>;
      cleanup?: () => void;
    }>;
  }>;
  destroy: () => Promise<void>;
};
export type PdfLoader = (
  resource: Resource,
) => PdfLoading | Promise<PdfLoading>;
export type PdfIndex = {
  resourceId: string;
  version: string;
  pages: number;
  indexed: number;
  empty: number;
  complete: boolean;
};
export type PdfPage = {
  resourceId: string;
  version: string;
  page: number;
  text: string;
};
export type PdfHit = {
  resourceId: string;
  version: string;
  page: number;
  text: string;
  start: number;
  end: number;
  score: number;
};
const aborted = () => new DOMException("Aborted", "AbortError");
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw aborted();
};
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const defaultLoader: PdfLoader = async (r) => {
  const { isPdfResource, documentText, documentSegments } = await import(
    "./fileReading"
  );
  if (isPdfResource(r)) return (await import("./pdfDocument")).openPdf(r.file);
  const segments = documentSegments(await documentText(r));
  return {
    promise: Promise.resolve({
      numPages: segments.length,
      getPage: async (page: number) => ({
        getTextContent: async () => ({
          items: [{ str: segments[page - 1], hasEOL: true }],
        }),
      }),
    }),
    destroy: async () => {},
  };
};

type Job = {
  abort: AbortController;
  listeners: Set<(s: PdfIndex) => void>;
  promise: Promise<PdfIndex>;
  done: boolean;
};
const jobs = new Map<string, Job>();
export async function pdfIndex(
  resource: Pick<Resource, "id" | "version">,
): Promise<PdfIndex | undefined> {
  return (await db).get("pdfIndexes", [resource.id, resource.version]);
}
export async function clearPdfIndex(
  resource: Pick<Resource, "id" | "version">,
) {
  const key = JSON.stringify([resource.id, resource.version]);
  const job = jobs.get(key);
  job?.abort.abort();
  await job?.promise.catch(() => {});
  const tx = (await db).transaction(["pdfIndexes", "pdfPages"], "readwrite");
  const keys = await tx
    .objectStore("pdfPages")
    .getAllKeys(
      IDBKeyRange.bound(
        [resource.id, resource.version, 0],
        [resource.id, resource.version, Infinity],
      ),
    );
  for (const key of keys) await tx.objectStore("pdfPages").delete(key);
  await tx.objectStore("pdfIndexes").delete([resource.id, resource.version]);
  await tx.done;
}
export async function ensurePdfIndex(
  resource: Resource,
  options: {
    signal?: AbortSignal;
    progress?: (index: PdfIndex) => void;
    load?: PdfLoader;
  } = {},
): Promise<PdfIndex> {
  check(options.signal);
  const cached = await pdfIndex(resource);
  check(options.signal);
  if (cached?.complete) {
    options.progress?.(cached);
    return cached;
  }
  const key = JSON.stringify([resource.id, resource.version]);
  let job = jobs.get(key);
  if (!job || job.abort.signal.aborted) {
    const abort = new AbortController();
    const created: Job = {
      abort,
      listeners: new Set(),
      done: false,
      promise: Promise.resolve(undefined!),
    };
    created.promise = (async () => {
      const loading = await (options.load || defaultLoader)(resource);
      const stop = () => {
        void loading.destroy().catch(() => {});
      };
      abort.signal.addEventListener("abort", stop, { once: true });
      try {
        check(abort.signal);
        const doc = await loading.promise;
        let state: PdfIndex =
          cached && cached.pages === doc.numPages
            ? { ...cached, complete: false }
            : {
                resourceId: resource.id,
                version: resource.version,
                pages: doc.numPages,
                indexed: 0,
                empty: 0,
                complete: false,
              };
        for (let page = state.indexed + 1; page <= doc.numPages; page++) {
          check(abort.signal);
          const p = await doc.getPage(page);
          let text: string;
          try {
            text = (await p.getTextContent()).items
              .map((x) =>
                "str" in x
                  ? x.str + ("hasEOL" in x && x.hasEOL ? "\n" : " ")
                  : "",
              )
              .join("")
              .trim();
          } finally {
            p.cleanup?.();
          }
          check(abort.signal);
          state = {
            ...state,
            indexed: page,
            empty: state.empty + (!text.trim() ? 1 : 0),
            complete: page === doc.numPages,
          };
          const tx = (await db).transaction(
            ["pdfPages", "pdfIndexes"],
            "readwrite",
          );
          await tx.objectStore("pdfPages").put({
            resourceId: resource.id,
            version: resource.version,
            page,
            text,
          });
          await tx.objectStore("pdfIndexes").put(state);
          await tx.done;
          for (const notify of created.listeners) notify(state);
          await pause(); // Let navigation, paint and cancellation run between pages.
        }
        return state;
      } finally {
        abort.signal.removeEventListener("abort", stop);
        await loading.destroy().catch(() => {});
      }
    })().finally(() => {
      created.done = true;
      if (jobs.get(key) === created) jobs.delete(key);
    });
    job = created;
    jobs.set(key, job);
  }
  const listener = (index: PdfIndex) => options.progress?.(index);
  job.listeners.add(listener);
  const current = job;
  let stop: () => void;
  return new Promise<PdfIndex>((resolve, reject) => {
    stop = () => reject(aborted());
    options.signal?.addEventListener("abort", stop, { once: true });
    current.promise.then(resolve, reject);
    if (options.signal?.aborted) stop();
  }).finally(() => {
    options.signal?.removeEventListener("abort", stop);
    current.listeners.delete(listener);
    // A cancelled reader must not interrupt another reader using the same index.
    if (!current.listeners.size && !current.done) current.abort.abort();
  });
}
export function normalizePdfText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function chunks(text: string, size = 1200, overlap = 160) {
  if (size < 100 || overlap < 0 || overlap >= size) throw Error("分块参数无效");
  const result: { text: string; start: number; end: number }[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + size);
    const boundary = Math.max(
      text.lastIndexOf("\n", end - 1),
      text.lastIndexOf("。", end - 1),
    );
    if (boundary > start + size / 2) end = boundary + 1;
    result.push({ text: text.slice(start, end), start, end });
    if (end >= text.length) break;
    start = end - overlap;
  }
  return result;
}
async function* pages(
  resource: Pick<Resource, "id" | "version">,
  signal?: AbortSignal,
) {
  let start = 1;
  for (;;) {
    check(signal);
    const batch = (await (
      await db
    ).getAll(
      "pdfPages",
      IDBKeyRange.bound(
        [resource.id, resource.version, start],
        [resource.id, resource.version, Infinity],
      ),
      12,
    )) as PdfPage[];
    if (!batch.length) break;
    for (const page of batch) {
      check(signal);
      yield page;
    }
    start = batch.at(-1)!.page + 1;
    await pause();
  }
}
// Iterate cached pages in bounded batches; callers never need the whole text in memory.
export async function* documentParts(resource: Resource, signal?: AbortSignal) {
  const index = await ensurePdfIndex(resource, { signal });
  if (index.empty)
    throw Error(
      "文档存在无法读取的页面，不能作为完整正文处理；扫描页暂不支持 OCR。",
    );
  let number = 0;
  for await (const page of pages(resource, signal)) {
    const bounded =
      page.text.length <= 6000
        ? [{ text: page.text, start: 0, end: page.text.length }]
        : chunks(page.text, 6000, 0);
    for (const chunk of bounded) {
      yield { ...chunk, page: page.page, number: ++number, pages: index.pages };
    }
  }
  if (!number) throw Error("文档没有可读取的正文");
}
// Uses the existing resumable local index and bounded batches; never truncates a document.
export async function readFullDocument(
  resource: Resource,
  options: { signal?: AbortSignal; maxChars?: number } = {},
) {
  const index = await ensurePdfIndex(resource, { signal: options.signal });
  if (index.empty)
    throw Error(
      "文档含无法提取正文的页面，暂不能完整读取；请改用选中内容。扫描页暂不支持 OCR。",
    );
  const parts: string[] = [],
    locations: PdfPage[] = [];
  let length = 0;
  for await (const p of pages(resource, options.signal)) {
    const part = `【${resource.name} · ${/\.pdf$/i.test(resource.name) ? "第 " + p.page + " 页" : "文本区段 " + p.page}】\n${p.text}`;
    length += part.length + (parts.length ? 2 : 0);
    if (length > (options.maxChars || 23000))
      throw Error(
        `整篇文档超过本次处理上限（${options.maxChars || 23000} 字符），请改用选中内容；未截断或覆盖输入`,
      );
    parts.push(part);
    if (locations.length < 3) locations.push(p);
  }
  if (!parts.length)
    throw Error("文档暂无可读取正文，请重新解析或改用选中内容");
  return { text: parts.join("\n\n"), locations };
}
const stopWords = new Set([
  "the",
  "and",
  "what",
  "does",
  "this",
  "that",
  "with",
  "from",
  "please",
  "解释",
  "什么",
  "如何",
  "请问",
  "资料",
  "当前",
  "任务",
  "总结",
  "说明",
  "根据",
  "哪些",
  "进行",
]);
export function queryTerms(query: string) {
  const normalized = normalizePdfText(query);
  const words = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  const terms = words.flatMap((word) =>
    /\p{Script=Han}/u.test(word)
      ? Array.from({ length: Math.max(0, word.length - 1) }, (_, i) =>
          word.slice(i, i + 2),
        )
      : word.length > 1
        ? [word]
        : [],
  );
  return [...new Set(terms)].filter((t) => !stopWords.has(t)).slice(0, 80);
}
export async function searchPdf(
  resource: Pick<Resource, "id" | "version">,
  query: string,
  signal?: AbortSignal,
) {
  const needle = normalizePdfText(query),
    hits: PdfHit[] = [];
  let total = 0;
  if (!needle) return { hits, total };
  for await (const p of pages(resource, signal)) {
    const normalized = normalizePdfText(p.text),
      at = normalized.indexOf(needle);
    if (at < 0) continue;
    total++;
    if (hits.length < 100)
      hits.push({
        ...p,
        text: normalized.slice(Math.max(0, at - 60), at + needle.length + 150),
        start: at,
        end: at + needle.length,
        score: 1,
      });
  }
  return { hits, total };
}
export async function retrievePdf(
  resource: Pick<Resource, "id" | "version">,
  query: string,
  signal?: AbortSignal,
  limit = 6,
): Promise<PdfHit[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const top: PdfHit[] = [];
  for await (const p of pages(resource, signal))
    for (const chunk of chunks(p.text)) {
      const normalized = normalizePdfText(chunk.text);
      const found = terms.filter((t) => normalized.includes(t));
      if (!found.length) continue;
      const score =
        (found.length / terms.length) * 10 +
        found.reduce(
          (sum, t) => sum + Math.log1p(normalized.split(t).length - 1),
          0,
        ) /
          Math.sqrt(Math.max(1, normalized.length / 200));
      top.push({
        resourceId: p.resourceId,
        version: p.version,
        page: p.page,
        ...chunk,
        score,
      });
      top.sort(
        (a, b) => b.score - a.score || a.page - b.page || a.start - b.start,
      );
      if (top.length > limit * 3) top.length = limit * 3;
    }
  // Overlapping chunks from the same page should not crowd out other evidence.
  const result: PdfHit[] = [];
  for (const hit of top) {
    if (
      result.some(
        (old) =>
          old.page === hit.page &&
          Math.min(old.end, hit.end) - Math.max(old.start, hit.start) >
            Math.min(old.end - old.start, hit.end - hit.start) / 2,
      )
    )
      continue;
    result.push(hit);
    if (result.length >= limit) break;
  }
  return result;
}
