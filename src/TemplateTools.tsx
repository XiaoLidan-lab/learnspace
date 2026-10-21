import { useDialogFocus } from "./useDialogFocus";
import { inputPorts, portNames } from "./connectionGraph";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { openDB } from "idb";
import {
  ArrowUpRight,
  MoreHorizontal,
  Pencil,
  Download,
  Trash2,
  LayoutTemplate,
  Monitor,
} from "lucide-react";
import { definitions } from "./definitions";
import { ModuleIcon } from "./registry";
import { templateSchema, uid, type Template } from "./model";

// Separate store avoids upgrading/locking the existing workspace database in open tabs.
const db = openDB("learnspace-templates-v1", 1, {
  upgrade(d) {
    d.createObjectStore("templates", { keyPath: "id" });
  },
});
export type SavedTemplate = {
  id: string;
  template: Template;
  createdAt: number;
};
export const templateStore = {
  async list(): Promise<SavedTemplate[]> {
    return (await (await db).getAll("templates")).map((r) => ({
      ...r,
      template: templateSchema.parse(r.template),
    }));
  },
  async save(template: Template) {
    const row = {
      id: uid(),
      template: templateSchema.parse(template),
      createdAt: Date.now(),
    };
    await (await db).put("templates", row);
    window.dispatchEvent(new Event("learnspace:templates"));
    return row;
  },
  async rename(id: string, title: string) {
    const tx = (await db).transaction("templates", "readwrite");
    const row = (await tx.store.get(id)) as SavedTemplate | undefined;
    if (!row) throw Error("模板已不存在，请刷新列表");
    const template = templateSchema.parse({
      ...row.template,
      title: title.trim(),
    });
    await tx.store.put({ ...row, template });
    await tx.done;
    window.dispatchEvent(new Event("learnspace:templates"));
  },
  async remove(id: string) {
    await (await db).delete("templates", id);
    window.dispatchEvent(new Event("learnspace:templates"));
  },
};
export function TemplateContents({ template: t }: { template: Template }) {
  const hasAI = t.modules.some((m) => m.customConfig);
  const needsSources =
    t.modules.some((m) => m.type === "pdf" || m.type === "note") ||
    t.connections?.some((c) => c.source.needsBinding);
  return (
    <section aria-label="模板内容预览" className="template-contents">
      <header>
        <h4>包含 {t.modules.length} 个模块</h4>
        <p>保留这套学习工具和布局，方便下次使用。</p>
      </header>
      <ul className="template-module-list">
        {t.modules.map((m, i) => (
          <li key={i}>
            <div className="template-module-heading">
              <span className="template-module-icon" aria-hidden="true">
                <ModuleIcon type={m.type} size={18} />
              </span>
              <div>
                <strong>{m.title}</strong>
                <span>{definitions[m.type].name}</span>
              </div>
            </div>
            {m.customConfig && (
              <div className="template-module-details">
                <p>{m.customConfig.purpose}</p>
                <p>
                  输入：
                  {m.customConfig.fields
                    .map((f) => `${f.label}${f.required ? "（必填）" : ""}`)
                    .join("、")}
                </p>
                <p>
                  结果展示：
                  {m.customConfig.display === "markdown"
                    ? "Markdown 排版"
                    : "纯文本"}
                </p>
                <details>
                  <summary>查看 AI 指令</summary>
                  <p>保存或分享前，请检查指令中是否包含私人信息。</p>
                  <pre className="custom-text">{m.customConfig.prompt}</pre>
                </details>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!!t.connections?.length && (
        <div className="template-connection-list">
          <h4>材料预设 · {t.connections.length} 条</h4>
          {t.connections.map((e) => {
            const source = t.modules.find(
              (m) => m.instanceId === e.source.moduleId,
            );
            const target = t.modules.find(
              (m) => m.instanceId === e.target.moduleId,
            );
            const field = target
              ? inputPorts(target).find((f) => f.id === e.target.field)
              : undefined;
            const output =
              e.source.port === "selection"
                ? e.source.range === "document"
                  ? "整篇文档"
                  : "选中内容"
                : portNames[e.source.port];
            return (
              <div key={e.id}>
                <p>
                  {target?.title || "工具"} 使用{" "}
                  {source?.title || "待选择的材料"} · {output}
                </p>
                <small>
                  {e.source.needsBinding
                    ? "使用时需重新选择学习材料"
                    : "执行时读取所选材料，不会自动运行 AI"}
                </small>
              </div>
            );
          })}
        </div>
      )}
      <div className="template-inclusions">
        <p>
          <strong>将保存</strong>模块布局、名称与配置
          {hasAI ? "，以及输入字段、AI 指令" : ""}
          {t.connections?.length ? "和学习材料预设" : ""}。
        </p>
        <p>
          <strong>不会保存</strong>上传文件、笔记正文、学习记录与账号信息。
        </p>
      </div>
      {needsSources && (
        <p className="template-source-notice">
          使用模板时，需要重新选择 PDF、笔记等私人来源。
        </p>
      )}
      <p className="template-independent-note">
        安装后可自由修改，不影响原模板。
      </p>
    </section>
  );
}

export function TemplateSaveDialog({
  template,
  close,
  notify,
}: {
  template: Template;
  close: () => void;
  notify: (s: string) => void;
}) {
  const [title, setTitle] = useState(template.title),
    [description, setDescription] = useState(template.description),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const focus = useRef<HTMLInputElement>(null);
  const dialogPanel = useDialogFocus(close, busy);
  async function save(exporting: boolean) {
    setError("");
    setBusy(true);
    try {
      if (!reviewed) throw Error("请先检查模板内容并确认隐私");
      const t = templateSchema.parse({
        ...template,
        title: title.trim(),
        description,
      });
      if (exporting) {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(t, null, 2)], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${t.title}.learnspace.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else await templateStore.save(t);
      notify(
        exporting
          ? "模板已导出，不包含私人运行内容"
          : "模板已保存，可在“模板社区 → 我的模板”中使用",
      );
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "模板保存失败，请检查存储空间");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-template-title"
        className="modal"
        ref={dialogPanel}
        tabIndex={-1}
      >
        <button
          className="modal-close"
          aria-label="关闭模板保存"
          onClick={close}
        >
          ×
        </button>
        <h2 id="save-template-title">保存为模板</h2>
        <label className="form-label">
          模板名称
          <input
            ref={focus}
            autoFocus
            maxLength={80}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label className="form-label">
          模板介绍
          <textarea
            maxLength={1000}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <TemplateContents template={{ ...template, title, description }} />
        <label className="install-material-option">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          我已检查模块名称和 AI 指令，确认不含私人信息或密钥
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="btn" disabled={busy} onClick={close}>
            取消
          </button>
          <button
            className="btn"
            disabled={busy || !reviewed || !title.trim()}
            onClick={() => void save(true)}
          >
            导出 JSON
          </button>
          <button
            className="btn primary"
            disabled={busy || !reviewed || !title.trim()}
            onClick={() => void save(false)}
          >
            保存到本地模板
          </button>
        </div>
      </section>
    </div>
  );
}
export function TemplateLibrary({
  install,
  notify,
  renderPreview,
  explore,
}: {
  install: (t: Template) => void;
  notify: (s: string) => void;
  renderPreview: (t: Template) => ReactNode;
  explore: () => void;
}) {
  const [rows, setRows] = useState<SavedTemplate[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true,
      revision = 0;
    const load = () => {
      const current = ++revision;
      void templateStore
        .list()
        .then((r) => {
          if (live && current === revision) {
            setRows(r.sort((a, b) => b.createdAt - a.createdAt));
            setError("");
            setLoading(false);
          }
        })
        .catch(() => {
          if (live && current === revision) {
            setError("模板暂时无法读取，请刷新页面重试。工作台内容不受影响。");
            setLoading(false);
          }
        });
    };
    load();
    window.addEventListener("learnspace:templates", load);
    return () => {
      live = false;
      window.removeEventListener("learnspace:templates", load);
    };
  }, []);
  return (
    <section
      className="saved-template-library"
      aria-label="我保存的模板"
      aria-busy={loading}
    >
      <header className="saved-template-heading">
        <div>
          <h2>我保存的模板{!loading && <span>{rows.length}</span>}</h2>
          <p>留住好用的工具组合，下次换个主题继续学。</p>
        </div>
        <details className="saved-template-storage">
          <summary>
            <Monitor size={14} aria-hidden="true" />
            仅此浏览器
          </summary>
          <p>
            模板保存在当前浏览器，不会自动公开或同步到其他设备。需要带走时可从卡片的“更多”中导出。
          </p>
        </details>
      </header>
      {loading && (
        <p className="saved-template-message" role="status">
          正在读取你的模板…
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && !rows.length && (
        <div className="saved-template-empty">
          <LayoutTemplate size={30} aria-hidden="true" />
          <h3>把喜欢的学习方式留在这里</h3>
          <p>在工作台菜单选择“保存／导出组合模板”，下次就能直接使用。</p>
          <button className="btn" onClick={explore}>
            先逛逛发现模板
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      <div className="saved-template-grid">
        {rows.map((row) => (
          <SavedTemplateCard
            key={row.id}
            row={row}
            install={install}
            notify={notify}
            renderPreview={renderPreview}
          />
        ))}
      </div>
    </section>
  );
}
function SavedTemplateCard({
  row,
  install,
  notify,
  renderPreview,
}: {
  row: SavedTemplate;
  install: (t: Template) => void;
  notify: (s: string) => void;
  renderPreview: (t: Template) => ReactNode;
}) {
  const t = row.template,
    menu = useRef<HTMLDetailsElement>(null),
    [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState(t.title),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) closeMenu();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menu.current?.open) {
        closeMenu();
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const useTemplate = () => install(structuredClone(t));
  async function rename() {
    setBusy(true);
    setError("");
    try {
      await templateStore.rename(row.id, title);
      setRenaming(false);
      notify("模板名称已更新");
    } catch (e) {
      setError(e instanceof Error ? e.message : "重命名失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="saved-template-card">
      <button
        className="saved-template-cover"
        onClick={useTemplate}
        aria-label={`预览${t.title}`}
      >
        {renderPreview(t)}
        <span className="saved-template-preview-hint">
          查看模板
          <ArrowUpRight size={15} />
        </span>
      </button>
      <div className="saved-template-body">
        <div className="saved-template-title-row">
          <h3>
            <button onClick={useTemplate}>{t.title}</button>
          </h3>
          <details className="saved-template-menu" ref={menu}>
            <summary aria-label={`${t.title}的更多操作`}>
              <MoreHorizontal size={19} aria-hidden="true" />
            </summary>
            <div className="saved-template-actions">
              <button
                disabled={busy}
                onClick={() => {
                  closeMenu();
                  setTitle(t.title);
                  setError("");
                  setRenaming(true);
                }}
              >
                <Pencil size={15} />
                重命名
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  closeMenu();
                  setError("");
                  try {
                    const checked = templateSchema.parse(t);
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(checked, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${checked.title}.learnspace.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    notify("模板已导出");
                  } catch {
                    setError("导出失败，请重试");
                  }
                }}
              >
                <Download size={15} />
                导出模板
              </button>
              <button
                className="saved-template-delete"
                disabled={busy}
                onClick={async () => {
                  closeMenu();
                  if (
                    !confirm(
                      `删除模板“${t.title}”？已创建的工作台和学习内容不会被删除。此操作无法撤销。`,
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await templateStore.remove(row.id);
                    notify("模板已删除，已有工作台保留");
                  } catch {
                    setError("删除失败，请重试");
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={15} />
                删除模板
              </button>
            </div>
          </details>
        </div>
        {renaming ? (
          <form
            className="saved-template-rename"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <label>
              模板名称
              <input
                autoFocus
                value={title}
                maxLength={80}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setRenaming(false);
                  }
                }}
              />
            </label>
            <div>
              <button
                className="btn mini"
                type="button"
                disabled={busy}
                onClick={() => setRenaming(false)}
              >
                取消
              </button>
              <button
                className="btn mini primary"
                disabled={busy || !title.trim()}
              >
                {busy ? "保存中…" : "保存名称"}
              </button>
            </div>
          </form>
        ) : (
          <p className="saved-template-description">
            {t.description || "按自己的节奏组合工具，开始下一次学习。"}
          </p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="saved-template-modules" aria-label="包含的工具">
          {[...new Set(t.modules.map((m) => m.type))]
            .slice(0, 4)
            .map((type) => (
              <span key={type} title={definitions[type].name}>
                <ModuleIcon type={type} size={14} />
                {definitions[type].name}
              </span>
            ))}
        </div>
        <footer>
          <span>
            {t.modules.length} 个模块
            {t.connections?.length
              ? ` · ${t.connections.length} 项材料预设`
              : ""}
          </span>
          <button
            className="btn mini primary"
            disabled={busy || renaming}
            onClick={useTemplate}
          >
            使用此模板
            <ArrowUpRight size={14} />
          </button>
        </footer>
      </div>
    </article>
  );
}
