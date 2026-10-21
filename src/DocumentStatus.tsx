import type { ModuleProps } from "./moduleProps";
export function DocumentStatus({
  mod,
  busy,
  progress,
  cancel,
}: {
  mod: ModuleProps["mod"];
  busy: boolean;
  progress: string;
  cancel: () => void;
}) {
  if (busy) {
    const label =
      progress.replace("，已完成分段会保留以便重试", "") || "正在处理…";
    // Fractions describe this stage only; AI generation has no measurable total.
    const fraction = label.match(/ (\d+)\/(\d+)(?:$|，)/);
    const total = fraction ? Number(fraction[2]) : 0;
    const current = fraction ? Number(fraction[1]) : 0;
    const measured = total > 0 && current <= total;
    const completed = label.startsWith("正在分析")
      ? Math.max(0, current - 1)
      : current;
    const displayLabel = label.replace(/ (\d+)\/(\d+)(?=$|，)/, "");
    return (
      <div className={`document-status-compact${measured ? " document-status-measured" : ""}`} role="status">
        {!measured && <span className="document-status-spinner" aria-hidden="true" />}
        <span className="document-status-label" title={displayLabel}>
          {displayLabel}
        </span>
        {measured && (
          <span className="document-status-count">
            {Math.floor((completed / total) * 100)}%
          </span>
        )}
        <button className="text-button" onClick={cancel}>取消</button>
        {measured && <progress className="document-status-bar" aria-label={`${displayLabel}进度`} max={total} value={completed} />}
      </div>
    );
  }
  const documents = mod.data?.flow?.documents;
  if (!documents?.length) return null;
  return (
    <details className="document-status-details">
      <summary>全文处理说明</summary>
      <div className="document-status small">
        {documents.map((d, i) => (
          <span key={`${d.resourceId}-${i}`}>
            {d.name} ·{" "}
            {d.method === "retrieval"
              ? `已检索全文，引用 ${d.parts} 个相关片段`
              : d.method === "digest"
                ? `全文 ${d.pages} 页/区段、${d.parts} 段分析完成，基于提取要点生成`
                : `已读取全文 ${d.pages} 页/区段`}
          </span>
        ))}
      </div>
    </details>
  );
}
