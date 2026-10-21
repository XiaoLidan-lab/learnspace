import { useTextSelection } from "./useTextSelection";
import { useEffect, useRef, useState } from "react";
import { Copy, Download, ExternalLink, Upload, RefreshCw } from "lucide-react";
import type { ModuleProps } from "./moduleProps";
import { patchData } from "./moduleProps";
import { SelectionTools } from "./SelectionTools";
import {
  safeUrl,
  videoAdapter,
  webAdapter,
  localVideoAdapter,
} from "./platforms";
function useBlob(p: ModuleProps) {
  const r = p.resources.find((r) => r.id === p.mod.data?.mediaResourceId);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!r) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(r.file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [r?.id]);
  return { url, resource: r };
}
export function TextModule(p: ModuleProps) {
  const { mod, update, bus, send, notify } = p;
  const { ref: selectionRef, selection: selected } = useTextSelection();
  const content = mod.data?.text || "";
  useEffect(
    () =>
      bus.on("source.navigate", (source) => {
        if (source.moduleId !== mod.id) return;
        requestAnimationFrame(() => {
          const el = selectionRef.current;
          if (!el) return;
          el.focus();
          const start =
            source.start != null &&
            el.value.slice(
              source.start,
              source.end ?? source.start + source.text.length,
            ) === source.text
              ? source.start
              : el.value.indexOf(source.text);
          if (start >= 0)
            el.setSelectionRange(
              start,
              source.end ?? start + source.text.length,
            );
        });
      }),
    [bus, mod.id],
  );
  return (
    <div
      className={`text-module ${mod.type === "sticky" ? "sticky-module" : ""}`}
    >
      <div className="inner-toolbar">
        <select
          aria-label="文本格式"
          value={mod.settings?.format || "markdown"}
          onChange={(e) =>
            update({
              settings: {
                ...mod.settings,
                format: e.target.value as "markdown" | "plain",
              },
            })
          }
        >
          <option value="markdown">Markdown</option>
          <option value="plain">纯文本</option>
        </select>
        <button
          title="复制全文"
          onClick={() =>
            void navigator.clipboard
              .writeText(content)
              .then(() => notify("已复制"))
              .catch(() => notify("复制失败"))
          }
        >
          <Copy size={14} />
        </button>
        <button
          title="下载文本"
          onClick={() => {
            const u = URL.createObjectURL(
              new Blob([content], { type: "text/plain" }),
            );
            const a = document.createElement("a");
            a.href = u;
            a.download =
              mod.title + (mod.settings?.format === "plain" ? ".txt" : ".md");
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
          }}
        >
          <Download size={14} />
        </button>
      </div>
      <textarea
        ref={selectionRef}
        aria-label={mod.type === "sticky" ? "便签内容" : "编辑文本"}
        placeholder={
          mod.type === "sticky"
            ? "一个想法，一个提醒…"
            : "输入文本或 Markdown，选中文字可发送到其他模块…"
        }
        value={content}
        onChange={(e) => update(patchData(mod, { text: e.target.value }))}
      />
      <SelectionTools
        text={selected.text}
        source={{
          kind: "text",
          moduleId: mod.id,
          resourceId: mod.id,
          resourceName: mod.title,
          version: "local",
          page: 0,
          text: selected.text,
          start: selected.start,
          end: selected.end,
        }}
        bus={bus}
        send={send}
      />
      <span className="data-footer">自动保存 · {content.length} 字</span>
    </div>
  );
}
export function WebModule(p: ModuleProps) {
  const { mod, update, bus, send } = p;
  const [draft, setDraft] = useState(mod.data?.url || ""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  let adapter;
  try {
    if (mod.data?.url)
      adapter = webAdapter(mod.data.url, window.location.origin);
  } catch {}
  const open = () => {
    try {
      const url = safeUrl(draft);
      update(patchData(mod, { url, webMode: "embed" }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="web-module">
      <div className="url-toolbar">
        <input
          aria-label="网页地址"
          placeholder="https://…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") open();
          }}
        />
        <button className="btn mini" onClick={open}>
          浏览
        </button>
      </div>
      {error && <p className="inline-error">{error}</p>}
      {adapter ? (
        <>
          <div className="embed-notice">
            无法正常显示？
            <a href={adapter.url} target="_blank" rel="noopener noreferrer">
              在原站打开
              <ExternalLink size={12} />
            </a>
            <button
              onClick={() =>
                update(
                  patchData(mod, {
                    webMode:
                      mod.data?.webMode === "external" ? "embed" : "external",
                  }),
                )
              }
            >
              {mod.data?.webMode === "external" ? "在此打开" : "仅在原站浏览"}
            </button>
          </div>
          {mod.data?.webMode !== "external" && (
            <iframe
              ref={frame}
              title={mod.title}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="strict-origin-when-cross-origin"
              src={adapter.embedUrl}
              onLoad={() => {
                try {
                  const d = frame.current?.contentDocument;
                  if (d && adapter.capabilities.selection) {
                    d.addEventListener("selectionchange", () =>
                      setSelected(d.getSelection()?.toString() || ""),
                    );
                  }
                } catch {}
              }}
              onError={() => setError("网页无法加载，请在原网站打开")}
            />
          )}
          <label className="transcript-label">
            网页摘录
            {!adapter.capabilities.selection && (
              <small>可在此粘贴网页中要学习的段落</small>
            )}
          </label>
          <textarea
            aria-label="网页摘录"
            value={mod.data?.text || ""}
            onChange={(e) => update(patchData(mod, { text: e.target.value }))}
            onSelect={(e) =>
              setSelected(
                e.currentTarget.value.slice(
                  e.currentTarget.selectionStart,
                  e.currentTarget.selectionEnd,
                ),
              )
            }
            placeholder="粘贴原文摘录，选择后发送到其他模块…"
          />
          <SelectionTools
            text={selected}
            source={{
              kind: "web",
              moduleId: mod.id,
              resourceId: mod.id,
              resourceName: adapter.url,
              version: "url",
              url: adapter.url,
              page: 0,
              text: selected,
            }}
            bus={bus}
            send={send}
          />
        </>
      ) : (
        <div className="module-empty">
          <ExternalLink size={28} />
          <h3>把网页放进学习空间</h3>
          <p>输入网页地址，支持嵌入的网站会在这里显示</p>
        </div>
      )}
    </div>
  );
}
export function VideoModule(p: ModuleProps) {
  const { mod, update, bus, send, saveResource, notify } = p;
  const [draft, setDraft] = useState(mod.data?.url || ""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState("");
  const { url, resource } = useBlob(p);
  const video = useRef<HTMLVideoElement>(null);
  let adapter;
  try {
    if (mod.data?.url) adapter = videoAdapter(mod.data.url, mod.data.seek || 0);
  } catch {}
  useEffect(() => {
    if (video.current && mod.data?.seek != null)
      video.current.currentTime = mod.data.seek;
  }, [mod.data?.seek]);
  const open = () => {
    try {
      const a = videoAdapter(draft);
      update(
        patchData(mod, { url: a.url, mediaResourceId: undefined, seek: 0 }),
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="video-module">
      <div className="url-toolbar">
        <input
          aria-label="视频地址"
          placeholder="YouTube / Bilibili 链接"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") open();
          }}
        />
        <button className="btn mini" onClick={open}>
          加载
        </button>
        <label className="btn mini" title="上传本地视频">
          <Upload size={13} />
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void saveResource(f)
                  .then((id) =>
                    update(
                      patchData(mod, { mediaResourceId: id, url: undefined }),
                    ),
                  )
                  .catch((e) => setError(e.message));
            }}
          />
        </label>
      </div>
      {error && <p className="inline-error">{error}</p>}
      {url ? (
        <video
          ref={video}
          src={url}
          controls
          onLoadedMetadata={() => {
            if (video.current) video.current.currentTime = mod.data?.time || 0;
          }}
          onPause={() =>
            update(patchData(mod, { time: video.current?.currentTime || 0 }))
          }
          onError={() => setError("视频解码失败，请使用浏览器支持的格式")}
        />
      ) : adapter?.embedUrl ? (
        <iframe
          title={mod.title}
          src={adapter.embedUrl}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <div className="video-placeholder">
          <span>▶</span>
          <p>{adapter ? "此链接无法直接嵌入" : "添加视频，开始一段学习"}</p>
        </div>
      )}
      {adapter && (
        <div className="embed-notice">
          <span>
            {adapter.name} ·{" "}
            {adapter.capabilities.seek ? "可跳转到时间点" : "在原站继续观看"}
          </span>
          <a href={adapter.url} target="_blank" rel="noopener noreferrer">
            无法播放？原站打开
            <ExternalLink size={12} />
          </a>
        </div>
      )}
      {(url || adapter?.capabilities.seek) && (
        <div className="inner-toolbar">
          <label>
            定位秒数
            <input
              aria-label="视频定位秒数"
              type="number"
              min="0"
              defaultValue={mod.data?.time || 0}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  update(
                    patchData(mod, {
                      seek: Math.max(0, Number(e.currentTarget.value)),
                    }),
                  );
              }}
            />
          </label>
          <span>回车跳转</span>
        </div>
      )}
      <div className="transcript-label">
        字幕 / 文字稿
        <label className="text-button">
          导入文字稿
          <input
            type="file"
            accept=".txt,.srt,.vtt,.md"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 1024 * 1024) return notify("文字稿最大 1 MB");
                void f
                  .text()
                  .then((transcript) => update(patchData(mod, { transcript })));
              }
            }}
          />
        </label>
      </div>
      <textarea
        aria-label="视频文字稿"
        placeholder="粘贴字幕或导入文字稿，选中内容即可提问、翻译。"
        value={mod.data?.transcript || ""}
        onChange={(e) => update(patchData(mod, { transcript: e.target.value }))}
        onSelect={(e) =>
          setSelected(
            e.currentTarget.value.slice(
              e.currentTarget.selectionStart,
              e.currentTarget.selectionEnd,
            ),
          )
        }
      />
      <SelectionTools
        text={selected}
        source={{
          kind: "video",
          moduleId: mod.id,
          resourceId: resource?.id || mod.id,
          resourceName: resource?.name || adapter?.name || mod.title,
          version: resource?.version || "url",
          url: adapter?.url,
          page: 0,
          timestamp: video.current?.currentTime || mod.data?.seek || 0,
          text: selected,
        }}
        bus={bus}
        send={send}
      />
    </div>
  );
}
export function ImageModule(p: ModuleProps) {
  const { mod, update, saveResource } = p;
  const { url } = useBlob(p);
  const [draft, setDraft] = useState(mod.data?.url || ""),
    [error, setError] = useState("");
  const src = url || mod.data?.url;
  return (
    <div className="image-module">
      <div className="url-toolbar">
        <input
          aria-label="图片地址"
          placeholder="图片 URL"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          className="btn mini"
          onClick={() => {
            try {
              const url = safeUrl(draft);
              setError("");
              update(patchData(mod, { url, mediaResourceId: undefined }));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          显示
        </button>
        <label className="btn mini">
          <Upload size={13} />
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void saveResource(f)
                  .then((id) => {
                    setError("");
                    update(
                      patchData(mod, { mediaResourceId: id, url: undefined }),
                    );
                  })
                  .catch((e) => setError(e.message));
            }}
          />
        </label>
      </div>
      <div className="inner-toolbar">
        <select
          aria-label="图片展示方式"
          value={mod.settings?.fit || "contain"}
          onChange={(e) =>
            update({
              settings: {
                ...mod.settings,
                fit: e.target.value as "contain" | "cover",
              },
            })
          }
        >
          <option value="contain">完整展示</option>
          <option value="cover">填充区域</option>
        </select>
        <input
          aria-label="图片缩放"
          type="range"
          min="50"
          max="250"
          value={mod.data?.imageZoom || 100}
          onChange={(e) =>
            update(patchData(mod, { imageZoom: Number(e.target.value) }))
          }
        />
        <span>{mod.data?.imageZoom || 100}%</span>
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="image-stage">
        {src ? (
          <img
            alt={mod.title}
            src={src}
            style={{
              objectFit: mod.settings?.fit || "contain",
              transform: `scale(${(mod.data?.imageZoom || 100) / 100})`,
            }}
            onError={() => setError("图片加载失败，请检查地址或重新上传")}
            onDoubleClick={() =>
              window.open(src, "_blank", "noopener,noreferrer")
            }
          />
        ) : (
          <p>上传一张图片，或输入图片地址</p>
        )}
      </div>
      <label className="transcript-label">图片说明</label>
      <textarea
        aria-label="图片说明"
        placeholder="填写图中文字或说明，供已连接的工具使用；不会自动识别图片。"
        value={mod.data?.text || ""}
        onChange={(e) => update(patchData(mod, { text: e.target.value }))}
      />
      <span className="data-footer">双击图片打开完整预览</span>
    </div>
  );
}
