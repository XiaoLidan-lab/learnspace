import type { Mod, Source } from "./model";
// Distinguish a user-edited draft from the last material copied into the tool.
export function hasEditedDraft(mod: Mod) {
  return (
    !!mod.input?.trim() &&
    mod.type !== "chat" &&
    mod.data?.flow?.materialMode !== "sources" &&
    mod.input !== mod.data?.flow?.lastText &&
    !(mod.data?.flow?.lastText == null && mod.input === mod.source?.text)
  );
}
export function uniqueSources(sources: Source[]) {
  return sources.filter(
    (s, i) =>
      sources.findIndex(
        (v) =>
          v.resourceId === s.resourceId &&
          v.version === s.version &&
          v.page === s.page &&
          v.moduleId === s.moduleId &&
          v.noteId === s.noteId &&
          v.start === s.start &&
          v.end === s.end,
      ) === i,
  );
}
export function sourceLabel(source: Source) {
  const name = source.resourceName || "参考资料";
  if ((source.kind === "pdf" || !source.kind) && source.page > 0)
    return `${name} · ${/\.(docx?|md|markdown|txt)$/i.test(name) ? "区段" : "第"} ${source.page}${/\.(docx?|md|markdown|txt)$/i.test(name) ? "" : " 页"}`;
  if (source.timestamp != null)
    return `${name} · ${Math.floor(source.timestamp)} 秒`;
  return name;
}
