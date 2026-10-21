import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { pdfFixture } from "./pdfFixture";
import { ensurePdfIndex, retrievePdf, searchPdf } from "../src/pdfIndex";

test("真实 PDF.js 解析 24 页 PDF，尾页搜索和检索保留页码", async () => {
  // PDF.js uses this standard API; Node 20 test runtime needs a small shim.
  if (!(Promise as any).withResolvers)
    (Promise as any).withResolvers = function () {
      let resolve: any, reject: any;
      const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      return { promise, resolve, reject };
    };
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = pdfFixture(
    Array.from({ length: 24 }, (_, i) =>
      i === 23
        ? "ZXQ-742 operates only in alkaline water. AMBER-ORCHID-742."
        : "General study notes.",
    ),
  );
  const r = {
    id: "real-pdf-24",
    version: "v1",
    name: "synthetic.pdf",
    file: new Blob([bytes]),
    createdAt: 1,
  };
  const index = await ensurePdfIndex(r, {
    load: () => getDocument({ data: bytes, useSystemFonts: true }),
  });
  assert.equal(index.indexed, 24);
  assert.equal(index.empty, 0);
  assert.equal((await searchPdf(r, "AMBER-ORCHID-742")).hits[0].page, 24);
  const hits = await retrievePdf(r, "ZXQ-742 environment");
  assert.equal(hits[0].page, 24);
  assert.match(hits[0].text, /alkaline/);
});
