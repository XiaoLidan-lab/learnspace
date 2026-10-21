import { readConnection } from "./connections";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, X } from "lucide-react";
import { hasEditedDraft } from "./learningPresentation";
import type { ModuleProps } from "./moduleProps";
import {
  chooseMaterials,
  learningMaterials,
  materialEdges,
  materialField,
  materialKey,
  materialModePatch,
  type LearningMaterial,
} from "./learningMaterials";

export function LearningMaterials(p: ModuleProps) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<LearningMaterial[]>([]),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLElement>(null);
  const ctx = {
    workspace: p.workspace,
    notes: p.notes,
    resources: p.resources,
    selection: p.bus.selection,
    selections: p.bus.selections,
  };
  const items = learningMaterials(p.mod, ctx),
    field = materialField(p.mod);
  const refs = materialEdges(p.mod, p.workspace).filter(
    (e) => e.target.field === field,
  );
  const chosen = refs.map((e) =>
    items.find((i) => i.key === materialKey(e.source)),
  );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key === "Tab" && panel.current) {
        const nodes = Array.from(
          panel.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === panel.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open]);
  const start = () => {
    setDraft(
      refs.flatMap((e) => {
        const item = items.find((i) => i.key === materialKey(e.source));
        return item
          ? [
              {
                ...item,
                source: {
                  ...item.source,
                  ...e.source,
                  needsBinding: undefined,
                },
              },
            ]
          : [];
      }),
    );
    setError("");
    setOpen(true);
  };
  const manual = p.mod.data?.flow?.materialMode === "manual";
  return (
    <div className="learning-materials">
      <div className="learning-materials-summary">
        <BookOpen size={14} aria-hidden="true" />
        <button
          className="material-summary-trigger"
          ref={trigger}
          onClick={start}
        >
          <span className="material-summary-label">学习材料：</span>
          <span className="material-summary-value">
            {refs.length && (!manual || p.mod.type === "chat")
              ? refs.length === 1
                ? `${chosen[0]?.title || "请重新选择材料"}${refs[0].source.port === "selection" ? ` · ${refs[0].source.range === "document" ? "整篇文档" : "选中内容"}` : ""}`
                : `已选 ${refs.length} 项`
              : p.mod.source?.text
                ? `${p.mod.source.resourceName || "学习内容"} · ${hasEditedDraft(p.mod) ? "自行编辑" : p.mod.source.contentKind === "ai" ? "AI 内容" : "选中内容"}`
                : p.mod.input?.trim() && p.mod.type !== "chat"
                  ? `自行输入 · ${p.mod.input.length} 字`
                  : "选择学习材料"}
          </span>
          <span className="material-summary-action">
            {refs.length > 1
              ? "查看与调整"
              : refs.length || p.mod.source
                ? "更换"
                : "选择"}
          </span>
        </button>
      </div>
      {open &&
        createPortal(
          <div
            className="modal-backdrop learning-materials-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <section
              className="learning-materials-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="选择学习材料"
              ref={panel}
              tabIndex={-1}
            >
              <header>
                <div>
                  <h2>选择学习材料</h2>
                  <p>选择要处理的内容和范围，更换材料不会清空已有结果。</p>
                </div>
                <button
                  className="icon-btn"
                  aria-label="关闭材料选择"
                  onClick={close}
                >
                  <X size={19} />
                </button>
              </header>
              {p.mod.type !== "chat" && (
                <div className="material-mode-choice">
                  <span>也可以粘贴自己的内容</span>
                  <button
                    className="text-button"
                    onClick={() => {
                      p.mutate((m) => materialModePatch(m, "manual"));
                      p.bus.emit("material.edit", { moduleId: p.mod.id });
                      close();
                    }}
                  >
                    直接输入
                  </button>
                </div>
              )}
              {!refs.length && p.mod.source?.text && (
                <div className="current-fragment">
                  <strong>当前片段</strong>
                  <p>{p.mod.source.text.slice(0, 400)}</p>
                  <button
                    className="text-button"
                    onClick={() => {
                      p.update({ source: undefined });
                      close();
                    }}
                  >
                    移除片段引用
                  </button>
                </div>
              )}
              <div className="learning-materials-list">
                {!items.length && (
                  <p className="muted">
                    还没有可选材料。先在文件阅读中上传文件，或添加笔记、文字稿等内容；也可以直接在工具内输入。
                  </p>
                )}
                {items.map((item) => {
                  const selected = draft.find((i) => i.key === item.key);
                  const fragment = p.bus.selections[item.source.moduleId];
                  return (
                    <div
                      className={`learning-material-row ${selected ? "selected" : ""}`}
                      key={item.key}
                    >
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`使用材料：${item.title}`}
                          disabled={!!item.unavailable}
                          checked={!!selected}
                          onChange={(e) =>
                            setDraft((v) =>
                              e.target.checked
                                ? [...v, item]
                                : v.filter((i) => i.key !== item.key),
                            )
                          }
                        />
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.unavailable || item.detail}</small>
                        </span>
                      </label>
                      {selected && item.file && (
                        <label className="learning-material-range">
                          内容范围
                          <select
                            aria-label={`${item.title}的内容范围`}
                            value={selected.source.range || "selection"}
                            onChange={(e) =>
                              setDraft((v) =>
                                v.map((i) =>
                                  i.key === item.key
                                    ? {
                                        ...i,
                                        source: {
                                          ...i.source,
                                          range: e.target.value as
                                            | "selection"
                                            | "document",
                                        },
                                      }
                                    : i,
                                ),
                              )
                            }
                          >
                            <option value="selection">选中内容</option>
                            <option value="document">整篇文档</option>
                          </select>
                        </label>
                      )}
                      {selected &&
                        item.file &&
                        (selected.source.range || "selection") ===
                          "selection" && (
                          <p className="learning-material-preview">
                            {fragment?.text
                              ? `${fragment.text.slice(0, 240)}${fragment.text.length > 240 ? "…" : ""}`
                              : "请先在文件阅读中选中内容，或切换为整篇文档。"}
                          </p>
                        )}
                    </div>
                  );
                })}
              </div>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <footer>
                <span>{draft.length} 项材料 · 原有结果保留</span>
                <button className="btn" onClick={close}>
                  取消
                </button>
                <button
                  className="btn primary"
                  disabled={saving}
                  onClick={async () => {
                    try {
                      setSaving(true);
                      const materials = chooseMaterials(p.mod, ctx, draft);
                      if (
                        materials.length &&
                        hasEditedDraft(p.mod) &&
                        !confirm(
                          "下次生成将使用所选材料，替换当前输入草稿。继续使用新材料？",
                        )
                      )
                        return;
                      const captures = await Promise.all(
                        materials
                          .filter(
                            (e) =>
                              e.source.port === "selection" &&
                              e.source.range !== "document",
                          )
                          .map((e) => readConnection(e, ctx)),
                      );
                      if (
                        captures.reduce(
                          (total, p) => total + p.text.length,
                          0,
                        ) > 24000
                      )
                        throw Error(
                          "所选片段合计超过24000字符，请减少材料或缩小选区",
                        );
                      p.mutate((m) => ({
                        ...materialModePatch(
                          m,
                          materials.length ? "sources" : "manual",
                        ),
                        ...(!materials.length && m.type === "chat"
                          ? { source: undefined }
                          : {}),
                        data: {
                          ...m.data,
                          flow: {
                            ...m.data?.flow,
                            inputs: captures,
                            materials,
                            materialMode: materials.length
                              ? "sources"
                              : "manual",
                          },
                        },
                      }));
                      close();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "材料保存失败");
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? "保存中…" : "使用这些材料"}
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}
