import type { Source } from "./model";
import { uniqueSources, sourceLabel } from "./learningPresentation";
export function SourceReferences({
  sources,
  jump,
}: {
  sources: Source[];
  jump: (source: Source) => void;
}) {
  const items = uniqueSources(sources);
  if (!items.length) return null;
  return (
    <details className="source-references">
      <summary>参考资料{items.length > 1 ? ` · ${items.length}` : ""}</summary>
      <div>
        {items.map((s, i) => (
          <button
            className="source-reference-link"
            key={i}
            onClick={() => jump(s)}
            title={s.text}
          >
            {sourceLabel(s)} ↗
          </button>
        ))}
      </div>
    </details>
  );
}
