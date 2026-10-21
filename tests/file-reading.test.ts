import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractLocalWord as extractWord } from "../src/wordParser";
import { readLocalWord, type WordWorker } from "../src/localWord";
import { zipSync, strToU8 } from "fflate";
import {
  readingFormat,
  documentText,
  documentSegments,
  prepareReadingFile,
} from "../src/fileReading";
import { ensurePdfIndex, retrievePdf } from "../src/pdfIndex";
import { readConnection, type Connection } from "../src/connections";
import { store } from "../src/storage";
import type { Resource, Workspace } from "../src/model";
const fixture = (ext: string) =>
  readFile(new URL(`./fixtures/file-reading/sample.${ext}`, import.meta.url));
test("real binary DOC and DOCX both extract synthetic body; corrupt files fail", async () => {
  for (const ext of ["doc", "docx"])
    assert.match(
      await extractWord(await fixture(ext)),
      /Attention uses query, key and value/,
    );
  await assert.rejects(extractWord(Buffer.from("not a word")), /有效的 Word/);
  await assert.rejects(
    extractWord(
      Buffer.concat([Buffer.from([80, 75, 3, 4]), Buffer.alloc(600)]),
    ),
    /无法读取 Word/,
  );
});
test("Markdown/TXT validate locally, preserve body and segment losslessly", async () => {
  assert.equal(readingFormat("NOTE.MARKDOWN"), "md");
  assert.throws(() => readingFormat("payload.exe"), /支持/);
  const text = "# 合成笔记\n\nAttention Query Key Value\n".repeat(400);
  const file = new File([text], "synthetic.md", { type: "text/markdown" });
  assert.equal(await prepareReadingFile(file), text);
  assert.equal(documentSegments(text).join(""), text);
  assert(documentSegments(text).every((s) => s.length <= 6000));
  await assert.rejects(
    prepareReadingFile(new File(["fake"], "fake.pdf")),
    /有效的 PDF/,
  );
  await assert.rejects(
    prepareReadingFile(new File([new Uint8Array([0, 1, 2])], "fake.txt")),
    /纯文本/,
  );
  await assert.rejects(
    prepareReadingFile(new File([new Uint8Array([255])], "bad.txt")),
    /UTF-8/,
  );
});
test("non-PDF reader reuses full-text retrieval, persists parsed text and keeps source identity", async () => {
  const text = "intro ".repeat(1300) + "Attention uses Query Key Value.\n";
  const r: Resource = {
    id: "file-reading-synthetic",
    name: "synthetic.docx",
    version: "v1",
    file: new Blob([await fixture("docx")]),
    createdAt: 0,
    extractedText: text,
  };
  await store.saveResource(r);
  assert.equal(
    (await store.resources()).find((x) => x.id === r.id)?.extractedText,
    text,
  );
  const index = await ensurePdfIndex(r);
  assert(index.pages > 1);
  const hits = await retrievePdf(r, "Attention");
  assert(hits.length > 0);
  const mod = {
    id: "reader",
    type: "pdf" as const,
    title: "文件阅读",
    resourceId: r.id,
    layout: { x: 0, y: 0, w: 8, h: 16 },
  };
  const target = {
    id: "summary",
    type: "summary" as const,
    title: "摘要",
    layout: { x: 8, y: 0, w: 4, h: 8 },
  };
  const w = { id: "synthetic-w", modules: [mod, target] } as Workspace;
  const selection = {
    kind: "pdf" as const,
    moduleId: mod.id,
    resourceId: r.id,
    resourceName: r.name,
    version: r.version,
    page: 2,
    text: "Attention uses Query Key Value.",
    createdAt: 0,
  };
  const edge: Connection = {
    id: "edge",
    source: { moduleId: mod.id, port: "selection" },
    target: { moduleId: target.id, field: "input" },
    trigger: "manual",
    mode: "replace",
  };
  const result = await readConnection(edge, {
    workspace: w,
    resources: [r],
    notes: [],
    selection,
  });
  assert.equal(result.text, selection.text);
  assert.equal(result.sources[0].resourceId, r.id);
  assert.equal(result.kind, "original");
  await assert.rejects(
    readConnection(edge, {
      workspace: w,
      resources: [r],
      notes: [],
      selection: { ...selection, version: "stale" },
    }),
    /重新选择|指定来源/,
  );
});
test("local worker client extracts without any network or login and terminates after success/failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let network = 0,
    terminated = 0;
  globalThis.fetch = async () => {
    network++;
    throw Error("network disabled");
  };
  const factory = () => {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as (() => void) | null,
      terminate() {
        terminated++;
      },
      postMessage(bytes: ArrayBuffer) {
        void extractWord(new Uint8Array(bytes)).then(
          (text) => worker.onmessage?.({ data: { text } }),
          (error) => worker.onmessage?.({ data: { error: error.message } }),
        );
      },
    };
    return worker as unknown as WordWorker;
  };
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: function () {
      return factory();
    },
  });
  try {
    for (const ext of ["doc", "docx"])
      assert.match(
        await readLocalWord(new Blob([await fixture(ext)]), factory),
        /Attention/,
      );
    for (const ext of ["doc", "docx"])
      assert.match(
        (await prepareReadingFile(
          new File([await fixture(ext)], `local.${ext}`),
        ))!,
        /Attention/,
      );
    assert.match(
      await documentText({
        name: "restored.docx",
        file: new Blob([await fixture("docx")]),
      }),
      /Attention/,
    );
    await assert.rejects(
      readLocalWord(new Blob(["invalid"]), factory),
      /有效的 Word/,
    );
    assert.equal(network, 0);
    assert.equal(terminated, 6);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorker)
      Object.defineProperty(globalThis, "Worker", originalWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
});
test("DOCX XML preserves Chinese paragraphs, tabs and entities, skips deleted text and rejects invalid archives", async () => {
  const zip = (xml: string) => zipSync({ "word/document.xml": strToU8(xml) });
  const doc = zip(
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>注意力 &amp; Query</w:t><w:tab/><w:t>Key</w:t></w:r><w:del><w:r><w:t>已删除</w:t></w:r></w:del></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>',
  );
  assert.equal(await extractWord(doc), "注意力 & Query\tKey\n第二段\n");
  await assert.rejects(
    extractWord(zipSync({ "other.xml": strToU8("not word") })),
    /DOCX/,
  );
  await assert.rejects(
    extractWord(
      zip(
        '<!DOCTYPE document [<!ENTITY x SYSTEM "https://example.invalid">]><document/>',
      ),
    ),
    /外部声明/,
  );
  await assert.rejects(
    extractWord(
      zip(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:t>bad',
      ),
    ),
    /无法读取/,
  );
});
