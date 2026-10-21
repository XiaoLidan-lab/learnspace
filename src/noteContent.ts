import {
  uid,
  type ContentKind,
  type Mod,
  type Note,
  type Source,
} from "./model.js";
export const contentKindLabels: Record<ContentKind, string> = {
  original: "原文摘录",
  ai: "AI 生成",
  user: "用户编辑",
  mixed: "混合内容",
  unknown: "历史内容（来源类型未记录）",
};
export function selectionKind(source?: Source): ContentKind {
  return (
    source?.contentKind ||
    (source ? (source.kind === "text" ? "user" : "original") : "user")
  );
}
export function receivingNote(notes: Note[], workspaceId: string, mod: Mod) {
  const own = notes.filter(
    (n) => n.workspaceId === workspaceId && n.moduleId === mod.id,
  );
  return own.find((n) => n.id === mod.activeNoteId) || own[0];
}
// Titles are derived locally, including legacy notes with a generic provenance heading.
export function noteTitle(text: string, fallback = "未命名笔记"): string {
  const generic = new Set([...Object.values(contentKindLabels), "译文笔记", "参考资料"]);
  let fenced = false;
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const clean = raw.trim()
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)、]\s*)+/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ").trim();
    if (!clean || generic.has(clean) || /^[-=|\s]+$/.test(clean)
      || /^(?:参考材料|摘录来源)[（：:]/.test(clean)
      || /^(?:这段|这篇|该段|以下|下面|本文)?(?:文字|内容|回答|片段)?(?:的)?(?:核心内容|核心观点|总结|要点)?(?:是|如下)[：:]?$/.test(clean)) continue;
    const topic = clean.split(/[：:。！？!?；;]/)[0].trim() || clean;
    const chars = Array.from(topic);
    return chars.length > 32 ? chars.slice(0, 32).join("") + "…" : topic;
  }
  return fallback;
}
// Saving stays immediate and never makes an extra AI request.
export function titledTranslation(text: string): string {
  const body = text.trim();
  if (/^#{1,6}\s+\S/.test(body)) return body;
  return `### ${noteTitle(body, "译文笔记")}\n\n${body}`;
}
export function appendNote(
  old: Note | undefined,
  workspaceId: string,
  moduleId: string,
  text: string,
  source: Source | undefined,
  kind: ContentKind,
): Note {
  const label = source?.resourceName || "资料";
  const location =
    source && (!source.kind || source.kind === "pdf")
      ? ` · 第 ${source.page} 页`
      : source?.timestamp != null
        ? ` · ${Math.floor(source.timestamp)} 秒`
        : "";
  const body = kind === "original" ? `> ${text.replace(/\n/g, "\n> ")}` : text;
  const heading =
    kind === "ai" && /^#{1,6}\s+\S/.test(text)
      ? ""
      : `### ${noteTitle(text, contentKindLabels[kind])}\n\n*${contentKindLabels[kind]}*\n\n`;
  const added = `${heading}${body}${source ? `\n\n${kind === "original" ? "摘录来源" : "参考材料（不代表逐项证据）"}：${label}${location}` : ""}`;
  return {
    id: old?.id || uid(),
    workspaceId,
    moduleId,
    content: (old?.content ? old.content + "\n\n" : "") + added,
    sources: [...(old?.sources || []), ...(source ? [source] : [])],
    contentKind: old?.content
      ? old.contentKind === kind
        ? kind
        : "mixed"
      : kind,
  };
}
