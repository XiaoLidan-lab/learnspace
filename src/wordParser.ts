import "./wordEnvironment";
import type { Buffer } from "buffer/index.js";
import WordOleExtractor from "word-extractor/lib/word-ole-extractor.js";
import BufferReader from "word-extractor/lib/buffer-reader.js";
import { unzipSync, strFromU8 } from "fflate";
import { SaxesParser } from "saxes";
// Adapt the existing DOC binary reader in this worker only, never in the page.
const environment = globalThis as unknown as {
  Buffer?: unknown;
  process?: unknown;
};
const maximumText = 1000000;
const wordNamespace =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function docxText(bytes: Uint8Array) {
  let count = 0,
    total = 0;
  const files = unzipSync(bytes, {
    filter(entry) {
      if (++count > 1000 || (total += entry.originalSize) > 20 * 1024 * 1024)
        throw Error("文件展开后过大，请拆分后重试");
      return entry.name === "word/document.xml";
    },
  });
  const xml = files["word/document.xml"];
  if (!xml) throw Error("不是可读取的 DOCX 文件，或文件已加密");
  const parser = new SaxesParser({ xmlns: true });
  const parts: string[] = [];
  let textLength = 0,
    inText = false,
    deleted = 0;
  const append = (text: string) => {
    if ((textLength += text.length) > maximumText)
      throw Error("正文超过 100 万字符，请拆分文件");
    parts.push(text);
  };
  parser.on("doctype", () => {
    throw Error("不支持包含外部声明的文档");
  });
  parser.on("opentag", (tag) => {
    if (tag.uri !== wordNamespace) return;
    if (tag.local === "del") deleted++;
    if (deleted) return;
    if (tag.local === "t") inText = true;
    if (tag.local === "tab") append("\t");
    if (tag.local === "br" || tag.local === "cr") append("\n");
  });
  parser.on("text", (text) => {
    if (inText && !deleted) append(text);
  });
  parser.on("closetag", (tag) => {
    if (tag.uri !== wordNamespace) return;
    if (tag.local === "t") inText = false;
    if (tag.local === "del") deleted--;
    if (tag.local === "p" && !deleted) append("\n");
  });
  parser.write(strFromU8(xml)).close();
  return parts.join("");
}
export async function extractLocalWord(bytes: Uint8Array): Promise<string> {
  if (!bytes.length || bytes.length > 3 * 1024 * 1024)
    throw Error("Word 文件为空或超过 3 MB");
  let text: string;
  try {
    const isOle =
      bytes.length >= 8 &&
      [208, 207, 17, 224, 161, 177, 26, 225].every(
        (value, i) => bytes[i] === value,
      );
    if (isOle) {
      const BinaryBuffer = environment.Buffer as typeof Buffer;
      const reader = new BufferReader(BinaryBuffer.from(bytes));
      try {
        text = (await new WordOleExtractor().extract(reader)).getBody();
      } finally {
        await reader.close();
      }
    } else if (bytes[0] === 80 && bytes[1] === 75) text = docxText(bytes);
    else throw Error("不是有效的 Word 文件");
  } catch (e) {
    throw Error(
      `无法读取 Word：文件可能损坏、加密或不受支持。${e instanceof Error ? e.message : "请另存为 DOCX 或 TXT"}`,
    );
  }
  if (text.length > maximumText) throw Error("正文超过 100 万字符，请拆分文件");
  if (!text.trim()) throw Error("文档没有可提取的正文，扫描内容暂不支持识别");
  return text;
}
