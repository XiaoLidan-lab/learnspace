import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Sparkles } from "lucide-react";
import { TaskDialog } from "./TaskDialog";
import { CustomConfigFields } from "./CustomConfigFields";
import { defaultCustomConfig, type CustomConfig } from "./customAI";
import {
  customModuleStore,
  type SavedCustomModule,
} from "./customModuleStore";
export function CustomModuleLibrary({
  close,
  install,
  notify,
}: {
  close: () => void;
  install?: (c: CustomConfig) => void;
  notify: (s: string) => void;
}) {
  const [rows, setRows] = useState<SavedCustomModule[]>([]),
    [draft, setDraft] = useState<CustomConfig>(),
    [editing, setEditing] = useState<string>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const load = () =>
    customModuleStore
      .list()
      .then(setRows)
      .catch(() => setError("模块库读取失败，请关闭后重试"))
      .finally(() => setLoaded(true));
  useEffect(() => {
    void load();
  }, []);
  const leave = () => {
    if (draft && !confirm("放弃尚未保存的模块修改？")) return;
    close();
  };
  return (
    <TaskDialog title="我的模块" close={leave}>
      <div className="personal-modules">
        <p className="personal-module-intro">
          把常用的 AI 学习方法保存为工具，需要时再添加到工作台。
        </p>
        {!draft ? (
          <>
            <div className="section-heading">
              <b>{rows.length} 个自定义工具</b>
              <button
                className="btn primary"
                onClick={() => {
                  setDraft(defaultCustomConfig());
                  setEditing(undefined);
                  setError("");
                }}
              >
                <Plus size={15} />
                创建模块
              </button>
            </div>
            <p className="small">
              仅保存在此浏览器。添加到工作台的是独立副本，不共享输入、资料和运行历史。
            </p>
            {!loaded && <p role="status">正在加载模块…</p>}
            {loaded && !rows.length && !error && (
              <div className="personal-module-empty">
                <Sparkles size={30} />
                <h3>先从已有工具开始</h3>
                <p>遇到需要反复使用的专属分析方式，再创建自己的模块。</p>
              </div>
            )}
            {rows.map((r) => (
              <article className="personal-module-card" key={r.id}>
                <h3>{r.config.name}</h3>
                <p>{r.config.purpose}</p>
                <div className="plan-tools">
                  {r.config.fields.map((f) => (
                    <span key={f.id}>{f.label}</span>
                  ))}
                </div>
                <div className="task-actions">
                  {install && (
                    <button
                      className="btn primary"
                      onClick={() => {
                        try {
                          install(r.config);
                          close();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "添加失败");
                        }
                      }}
                    >
                      添加到当前工作台
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => {
                      setDraft(structuredClone(r.config));
                      setEditing(r.id);
                      setError("");
                    }}
                  >
                    <Pencil size={14} />
                    编辑
                  </button>
                  <button
                    className="btn"
                    aria-label={`删除模块 ${r.config.name}`}
                    onClick={() => {
                      if (
                        confirm("删除此模块定义？已安装的工作台副本不受影响。")
                      )
                        void customModuleStore
                          .remove(r.id)
                          .then(load)
                          .catch(() => setError("删除失败，请重试"));
                    }}
                  >
                    <Trash2 size={14} />
                    删除
                  </button>
                </div>
              </article>
            ))}
          </>
        ) : (
          <>
            <h3>{editing ? "编辑模块" : "创建自定义模块"}</h3>
            <CustomConfigFields draft={draft} setDraft={setDraft} />
            <div className="task-actions">
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await customModuleStore.save(draft, editing);
                    await load();
                    setDraft(undefined);
                    notify("模块已保存到“我的模块”；未运行 AI。");
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "保存失败，请检查配置和本地存储",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "正在保存…" : "保存到我的模块"}
              </button>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (confirm("放弃此次编辑？")) {
                    setDraft(undefined);
                    setError("");
                  }
                }}
              >
                取消
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </TaskDialog>
  );
}
