import type { Workspace, Resource } from "./model";
import { projectWorkspace } from "./tasks";
import type { Evidence } from "./taskAssistantSchemas";
import { ensurePdfIndex, retrievePdf, type PdfLoader } from "./pdfIndex";
// Reuse a local, versioned full-text index; only bound resources are eligible.
export async function taskResources(
  w: Workspace,
  taskId: string,
  resources: Resource[],
  signal: AbortSignal,
  load?: PdfLoader,
  query?: string,
  progress?: (message: string) => void,
) {
  const evidence: Evidence[] = [],
    coverage: string[] = [];
  const modules = projectWorkspace({ ...w, activeTaskId: taskId }).modules;
  const question = query || w.tasks?.find((t) => t.id === taskId)?.goal || "";
  const candidates: { evidence: Evidence; score: number }[] = [];
  const seen = new Set<string>();
  for (const m of modules.filter((m) => m.type === "pdf" && m.resourceId)) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const r = resources.find((r) => r.id === m.resourceId);
    if (!r) {
      coverage.push(`${m.title}：本机原文件缺失，无法检索；请重新绑定原文件。`);
      continue;
    }
    const key = JSON.stringify([r.id, r.version]);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const unit = /\.pdf$/i.test(r.name) ? "页" : "文本区段";
      const index = await ensurePdfIndex(r, {
        signal,
        load,
        progress: (state) =>
          progress?.(
            `${r.name}：全文解析 ${state.indexed}/${state.pages} ${unit}`,
          ),
      });
      const hits = await retrievePdf(r, question, signal);
      for (const hit of hits)
        candidates.push({
          score: hit.score,
          evidence: {
            id: "",
            label: `${r.name} · 第 ${hit.page} ${unit}`,
            text: hit.text,
            kind: "original",
            moduleId: m.id,
            locator: { resourceId: r.id, version: r.version, page: hit.page },
          },
        });
      coverage.push(
        `${r.name}：已索引 ${index.pages} ${unit}，关键词检索找到 ${hits.length} 个候选片段。`,
      );
      if (!hits.length)
        coverage.push(
          `${r.name}：没有与本次问题匹配的片段，未将无关内容作为依据；可改用文中的关键词。`,
        );
      if (index.empty)
        coverage.push(
          `${r.name}：${index.empty} ${unit}无可提取文本；扫描内容不支持 OCR。`,
        );
    } catch (e) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      coverage.push(
        `${r.name}：全文解析或检索失败，未作为本次依据。请在阅读器重试或清除派生缓存。`,
      );
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  evidence.push(...candidates.slice(0, 6).map((c) => c.evidence));
  if (candidates.length)
    coverage.push(
      "本次按相关性选取最多六个文档片段，不代表模型阅读了全文；检索为本地关键词匹配。",
    );
  if (modules.some((m) => ["image", "video", "web"].includes(m.type)))
    coverage.push(
      "图片和视频不做 OCR/转写，网页不自动抓取；仅读取模块已有的文字或字幕。",
    );
  return { evidence, coverage };
}
