import { lazy, Suspense, useState } from "react";
import { FileText, ChevronDown } from "lucide-react";
import type { MaterialCandidate, SharedMaterial } from "./sharedMaterials";
const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((m) => ({ default: m.MarkdownContent })),
);
export function MaterialPicker({
  candidates,
  selected,
  change,
  disabled,
}: {
  candidates: MaterialCandidate[];
  selected: string[];
  change: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<string>();
  return (
    <section className="material-picker">
      <h3>
        附带学习资料 <span>可选</span>
      </h3>
      <p>
        仅勾选的资料会公开给社区用户查看和下载。不勾选时只发布模块配置、布局和学习材料预设。聊天记录不会附带，笔记可按篇选择。
      </p>
      {!candidates.length ? (
        <div className="material-empty">此工作台没有可附带的学习资料。</div>
      ) : (
        <>
          <div className="material-picker-tools">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                change(
                  candidates.filter((c) => !c.unavailable).map((c) => c.id),
                )
              }
            >
              选择全部可分享资料
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => change([])}
            >
              清空选择
            </button>
            <span>
              已选 {selected.length} / {candidates.length}
            </span>
          </div>
          {candidates.map((c) => (
            <div className="material-choice" key={c.id}>
              <label>
                <input
                  type="checkbox"
                  disabled={disabled || !!c.unavailable}
                  checked={selected.includes(c.id)}
                  onChange={() =>
                    change(
                      selected.includes(c.id)
                        ? selected.filter((id) => id !== c.id)
                        : [...selected, c.id],
                    )
                  }
                />
                <FileText size={16} />
                <span>
                  <b>{c.name}</b>
                  <small>
                    {c.moduleTitle} ·{" "}
                    {c.resource
                      ? `${(c.resource.file.size / 1024 / 1024).toFixed(2)} MB`
                      : c.kind === "url"
                        ? "链接"
                        : `${c.value?.length || 0} 字`}
                    {c.unavailable && ` · ${c.unavailable}`}
                  </small>
                </span>
              </label>
              {!c.resource && (
                <button
                  type="button"
                  className="material-preview-toggle"
                  aria-expanded={preview === c.id}
                  onClick={() =>
                    setPreview(preview === c.id ? undefined : c.id)
                  }
                >
                  查看内容
                  <ChevronDown size={12} />
                </button>
              )}
              {preview === c.id &&
                (c.kind === "note" ? (
                  <div className="material-note-preview">
                    <Suspense fallback={<p role="status">正在加载预览…</p>}>
                      <MarkdownContent>{c.value || ""}</MarkdownContent>
                    </Suspense>
                  </div>
                ) : (
                  <pre>{c.value}</pre>
                ))}
            </div>
          ))}
        </>
      )}
      {selected.length > 0 && (
        <div className="material-public-notice">
          将公开 {selected.length}{" "}
          项资料。发布前请确认所选内容可以分享；单个文件最多 50 MB，合计最多 100
          MB。
        </div>
      )}
    </section>
  );
}
export function SharedMaterialList({
  materials,
}: {
  materials: SharedMaterial[];
}) {
  return !materials.length ? null : (
    <section className="shared-material-list">
      <h3>附带 {materials.length} 项学习资料</h3>
      <p>
        安装后会将以下资料一并保存到此设备。指定笔记、选区和检索关键词仍需在学习材料中重新选择。
      </p>
      <ul>
        {materials.map((m, i) => (
          <li key={i}>
            <FileText size={14} />
            <span>{m.name}</span>
            <small>
              {m.kind === "file"
                ? `${(m.size / 1024 / 1024).toFixed(2)} MB`
                : m.kind === "url"
                  ? "链接"
                  : `${m.text.length} 字`}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
