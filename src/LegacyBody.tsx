import { ActionMenu } from "./ActionMenu";
import { LearningMaterials } from "./MaterialSelector";
import { SourceReferences } from "./SourceReferences";
import { DocumentStatus } from "./DocumentStatus";
import {
  createDocumentReader,
  type DocumentReport,
} from "./documentProcessing";
import { ai } from "./services";
import { ContentActions } from "./ContentActions";
import { contentVersion } from "./connections";
import { useQuickRun } from "./useQuickRun";
import { materialEdges, materialModePatch } from "./learningMaterials";
import { useMaterialAI } from "./useMaterialAI";
import { prepareChatContext } from "./chatContext";
import { noteDisplayContent, noteTitle, titledTranslation } from "./noteContent";
import { MarkdownContent } from "./MarkdownContent";
import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef } from "react";
import {
  ArrowUp,
  Languages,
  MessageCircle,
  Copy,
  NotebookPen,
  Layers,
  ArrowUpRight,
  Plus,
  Trash2,
  Check,
} from "lucide-react";
const FileReader = lazy(() =>
  import("./FileReader").then((m) => ({ default: m.FileReader })),
);
import { useAI } from "./useAI";
import type { ModuleProps } from "./moduleProps";
import { patchData } from "./moduleProps";
import {
  uid,
  labels,
  type Mod,
  type Note,
  type Source,
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
  const [documentProgress, setDocumentProgress] = useState("");
  const latest = useRef(props);
  latest.current = props;
  const readContext = (p: ModuleProps) => ({
    workspace: p.workspace,
    notes: p.notes,
    resources: p.resources,
    selection: p.bus.selection,
    selections: p.bus.selections,
  });
  const {
    busy,
    partial,
    error,
    run: request,
    cancel,
  } = useAI(
    JSON.stringify([
      mod.data?.flow?.materials,
      props.taskId,
      props.workspaceId,
      mod.id,
      props.workspace.connections,
    ]) +
      JSON.stringify(mod.data?.flow?.inputs || []) +
      // Chat submits a snapshot; clearing/composing the next draft must not cancel it.
      (mod.type === "chat" ? "" : mod.input || "") +
      (mod.language || mod.settings?.language || "") +
      (mod.settings?.sourceLanguage || "") +
      JSON.stringify(mod.source || null),
  );
  const translation = useMaterialAI(
    props,
    JSON.stringify([mod.input, mod.data, mod.language, mod.settings]),
  );
  const chatMessages = useRef<HTMLDivElement>(null);
  const chatSending = useRef(false);
  const followChat = useRef(true);
  useLayoutEffect(() => {
    // Scroll only the conversation, after the pending status/new answer is laid out.
    // Input edits and progress text changes must not interrupt reading older messages.
    if (mod.type !== "chat" || !chatMessages.current) return;
    chatMessages.current.scrollTop = chatMessages.current.scrollHeight;
    followChat.current = true;
  }, [mod.id, mod.type, busy, mod.messages?.length]);
  useLayoutEffect(() => {
    if (mod.type === "chat" && followChat.current && chatMessages.current)
      chatMessages.current.scrollTop = chatMessages.current.scrollHeight;
  }, [mod.type, partial]);
  const translationOutput = translation.partial || mod.output;
  const [noteView, setNoteView] = useState<"edit" | "preview">("preview");
  const ownNotes = notes.filter(
    (n) => n.moduleId === mod.id && n.workspaceId === workspaceId,
  );
  const note = ownNotes.find((n) => n.id === mod.activeNoteId) || ownNotes[0];
  useEffect(() => {
    if (
      mod.type !== "translate" ||
      translation.connected ||
      !mod.data?.autoTranslate ||
      !mod.input?.trim()
    )
      return;
    const timer = setTimeout(() => {
      void translation.run(
        "translate",
        {
          text: mod.input,
          language: mod.language || mod.settings?.language || "简体中文",
          sourceLanguage: mod.settings?.sourceLanguage || "自动检测",
        },
        (output) => ({ output }),
      );
    }, 700);
    return () => clearTimeout(timer);
  }, [
    mod.input,
    mod.language,
    mod.data?.autoTranslate,
    translation.connected,
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
    if (
      (mod.type === "translate" ? translation.busy : busy) ||
      (!mod.input?.trim() &&
        !(mod.type === "translate" && translation.connected))
    )
      return;
    if (mod.type === "translate")
      await translation.run(
        "translate",
        {
          text: mod.input,
          language: mod.language || mod.settings?.language || "简体中文",
          sourceLanguage: mod.settings?.sourceLanguage || "自动检测",
        },
        (output) => ({ output }),
      );
    else {
      if (!mod.input?.trim() || chatSending.current) return;
      chatSending.current = true;
      let prepared: Awaited<ReturnType<typeof prepareChatContext>>;
      const messages = [
        ...(mod.messages || []),
        { role: "user" as const, content: mod.input, source: mod.source },
      ];
      setDocumentProgress("正在准备回答…");
      // Persist the question before any material preparation or model request.
      // Failure/cancellation leaves it in history; the composer is free for the next draft.
      update({ input: "", messages });
      try {
        await request(
          "chat",
          async (signal: AbortSignal) => {
            const ctx = readContext(props);
            const reports: DocumentReport[] = [];
            const reader = createDocumentReader({
              ctx,
              targetId: mod.id,
              query: mod.input,
              budget: Math.floor(
                20000 / Math.max(1, materialEdges(mod, props.workspace).length),
              ),
              call: ai,
              signal,
              progress: setDocumentProgress,
              reports,
            });
            prepared = await prepareChatContext(
              mod,
              ctx,
              signal,
              undefined,
              reader,
            );
            prepared.patch = {
              ...prepared.patch,
              data: {
                ...mod.data,
                ...prepared.patch.data,
                flow: {
                  inputs: [],
                  ...mod.data?.flow,
                  ...prepared.patch.data?.flow,
                  documents: reports,
                },
              },
            };
            setDocumentProgress("正在回答…");
            prepared.assertCurrent(readContext(latest.current));
            return {
              messages: messages
                .slice(-12)
                .map(({ role, content }) => ({ role, content })),
              context: prepared.context,
            };
          },
          (result) => {
            prepared.assertCurrent(readContext(latest.current));
            update({
              ...prepared.patch,
              messages: [
                ...messages.slice(0, -1),
                {
                  ...messages[messages.length - 1],
                  source: prepared.sources[0],
                  sources: prepared.sources,
                },
                {
                  role: "assistant",
                  content: result,
                  source: prepared.sources[0],
                  sources: prepared.sources,
                },
              ],
            });
          },
        );
      } finally {
        chatSending.current = false;
      }
    }
  };
  useQuickRun(props, mod.type === "translate" ? translation.busy : busy, () => {
    void run();
  });
  if (mod.type === "pdf")
    return (
      <Suspense fallback={<div className="module-empty">正在加载阅读器…</div>}>
        <FileReader {...props} />
      </Suspense>
    );
  if (mod.type === "note")
    return (
      <div className="notes-body">
        {note && (
          <ContentActions
            text={note.content}
            label="用这篇笔记…"
            send={send}
            source={{
              kind: "text",
              contentKind: note.contentKind || "user",
              moduleId: mod.id,
              resourceId: note.id,
              noteId: note.id,
              resourceName:
                noteTitle(note.content, mod.title),
              version: contentVersion(note.content),
              page: 1,
              text: note.content,
            }}
          />
        )}
        <div className="note-tabs">
          <select
            aria-label="选择笔记"
            value={note?.id || ""}
            onChange={(e) => {
              update({ activeNoteId: e.target.value });
              setNoteView("preview");
            }}
          >
            <option value="" disabled>
              我的笔记
            </option>
            {ownNotes.map((n, i) => (
              <option key={n.id} value={n.id}>
                {noteTitle(n.content, `笔记 ${i + 1}`)}
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
              update({ activeNoteId: n.id });
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
                      ? {
                          ...note,
                          content: note.content + markers[i],
                          contentKind: "user",
                        }
                      : {
                          id: uid(),
                          moduleId: mod.id,
                          workspaceId,
                          content: markers[i],
                          sources: [],
                          contentKind: "user",
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
            <MarkdownContent>{noteDisplayContent(note.content)}</MarkdownContent>
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
                  ? { ...note, content: e.target.value, contentKind: "user" }
                  : {
                      id: uid(),
                      moduleId: mod.id,
                      workspaceId,
                      content: e.target.value,
                      sources: [],
                      contentKind: "user",
                    },
              )
            }
          />
        )}
        <SourceReferences sources={note?.sources || []} jump={jump} />
        <div className="note-footer">
          <Check size={12} />
          自动保存<span>{note?.content.length || 0} 字</span>
        </div>
      </div>
    );
  if (mod.type === "translate")
    return (
      <div className="translate-body">
        <div className="translation-original">
          <label className="translation-source-label">
            原文
            <textarea
              className="translate-input"
              aria-label="待翻译文本"
              placeholder="输入原文，或在文件中选中一段文字后点击翻译…"
              value={mod.input || ""}
              onChange={(e) =>
                update({
                  ...materialModePatch(mod, "manual"),
                  input: e.target.value,
                })
              }
            />
          </label>
          <div className="translation-actionbar">
            <label>
              译为{" "}
              <select
                aria-label="翻译目标语言"
                value={mod.language || mod.settings?.language || "简体中文"}
                onChange={(e) =>
                  update({
                    language: e.target.value,
                    settings: {
                      ...mod.settings,
                      language: e.target.value as any,
                    },
                  })
                }
              >
                {["简体中文", "English", "日本語", "한국어", "Français"].map(
                  (l) => (
                    <option key={l}>{l}</option>
                  ),
                )}
              </select>
            </label>
            <ActionMenu label="翻译设置">
              <label>
                原文语言
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
              </label>
              {!translation.connected && (
                <label>
                  <input
                    type="checkbox"
                    checked={!!mod.data?.autoTranslate}
                    onChange={(e) =>
                      update(
                        patchData(mod, { autoTranslate: e.target.checked }),
                      )
                    }
                  />
                  自动翻译输入内容
                </label>
              )}
            </ActionMenu>
            <button
              className="btn primary translate-trigger"
              disabled={
                translation.busy ||
                (!mod.input?.trim() && !translation.connected)
              }
              onClick={() => void run()}
            >
              <Languages size={14} />
              {translation.busy ? "正在翻译…" : "翻译"}
            </button>
          </div>
          {translation.busy && (
            <DocumentStatus
              mod={mod}
              busy={true}
              progress="正在翻译…"
              cancel={translation.cancel}
            />
          )}
          {translation.error && (
            <p className="inline-error" role="alert">
              {translation.error}
            </p>
          )}
        </div>
        {translationOutput ? (
          <div className="ai-output translation-result">
            <div className="output-label">
              {translation.partial ? (translation.busy ? "译文 · 生成中" : "译文 · 未完成") : "译文"}
              <button title="复制译文" disabled={!!translation.partial} onClick={() => void copy(mod.output!)}>
                <Copy size={14} />
              </button>
            </div>
            <MarkdownContent>{translationOutput}</MarkdownContent>
            {!translation.partial && <div className="translation-result-actions">
              <button
                className="text-button"
                onClick={() =>
                  send("note", titledTranslation(mod.output!), mod.source, "ai")
                }
              >
                <NotebookPen size={13} />
                保存到笔记
              </button>
              <button
                className="text-button"
                onClick={() =>
                  send(
                    "cards",
                    mod.output!,
                    mod.source
                      ? { ...mod.source, contentKind: "ai" }
                      : undefined,
                    "ai",
                  )
                }
              >
                <Layers size={13} />
                制作卡片
              </button>
            </div>}
          </div>
        ) : (
          <div className="quiet-placeholder">
            <Languages size={24} />
            <p>译文会显示在这里</p>
          </div>
        )}
        <SourceReferences
          sources={
            mod.data?.flow?.inputs.flatMap((p) => p.sources) ||
            (mod.source ? [mod.source] : [])
          }
          jump={jump}
        />
      </div>
    );
  return (
    <div className="chat-body">
      <div className="chat-messages" ref={chatMessages} onScroll={(event) => {
        const el = event.currentTarget;
        followChat.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      }}>
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
                    <button
                      onClick={() => send("note", m.content, m.source, "ai")}
                    >
                      <NotebookPen size={12} />
                      存入笔记
                    </button>
                    <button
                      onClick={() =>
                        send(
                          "cards",
                          m.content,
                          m.source
                            ? { ...m.source, contentKind: "ai" }
                            : undefined,
                          "ai",
                        )
                      }
                    >
                      <Layers size={12} />
                      制作卡片
                    </button>
                    <SourceReferences
                      sources={
                        m.sources?.length
                          ? m.sources
                          : m.source
                            ? [m.source]
                            : []
                      }
                      jump={jump}
                    />
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        {partial && (
          <div className="message assistant">
            <div className="message-avatar">✦</div>
            <div>
              <MarkdownContent>{partial}</MarkdownContent>
              <small className="small">{busy ? "生成中…" : "回答未完成，请重新提问"}</small>
            </div>
          </div>
        )}
        <DocumentStatus
          mod={mod}
          busy={busy}
          progress={documentProgress}
          cancel={cancel}
        />
      </div>
      <LearningMaterials {...props} />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-input">
        <textarea
          aria-label="向 AI 提问"
          placeholder="输入你的问题…"
          value={mod.input || ""}
          onChange={(e) => update({ input: e.target.value })}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
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
