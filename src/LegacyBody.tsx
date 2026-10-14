import { MarkdownContent } from "./MarkdownContent";
import { lazy, Suspense, useState, useEffect } from "react";
import {
  ArrowUp,
  Languages,
  MessageCircle,
  Copy,
  NotebookPen,
  ArrowUpRight,
  Quote,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
const PdfReader = lazy(() =>
  import("./PdfReader").then((m) => ({ default: m.PdfReader })),
);
import { useAI } from "./useAI";
import type { ModuleProps } from "./moduleProps";
import { ContextInput, SourceLink } from "./SelectionTools";
import { patchData } from "./moduleProps";
import {
  uid,
  labels,
  type Mod,
  type Note,
  type Source,
  type Resource,
  type ModuleType,
} from "./model";
export function LegacyBody(props: ModuleProps) {
  const {
    mod,
    resources,
    notes,
    workspaceId,
    update,
    upload,
    send,
    saveNote,
    deleteNote,
    jump,
    notify,
    bus,
  } = props;
  const {
    busy,
    error,
    run: request,
  } = useAI(
    (mod.input || "") +
      (mod.language || mod.settings?.language || "") +
      (mod.settings?.sourceLanguage || "") +
      JSON.stringify(mod.source || null),
  );
  const [activeNote, setActiveNote] = useState<string>();
  const [noteView, setNoteView] = useState<"edit" | "preview">("preview");
  const ownNotes = notes.filter(
    (n) => n.moduleId === mod.id && n.workspaceId === workspaceId,
  );
  const note = ownNotes.find((n) => n.id === activeNote) || ownNotes[0];
  useEffect(() => {
    if (mod.type !== "translate" || !mod.data?.autoSync) return;
    return bus.on("selection.changed", (s) => {
      if (s.moduleId !== mod.id)
        update({ input: s.text, source: s, output: undefined });
    });
  }, [bus, mod.type, mod.data?.autoSync, update]);
  useEffect(() => {
    if (
      mod.type !== "translate" ||
      !mod.data?.autoTranslate ||
      !mod.input?.trim()
    )
      return;
    const timer = setTimeout(() => {
      void request(
        "translate",
        {
          text: mod.input,
          language: mod.language || mod.settings?.language || "简体中文",
          sourceLanguage: mod.settings?.sourceLanguage || "自动检测",
        },
        (output) => update({ output }),
      );
    }, 700);
    return () => clearTimeout(timer);
  }, [
    mod.input,
    mod.language,
    mod.data?.autoTranslate,
    mod.settings?.sourceLanguage,
  ]);
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      notify("已复制到剪贴板");
    } catch {
      notify("复制失败，请手动选择文字");
    }
  };
  const run = async () => {
    if (!mod.input?.trim() || busy) return;
    if (mod.type === "translate")
      await request(
        "translate",
        {
          text: mod.input,
          language: mod.language || mod.settings?.language || "简体中文",
          sourceLanguage: mod.settings?.sourceLanguage || "自动检测",
        },
        (output) => update({ output }),
      );
    else {
      const messages = [
        ...(mod.messages || []),
        { role: "user" as const, content: mod.input, source: mod.source },
      ];
      await request(
        "chat",
        { messages: messages.slice(-12), context: mod.source?.text },
        (result) =>
          update({
            input: "",
            messages: [
              ...messages,
              { role: "assistant", content: result, source: mod.source },
            ],
          }),
      );
    }
  };
  if (mod.type === "pdf")
    return (
      <Suspense fallback={<div className="module-empty">正在加载阅读器…</div>}>
        <PdfReader
          mod={mod}
          resources={resources}
          update={update}
          upload={upload}
          send={send}
          bus={bus}
        />
      </Suspense>
    );
  if (mod.type === "note")
    return (
      <div className="notes-body">
        <ContextInput {...props} />
        <div className="note-tabs">
          <select
            aria-label="选择笔记"
            value={note?.id || ""}
            onChange={(e) => {
              setActiveNote(e.target.value);
              setNoteView("preview");
            }}
          >
            <option value="" disabled>
              我的笔记
            </option>
            {ownNotes.map((n, i) => (
              <option key={n.id} value={n.id}>
                {n.content
                  .split("\n")[0]
                  .replace(/^#+\s*/, "")
                  .replace(/\*\*/g, "") || `笔记 ${i + 1}`}
              </option>
            ))}
          </select>
          <button
            title="新建笔记"
            onClick={() => {
              const n = {
                id: uid(),
                moduleId: mod.id,
                workspaceId,
                content: "",
                sources: [],
              };
              saveNote(n);
              setActiveNote(n.id);
              setNoteView("edit");
            }}
          >
            <Plus size={15} />
          </button>
          {note && (
            <button
              title="删除笔记"
              onClick={() => {
                if (confirm("删除这篇笔记？此操作无法撤销。"))
                  deleteNote(note.id);
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="note-view-tabs">
          <button
            aria-pressed={noteView === "edit"}
            onClick={() => setNoteView("edit")}
          >
            编辑
          </button>
          <button
            aria-pressed={noteView === "preview"}
            onClick={() => setNoteView("preview")}
          >
            预览
          </button>
        </div>
        {noteView === "edit" && (
          <div className="format-toolbar">
            {["B", "I", "H", "•"].map((v, i) => (
              <button
                key={v}
                className={i === 0 ? "bold" : ""}
                title={["加粗", "斜体", "标题", "列表"][i]}
                onClick={() => {
                  const markers = [
                    "**文字**",
                    "*文字*",
                    "\n## 标题",
                    "\n- 列表项",
                  ];
                  saveNote(
                    note
                      ? { ...note, content: note.content + markers[i] }
                      : {
                          id: uid(),
                          moduleId: mod.id,
                          workspaceId,
                          content: markers[i],
                          sources: [],
                        },
                  );
                }}
              >
                {v}
              </button>
            ))}
            <span>Markdown</span>
          </div>
        )}
        {noteView === "preview" && note?.content ? (
          <div className="note-preview">
            <MarkdownContent>{note.content}</MarkdownContent>
          </div>
        ) : (
          <textarea
            className="note-editor"
            aria-label="笔记正文"
            placeholder={
              "记下你的思考…\n\n支持 Markdown，也可以从其他模块保存内容。"
            }
            value={note?.content || ""}
            onChange={(e) =>
              saveNote(
                note
                  ? { ...note, content: e.target.value }
                  : {
                      id: uid(),
                      moduleId: mod.id,
                      workspaceId,
                      content: e.target.value,
                      sources: [],
                    },
              )
            }
          />
        )}
        {note?.sources.map((s, i) => (
          <button key={i} className="source-chip" onClick={() => jump(s)}>
            <Quote size={12} />
            {resources.find((r) => r.id === s.resourceId)?.name || "原文"} · 第{" "}
            {s.page} 页<ArrowUpRight size={12} />
          </button>
        ))}
        <div className="note-footer">
          <Check size={12} />
          自动保存到此设备<span>{note?.content.length || 0} 字</span>
        </div>
      </div>
    );
  if (mod.type === "translate")
    return (
      <div className="translate-body">
        <ContextInput {...props} />
        <div className="translate-toolbar">
          <select
            aria-label="翻译目标语言"
            value={mod.language || mod.settings?.language || "简体中文"}
            onChange={(e) =>
              update({
                language: e.target.value,
                settings: { ...mod.settings, language: e.target.value as any },
              })
            }
          >
            {["简体中文", "English", "日本語", "한국어", "Français"].map(
              (l) => (
                <option key={l}>{l}</option>
              ),
            )}
          </select>
          <select
            aria-label="源语言"
            value={mod.settings?.sourceLanguage || "自动检测"}
            onChange={(e) =>
              update({
                settings: {
                  ...mod.settings,
                  sourceLanguage: e.target.value as any,
                },
              })
            }
          >
            {[
              "自动检测",
              "简体中文",
              "English",
              "日本語",
              "한국어",
              "Français",
            ].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
        <div className="sync-controls">
          <label>
            <input
              type="checkbox"
              checked={!!mod.data?.autoSync}
              onChange={(e) =>
                update(patchData(mod, { autoSync: e.target.checked }))
              }
            />
            同步选区
          </label>
          <label>
            <input
              type="checkbox"
              checked={!!mod.data?.autoTranslate}
              onChange={(e) =>
                update(patchData(mod, { autoTranslate: e.target.checked }))
              }
            />
            自动翻译
          </label>
        </div>
        <textarea
          className="translate-input"
          aria-label="待翻译文本"
          placeholder="输入需要翻译的文字，或从 PDF 发送选段…"
          value={mod.input || ""}
          onChange={(e) => update({ input: e.target.value })}
        />
        <button
          className="btn primary translate-trigger"
          disabled={busy || !mod.input?.trim()}
          onClick={() => void run()}
        >
          <Languages size={14} />
          {busy ? "正在翻译…" : "翻译文本"}
        </button>
        {error && <p className="inline-error">{error}</p>}
        {mod.output ? (
          <div className="ai-output">
            <div className="output-label">
              译文
              <button title="复制译文" onClick={() => void copy(mod.output!)}>
                <Copy size={14} />
              </button>
            </div>
            <MarkdownContent>{mod.output}</MarkdownContent>
            <button
              className="text-button"
              onClick={() => send("note", mod.output!, mod.source)}
            >
              <NotebookPen size={13} />
              保存到笔记
            </button>
          </div>
        ) : (
          <div className="quiet-placeholder">
            <Languages size={22} />
            <p>让语言不再成为理解的边界</p>
          </div>
        )}
        <SourceLink source={mod.source} jump={jump} />
      </div>
    );
  return (
    <div className="chat-body">
      <ContextInput {...props} />
      <div className="chat-messages">
        {!mod.messages?.length ? (
          <div className="chat-welcome">
            <div className="empty-icon chat">
              <MessageCircle size={24} />
            </div>
            <h3>一起，把问题想明白</h3>
            <p>针对资料提问，或聊聊你的学习困惑</p>
            {[
              "这篇文章的核心观点是什么？",
              "帮我解释这个概念",
              "总结这段内容",
            ].map((q) => (
              <button key={q} onClick={() => update({ input: q })}>
                {q}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        ) : (
          mod.messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="message-avatar">
                {m.role === "user" ? "我" : "✦"}
              </div>
              <div>
                {m.role === "assistant" ? (
                  <MarkdownContent>{m.content}</MarkdownContent>
                ) : (
                  <p>{m.content}</p>
                )}
                {m.role === "assistant" && (
                  <div className="message-actions">
                    <button
                      title="复制回答"
                      onClick={() => void copy(m.content)}
                    >
                      <Copy size={12} />
                    </button>
                    <button onClick={() => send("note", m.content, m.source)}>
                      <NotebookPen size={12} />
                      存入笔记
                    </button>
                    {m.source && (
                      <button onClick={() => jump(m.source!)}>
                        {m.source.kind === "pdf" || !m.source.kind
                          ? `第 ${m.source.page} 页`
                          : m.source.resourceName || "查看来源"}{" "}
                        ↗
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {busy && <div className="thinking">✦ 正在思考…</div>}
      </div>
      {mod.source && (
        <div className="context-chip">
          <Quote size={12} />
          <span>{mod.source.text.slice(0, 75)}</span>
          <button
            title="清除上下文"
            onClick={() => update({ source: undefined })}
          >
            ×
          </button>
        </div>
      )}
      {error && <p className="inline-error">{error}</p>}
      <div className="chat-input">
        <textarea
          aria-label="向 AI 提问"
          placeholder="输入你的问题…"
          value={mod.input || ""}
          onChange={(e) => update({ input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
          }}
        />
        <button
          className="primary"
          title="发送问题"
          disabled={busy || !mod.input?.trim()}
          onClick={() => void run()}
        >
          <ArrowUp size={18} />
        </button>
      </div>
      <div className="ai-disclaimer">AI 回答仅供参考，请结合原文判断</div>
    </div>
  );
}
