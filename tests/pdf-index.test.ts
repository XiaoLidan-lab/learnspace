import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  ensurePdfIndex,
  pdfIndex,
  clearPdfIndex,
  searchPdf,
  retrievePdf,
  chunks,
  type PdfLoader,
} from "../src/pdfIndex";
import { store } from "../src/storage";
import type { Resource } from "../src/model";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const resource = (): Resource => ({
  id: crypto.randomUUID(),
  version: "v1",
  name: "合成资料.pdf",
  file: new Blob(["synthetic"], { type: "application/pdf" }),
  createdAt: 1,
});
function loader(
  texts: string[],
  seen: number[],
  fail = 0,
  destroyed = () => {},
): PdfLoader {
  return () => ({
    promise: Promise.resolve({
      numPages: texts.length,
      getPage: async (page) => {
        seen.push(page);
        if (page === fail) throw Error("synthetic damaged page");
        return {
          getTextContent: async () => ({ items: [{ str: texts[page - 1] }] }),
          cleanup: () => {},
        };
      },
    }),
    destroy: async () => {
      destroyed();
    },
  });
}
test("逐页全文索引与搜索覆盖尾页；相关块优先，中文空格及无结果可解释；命中数有上限", async () => {
  const r = resource(),
    seen: number[] = [];
  const texts = Array.from(
    { length: 149 },
    (_, i) => "Introduction common " + i,
  );
  texts.push(
    "ZXQ-742 repair protein operates only in alkaline water. 光 合 作 用 将 光 能 转 化 为 化 学 能。",
  );
  const indexed = await ensurePdfIndex(r, { load: loader(texts, seen) });
  assert.equal(indexed.complete, true);
  assert.equal(indexed.indexed, 150);
  assert.deepEqual(
    seen,
    Array.from({ length: 150 }, (_, i) => i + 1),
  );
  const tail = await searchPdf(r, "光合作用");
  assert.equal(tail.hits[0].page, 150);
  const retrieved = await retrievePdf(r, "Where does ZXQ-742 protein operate?");
  assert.equal(retrieved[0].page, 150);
  assert(retrieved[0].text.includes("alkaline water"));
  assert.equal((await searchPdf(r, "totally absent")).total, 0);
  assert.deepEqual(await retrievePdf(r, "nonexistentword"), []);
  const all = await searchPdf(r, "Introduction");
  assert.equal(all.total, 149);
  assert.equal(all.hits.length, 100);
  await ensurePdfIndex(r, {
    load: () => {
      throw Error("cache should avoid reparse");
    },
  });
  assert.equal(seen.length, 150);
});
test("解析可取消并从已提交的页继续；相同资源新版本不会复用旧全文", async () => {
  const r = resource(),
    seen: number[] = [],
    abort = new AbortController();
  const texts = Array.from({ length: 20 }, (_, i) => "page " + i);
  await assert.rejects(
    ensurePdfIndex(r, {
      signal: abort.signal,
      load: loader(texts, seen),
      progress: (state) => {
        if (state.indexed === 3) abort.abort();
      },
    }),
    { name: "AbortError" },
  );
  const completed = await ensurePdfIndex(r, { load: loader(texts, seen) });
  assert.equal(completed.indexed, 20);
  assert.equal(seen.filter((p) => p === 1).length, 1);
  const v2 = { ...r, version: "v2" };
  await ensurePdfIndex(v2, { load: loader(["new version unique"], []) });
  assert.equal((await searchPdf(v2, "page")).total, 0);
  assert.equal((await searchPdf(r, "page")).total, 20);
  assert.equal((await searchPdf(v2, "unique")).total, 1);
});
test("同一文件并发建立索引复用工作；一个读者取消不取消其他读者", async () => {
  const r = resource(),
    abort = new AbortController(),
    seen: number[] = [];
  let loads = 0;
  const load: PdfLoader = (file) => {
    loads++;
    return loader(
      Array.from({ length: 12 }, () => "shared"),
      seen,
    )(file);
  };
  const first = ensurePdfIndex(r, {
    signal: abort.signal,
    load,
    progress: (state) => {
      if (state.indexed === 2) abort.abort();
    },
  });
  const second = ensurePdfIndex(r, { load });
  const [one, two] = await Promise.allSettled([first, second]);
  assert.equal(one.status, "rejected");
  assert.equal(two.status, "fulfilled");
  assert.equal(loads, 1);
  assert.equal(seen.length, 12);
});
test("失败保留可恢复进度；扫描页标明无文字；清除派生缓存不删除原资料或笔记", async () => {
  const r = resource(),
    seen: number[] = [];
  await store.saveResource(r);
  const note = {
    id: crypto.randomUUID(),
    workspaceId: "test",
    moduleId: "note",
    content: "keep me",
    sources: [],
  };
  await store.saveNote(note);
  await assert.rejects(
    ensurePdfIndex(r, { load: loader(["a", "", "c", "d"], seen, 3) }),
  );
  assert.equal((await pdfIndex(r))?.indexed, 2);
  assert.equal((await pdfIndex(r))?.complete, false);
  assert.equal(
    (await ensurePdfIndex(r, { load: loader(["a", "", "c", "d"], seen) }))
      .empty,
    1,
  );
  await clearPdfIndex(r);
  assert.equal(await pdfIndex(r), undefined);
  assert.equal((await searchPdf(r, "a")).total, 0);
  assert((await store.resources()).some((x) => x.id === r.id));
  assert((await store.notes()).some((x) => x.id === note.id));
});
test("分块限制大小且有重叠，尾部内容不丢失", () => {
  const text = "第一段。\n" + "x".repeat(6000) + "唯一尾部词";
  assert(
    chunks("x".repeat(1200) + "。" + "y".repeat(2000)).every(
      (c) => c.text.length <= 1200,
    ),
  );
  const result = chunks(text);
  assert(result.length > 4);
  assert(result.every((c) => c.text.length <= 1200));
  assert(result.at(-1)!.text.includes("唯一尾部词"));
  for (let i = 1; i < result.length; i++)
    assert(result[i].start < result[i - 1].end);
});
