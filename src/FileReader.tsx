import { FileActions } from "./FileActions";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Upload, ChevronLeft, ChevronRight } from "lucide-react";
import type { ModuleProps } from "./moduleProps";
import type { Source } from "./model";
import {
  readingAccept,
  isPdfResource,
  documentText,
  documentSegments,
  readingFormat,
} from "./fileReading";
import { SelectionTools } from "./SelectionTools";
const PdfReader = lazy(() =>
  import("./PdfReader").then((m) => ({ default: m.PdfReader })),
);
const MarkdownContent = lazy(() =>
  import("./MarkdownContent").then((m) => ({ default: m.MarkdownContent })),
);
export function FileReader(p: ModuleProps) {
  const resource = p.resources.find((r) => r.id === p.mod.resourceId);
  return (
    <div className="file-reader-with-actions">
      {resource && isPdfResource(resource) ? (
        <Suspense fallback={<p role="status">正在加载 PDF 阅读器…</p>}>
          <PdfReader {...p} />
        </Suspense>
      ) : (
        <DocumentReader
          key={`${resource?.id || "empty"}:${resource?.version || ""}`}
          {...p}
        />
      )}
      {resource && <FileActions p={p} />}
    </div>
  );
}
function DocumentReader(p: ModuleProps) {
  const resource = p.resources.find((r) => r.id === p.mod.resourceId);
  const [segments, setSegments] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false),
    [selected, setSelected] = useState<Source>(),
    [locate, setLocate] = useState("");
  const content = useRef<HTMLDivElement>(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!resource) return;
    let active = true;
    setLoading(true);
    void documentText(resource)
      .then((text) => {
        if (active) setSegments(documentSegments(text));
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resource?.id, resource?.version]);
  const page = Math.min(Math.max(1, p.mod.page || 1), segments.length || 1);
  useEffect(() => {
    setSelected(undefined);
  }, [page, preview]);
  useEffect(
    () =>
      p.bus.on("file.navigate", (s) => {
        if (
          s.moduleId !== p.mod.id ||
          s.resourceId !== resource?.id ||
          s.version !== resource.version
        )
          return;
        p.update({ page: s.page });
        setPreview(false);
        setLocate(s.text);
      }),
    [p.bus, p.mod.id, resource?.id, resource?.version, p.update],
  );
  useEffect(() => {
    if (!locate || !content.current) return;
    const node = content.current.querySelector("pre")?.firstChild;
    if (!node) return;
    const start =
      node.textContent
        ?.toLocaleLowerCase()
        .indexOf(locate.toLocaleLowerCase()) ?? -1;
    if (start < 0) return;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + locate.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    content.current.scrollTop = Math.max(
      0,
      range.getBoundingClientRect().top -
        content.current.getBoundingClientRect().top +
        content.current.scrollTop -
        60,
    );
    select();
  }, [locate, page, segments]);
  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      await p.upload(file);
    } catch (e) {
      if (live.current)
        setError(e instanceof Error ? e.message : "文件上传失败");
    } finally {
      if (live.current) setUploading(false);
    }
  }
  function select() {
    const selection = window.getSelection();
    if (
      !resource ||
      !selection ||
      selection.isCollapsed ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !content.current?.contains(selection.anchorNode) ||
      !content.current?.contains(selection.focusNode)
    )
      return;
    const text = selection.toString().trim();
    if (!text) return;
    const start = (segments[page - 1] || "").indexOf(text);
    setSelected({
      kind: "pdf",
      contentKind: "original",
      moduleId: p.mod.id,
      resourceId: resource.id,
      resourceName: resource.name,
      version: resource.version,
      page,
      text,
      ...(start >= 0 ? { start, end: start + text.length } : {}),
    });
  }
  return (
    <div className="file-reader">
      <div className="file-reader-toolbar">
        <label
          className="btn mini file-reader-upload"
          aria-disabled={uploading}
        >
          <Upload size={14} />
          {uploading ? "正在解析…" : resource ? "更换文件" : "上传文件"}
          <input
            aria-label="上传阅读文件"
            type="file"
            accept={readingAccept}
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </label>
        {resource && (
          <span className="file-reader-name" title={resource.name}>
            {resource.name}
          </span>
        )}
        {resource && readingFormat(resource.name) === "md" && (
          <button
            className="btn mini"
            aria-pressed={preview}
            onClick={() => setPreview(!preview)}
          >
            {preview ? "查看原文" : "排版预览"}
          </button>
        )}
      </div>
      {!resource && (
        <div className="module-empty">
          <b>把文件放进来，开始阅读</b>
          <p>支持 PDF、DOC、DOCX、Markdown、TXT</p>
          <p>PDF 最大 50 MB；Word 最大 3 MB；文本最大 2 MB。</p>
        </div>
      )}
      {resource && ["doc", "docx"].includes(readingFormat(resource.name)) && (
        <p className="file-reader-hint">
          Word 以正文形式展示，部分排版可能不同。
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {(loading || uploading) && <p role="status">正在读取文件，请稍候…</p>}
      {!!segments.length && (
        <>
          <div className="file-reader-pagination">
            <button
              className="btn mini"
              aria-label="上一区段"
              disabled={page <= 1}
              onClick={() => p.update({ page: page - 1 })}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              文本区段 {page} / {segments.length} · 非原文件页码
            </span>
            <button
              className="btn mini"
              aria-label="下一区段"
              disabled={page >= segments.length}
              onClick={() => p.update({ page: page + 1 })}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div
            className="file-reader-content"
            ref={content}
            onMouseUp={select}
            onKeyUp={select}
            onTouchEnd={select}
            tabIndex={0}
            aria-label="文件正文"
          >
            {preview ? (
              <Suspense fallback={<p>正在排版…</p>}>
                <MarkdownContent>{segments[page - 1]}</MarkdownContent>
              </Suspense>
            ) : (
              <pre>{segments[page - 1]}</pre>
            )}
          </div>
          {selected && (
            <SelectionTools
              text={selected.text}
              source={selected}
              bus={p.bus}
              send={p.send}
            />
          )}
        </>
      )}
    </div>
  );
}
