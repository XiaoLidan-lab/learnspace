import type { Resource } from "./model";
export type ReadingFormat = "pdf" | "doc" | "docx" | "md" | "txt";
export const readingAccept =
  ".pdf,.doc,.docx,.md,.markdown,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown";
export function readingFormat(name: string): ReadingFormat {
  const ext = name.split(".").at(-1)?.toLowerCase();
  if (ext === "markdown") return "md";
  if (["pdf", "doc", "docx", "md", "txt"].includes(ext || ""))
    return ext as ReadingFormat;
  throw Error("支持 PDF、DOC、DOCX、Markdown 和 TXT 文件");
}
export const isPdfResource = (
  r: Pick<Resource, "name"> & Partial<Pick<Resource, "file">>,
) => r.file?.type === "application/pdf" || /\.pdf$/i.test(r.name);
export function documentSegments(text: string) {
  const parts: string[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + 6000);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end);
      if (newline > start + 3000) end = newline + 1;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts.length ? parts : [""];
}
export async function documentText(
  resource: Pick<Resource, "name" | "file" | "extractedText">,
) {
  const format = readingFormat(resource.name);
  if (format === "pdf") throw Error("PDF 请使用分页阅读器");
  if (resource.extractedText !== undefined) return resource.extractedText;
  if (format === "doc" || format === "docx")
    return (await import("./localWord")).readLocalWord(resource.file);
  const bytes = await resource.file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error("文本编码无法识别，请另存为 UTF-8 后重试");
  }
  if (text.includes("\0")) throw Error("文件不是可读取的纯文本");
  if (text.length > 1000000) throw Error("正文超过 100 万字，请拆分后上传");
  return text;
}
export async function prepareReadingFile(
  file: File,
): Promise<string | undefined> {
  const format = readingFormat(file.name);
  if (!file.size) throw Error("文件为空");
  const limit =
    format === "pdf" ? 50 : format === "md" || format === "txt" ? 2 : 3;
  if (file.size > limit * 1024 * 1024)
    throw Error(`此格式文件不能超过 ${limit} MB`);
  if (format === "pdf") {
    if (
      new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== "%PDF-"
    )
      throw Error("文件不是有效的 PDF");
    return;
  }
  if (format === "md" || format === "txt")
    return documentText({ name: file.name, file });
  return (await import("./localWord")).readLocalWord(file);
}
