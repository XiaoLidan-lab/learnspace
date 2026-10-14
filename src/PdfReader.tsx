import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  Minus,
  Plus,
  Languages,
  MessageCircle,
  NotebookPen,
  FileText,
} from "lucide-react";
import type { Mod, Resource, Source } from "./model";
import type { WorkspaceBus } from "./events";
import { SelectionTools } from "./SelectionTools";
pdfjs.GlobalWorkerOptions.workerSrc = worker;
export function PdfReader({
  mod,
  resources,
  update,
  upload,
  send,
  bus,
}: {
  bus: WorkspaceBus;
  mod: Mod;
  resources: Resource[];
  update: (p: Partial<Mod>) => void;
  upload: (f: File) => Promise<void>;
  send: (
    type: import("./model").ModuleType,
    text: string,
    source?: Source,
  ) => void;
}) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null),
    [error, setError] = useState(""),
    [selection, setSelection] = useState(""),
    [loading, setLoading] = useState(false),
    [search, setSearch] = useState(""),
    [matches, setMatches] = useState<number[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    layer = useRef<HTMLDivElement>(null);
  const resource = resources.find((r) => r.id === mod.resourceId);
  const page = mod.page || 1;
  const zoom = mod.zoom || 1;
  useEffect(() => {
    setDoc(null);
    setError("");
    if (!resource) return;
    let active = true;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    setLoading(true);
    resource.file
      .arrayBuffer()
      .then((data) => {
        if (!active) return;
        task = pdfjs.getDocument({ data });
        return task.promise;
      })
      .then((d) => {
        if (active && d) {
          setDoc(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("PDF 读取失败，请重新上传文件");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [resource?.id]);
  useEffect(() => {
    if (!doc || !canvas.current || !layer.current) return;
    let cancelled = false;
    let render: pdfjs.RenderTask | undefined;
    let textLayer: pdfjs.TextLayer | undefined;
    const el = layer.current;
    doc
      .getPage(Math.min(page, doc.numPages))
      .then(async (p) => {
        if (cancelled) return;
        const vp = p.getViewport({ scale: zoom * 1.05 });
        const c = canvas.current!;
        c.width = vp.width * devicePixelRatio;
        c.height = vp.height * devicePixelRatio;
        c.style.width = `${vp.width}px`;
        c.style.height = `${vp.height}px`;
        el.replaceChildren();
        el.style.width = `${vp.width}px`;
        el.style.height = `${vp.height}px`;
        el.style.setProperty("--scale-factor", String(vp.scale));
        render = p.render({
          canvasContext: c.getContext("2d")!,
          viewport: vp,
          transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        });
        await render.promise;
        if (cancelled) return;
        textLayer = new pdfjs.TextLayer({
          textContentSource: await p.getTextContent(),
          container: el,
          viewport: vp,
        });
        await textLayer.render();
      })
      .catch((e) => {
        if (!cancelled && e.name !== "RenderingCancelledException")
          setError("页面加载失败");
      });
    return () => {
      cancelled = true;
      render?.cancel();
      textLayer?.cancel();
    };
  }, [doc, page, zoom]);
  const src: Source | undefined = resource
    ? {
        kind: "pdf",
        moduleId: mod.id,
        resourceId: resource.id,
        resourceName: resource.name,
        version: resource.version,
        page,
        text: selection,
      }
    : undefined;
  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <button
          title="上一页"
          disabled={!doc || page <= 1}
          onClick={() => update({ page: page - 1 })}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          <input
            aria-label="页码"
            type="number"
            min={1}
            max={doc?.numPages || 1}
            value={page}
            onChange={(e) =>
              update({
                page: Math.max(
                  1,
                  Math.min(doc?.numPages || 1, Number(e.target.value)),
                ),
              })
            }
          />{" "}
          / {doc?.numPages || "—"}
        </span>
        <button
          title="下一页"
          disabled={!doc || page >= doc.numPages}
          onClick={() => update({ page: page + 1 })}
        >
          <ChevronRight size={16} />
        </button>
        <span className="toolbar-divider" />
        <button
          title="缩小"
          onClick={() => update({ zoom: Math.max(0.4, zoom - 0.1) })}
        >
          <Minus size={14} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          title="放大"
          onClick={() => update({ zoom: Math.min(2, zoom + 0.1) })}
        >
          <Plus size={14} />
        </button>
        <label className="upload-small" title="上传 PDF">
          <Upload size={15} />
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f).catch((err) => setError(err.message));
            }}
          />
        </label>
      </div>
      {doc && (
        <div className="pdf-search">
          <input
            aria-label="搜索 PDF"
            placeholder="在文档中搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            disabled={searching || !search.trim()}
            onClick={() => {
              setSearching(true);
              setSearchError("");
              const query = search.toLowerCase();
              void (async () => {
                const found: number[] = [];
                for (let i = 1; i <= doc.numPages; i++) {
                  const p = await doc.getPage(i);
                  const t = await p.getTextContent();
                  if (
                    t.items
                      .map((x) => ("str" in x ? x.str : ""))
                      .join(" ")
                      .toLowerCase()
                      .includes(query)
                  )
                    found.push(i);
                }
                setMatches(found);
                if (found[0]) update({ page: found[0] });
              })()
                .catch(() => setSearchError("搜索失败，请重试"))
                .finally(() => setSearching(false));
            }}
          >
            {searching ? "搜索中…" : "搜索"}
          </button>
          {matches.length > 0 && (
            <select
              aria-label="搜索结果页"
              onChange={(e) => update({ page: Number(e.target.value) })}
            >
              {matches.map((p) => (
                <option key={p} value={p}>
                  第 {p} 页
                </option>
              ))}
            </select>
          )}
          {searchError && <span>{searchError}</span>}
        </div>
      )}
      {resource && (
        <div className="filename">
          <FileText size={12} />
          {resource.name}
        </div>
      )}
      {error ? (
        <div className="module-empty">
          <p>{error}</p>
        </div>
      ) : !resource ? (
        <div className="module-empty">
          <div className="empty-icon pdf">
            <FileText size={30} />
          </div>
          <h3>从一份资料开始</h3>
          <p>上传 PDF，把阅读与思考放在一起</p>
          <label className="btn primary">
            <Upload size={15} />
            上传 PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f).catch((err) => setError(err.message));
              }}
            />
          </label>
          <span className="small">支持 PDF · 最大 50 MB</span>
          {resources.length > 0 && (
            <select
              aria-label="选择已有资料"
              value=""
              onChange={(e) => update({ resourceId: e.target.value, page: 1 })}
            >
              <option value="">或选择已有资料</option>
              {resources
                .filter((r) => r.file.type === "application/pdf")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          )}
        </div>
      ) : loading ? (
        <div className="module-empty">正在加载资料…</div>
      ) : (
        <div
          className="pdf-scroll"
          onMouseUp={() => {
            const s = window.getSelection();
            setSelection(
              s && layer.current?.contains(s.anchorNode)
                ? s.toString().trim()
                : "",
            );
          }}
        >
          <div className="pdf-page">
            <canvas ref={canvas} />
            <div className="textLayer" ref={layer} />
          </div>
        </div>
      )}
      {src && (
        <SelectionTools text={selection} source={src} bus={bus} send={send} />
      )}
    </div>
  );
}
