import { customModuleStore } from "./customModuleStore";
import { CustomConfigFields } from "./CustomConfigFields";
import { useEffect, useRef, useState } from "react";
import type { ModuleProps } from "./moduleProps";
import { ai } from "./services";
import { uid } from "./model";
import { MarkdownContent } from "./MarkdownContent";
import { selectionKind } from "./noteContent";
import {
  customConfigSchema,
  customStateKey,
  customRequestSchema,
  customSourceSchema,
  customEvidence,
  defaultCustomConfig,
  renderCustomPrompt,
  validateCustomResult,
  nextCustomRuntime,
  completeCustomRun,
  type CustomConfig,
  type CustomRun,
  type CustomRuntime,
} from "./customAI";
import type { SelectionContext } from "./events";
const statusLabels = {
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断（结果未确认）",
};
export function CustomAIModule(p: ModuleProps) {
  const config = p.mod.customConfig || defaultCustomConfig(),
    runtime = p.mod.data?.custom || { inputs: {}, runs: [] };
  const [editing, setEditing] = useState(!p.mod.customConfig),
    [draft, setDraft] = useState<CustomConfig>(config),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selection, setSelection] = useState<SelectionContext | null>(
      p.bus.selection,
    ),
    [selected, setSelected] = useState(""),
    [noteTarget, setNoteTarget] = useState(""),
    [saving, setSaving] = useState(false);
  const active = useRef<{
    id: string;
    controller: AbortController;
    signature: string;
  }>();
  const signature = customStateKey(config, runtime.inputs);
  const mutateRuntime = (f: (s: CustomRuntime) => CustomRuntime) =>
    p.mutate((m) => ({
      data: {
        ...m.data,
        custom: f(m.data?.custom || { inputs: {}, runs: [] }),
      },
    }));
  function stop(message = "请求已取消，已有成功结果保留") {
    const running = active.current;
    if (!running) return;
    active.current = undefined;
    running.controller.abort();
    setBusy(false);
    mutateRuntime((s) =>
      nextCustomRuntime(s, running.id, {
        status: "cancelled",
        finishedAt: Date.now(),
        error: message,
      }),
    );
  }
  useEffect(() => {
    if (runtime.runs.some((r) => r.status === "running"))
      mutateRuntime((s) => ({
        ...s,
        runs: s.runs.map((r) =>
          r.status === "running"
            ? {
                ...r,
                status: "interrupted",
                finishedAt: Date.now(),
                error: "页面或模块重新打开，先前请求结果未确认；不会自动重发。",
              }
            : r,
        ),
      }));
    return () => {
      const running = active.current;
      if (running) {
        active.current = undefined;
        running.controller.abort();
        mutateRuntime((s) =>
          nextCustomRuntime(s, running.id, {
            status: "cancelled",
            finishedAt: Date.now(),
            error: "模块关闭或切换任务，请求已取消；不会写入其他任务。",
          }),
        );
      }
    };
  }, []);
  useEffect(() => {
    if (active.current && active.current.signature !== signature)
      stop("输入或共享配置已变化，旧请求已取消。");
  }, [signature]);
  useEffect(() => {
    const a = p.bus.on("selection.changed", setSelection),
      b = p.bus.on("selection.cleared", () => setSelection(null));
    return () => {
      a();
      b();
    };
  }, [p.bus]);
  function setInput(id: string, text: string, fromSelection = false) {
    const nextText = fromSelection ? text.slice(0, 8000) : text;
    const total =
      Object.entries(runtime.inputs).reduce(
        (n, [key, value]) => n + (key === id ? 0 : value.text.length),
        0,
      ) + nextText.length;
    if (total > 12000) {
      setError("输入合计最多 12000 字符，请缩短内容后再保存。");
      return;
    }
    setError("");
    if (fromSelection && text.length > 8000)
      p.notify("选区超过 8000 字符，已截取前 8000 字符；可分段处理。");
    if (fromSelection && selection) {
      const source = customSourceSchema.safeParse({
        ...selection,
        text: selection.text.slice(0, 1200),
        resourceName: selection.resourceName?.slice(0, 300),
      });
      if (!source.success) {
        setError("选区来源格式无效，请重新选择。");
        return;
      }
      mutateRuntime((s) => ({
        ...s,
        inputs: {
          ...s.inputs,
          [id]: {
            text: selection.text.slice(0, 8000),
            sources: [source.data],
            kind: selectionKind(selection),
          },
        },
      }));
    } else
      mutateRuntime((s) => {
        const old = s.inputs[id];
        return {
          ...s,
          inputs: {
            ...s.inputs,
            [id]: {
              ...old,
              ...(old?.connection
                ? { connection: { ...old.connection, edited: true } }
                : {}),
              text,
              sources: old?.sources || [],
              kind: old?.sources.length ? "mixed" : "user",
            },
          },
        };
      });
  }
  async function run(previous?: CustomRun) {
    if (active.current) return;
    const checked = customRequestSchema.safeParse(
      previous
        ? { config: previous.config, inputs: previous.inputs }
        : {
            config,
            inputs: Object.fromEntries(
              config.fields
                .filter((f) => runtime.inputs[f.id])
                .map((f) => [f.id, runtime.inputs[f.id]]),
            ),
          },
    );
    if (!checked.success) {
      setError(checked.error.issues[0].message);
      return;
    }
    setError("");
    setBusy(true);
    const id = uid(),
      controller = new AbortController(),
      started: CustomRun = {
        id,
        workspaceId: p.workspaceId,
        moduleId: p.mod.id,
        taskId: p.taskId,
        config: structuredClone(checked.data.config),
        inputs: structuredClone(checked.data.inputs),
        startedAt: Date.now(),
        status: "running",
        ...(previous ? { retryOf: previous.id } : {}),
      };
    active.current = { id, controller, signature };
    mutateRuntime((s) => ({ ...s, runs: [...s.runs.slice(-9), started] }));
    setSelected(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Error("AI 请求超时，结果尚未确认；已有结果保留，可按原快照重试。"),
          );
          controller.abort();
        }, 60000);
      });
      const result = validateCustomResult(
        await Promise.race([
          ai("custom", checked.data, controller.signal),
          timedOut,
        ]),
        checked.data,
      );
      if (active.current?.id !== id || controller.signal.aborted) return;
      p.mutate((m) =>
        completeCustomRun(m, id, {
          status: "succeeded",
          finishedAt: Date.now(),
          result,
        }),
      );
    } catch (e) {
      if (active.current?.id !== id) return;
      const message =
        e instanceof Error ? e.message.slice(0, 500) : "运行失败，请重试";
      mutateRuntime((s) =>
        nextCustomRuntime(s, id, {
          status: "failed",
          finishedAt: Date.now(),
          error: message,
        }),
      );
      setError(message);
    } finally {
      clearTimeout(timer);
      if (active.current?.id === id) {
        active.current = undefined;
        setBusy(false);
      }
    }
  }
  const lastSuccess = [...runtime.runs]
    .reverse()
    .find((r) => r.status === "succeeded" && r.result);
  const viewed =
    runtime.runs.find((r) => r.id === selected && r.result) || lastSuccess;
  const promptPreview = renderCustomPrompt({ config, inputs: runtime.inputs });
  return (
    <div className="utility-body custom-ai-module">
      <p className="small">{config.purpose}</p>
      <p className="small">
        {p.taskId ? "当前学习任务" : "自由学习"} · 输入和结果独立保存
      </p>
      <button
        className="btn mini"
        disabled={busy}
        onClick={() => {
          setDraft(structuredClone(config));
          setEditing(!editing);
          setError("");
        }}
      >
        配置模块
      </button>
      <button
        className="text-button"
        disabled={busy}
        onClick={() =>
          void customModuleStore
            .save(config)
            .then(() =>
              p.notify("配置已保存到“我的模块”，不包含输入和运行记录。"),
            )
            .catch((e) => setError(e instanceof Error ? e.message : "保存失败"))
        }
      >
        保存到我的模块
      </button>
      {editing && (
        <section aria-label="自定义模块配置" className="custom-config">
          <p className="small">
            配置由此工作台所有任务共享；输入、来源、运行记录各自独立。更改变量名会影响输入匹配，历史快照保持不变。
          </p>
          <CustomConfigFields draft={draft} setDraft={setDraft} />
          <button
            className="btn primary"
            onClick={() => {
              const parsed = customConfigSchema.safeParse(draft);
              if (!parsed.success) {
                setError(parsed.error.issues[0].message);
                return;
              }
              if (
                !confirm(
                  "保存共享配置？此工作台其他任务也会使用新配置，已有输入、成果和历史结果保持不变。",
                )
              )
                return;
              p.configure(parsed.data);
              setEditing(false);
              setError("");
              p.notify("共享配置已更新，任务内容和历史结果保留。");
            }}
          >
            保存模块配置
          </button>
        </section>
      )}
      {config.fields.map((f) => (
        <label key={f.id} className="form-label">
          {f.label}
          {f.required ? " *" : ""}
          <textarea
            aria-label={`自定义输入：${f.label}`}
            maxLength={8000}
            value={runtime.inputs[f.id]?.text || ""}
            onChange={(e) => setInput(f.id, e.target.value)}
          />
          <span className="small">
            {runtime.inputs[f.id]?.kind === "mixed"
              ? "用户编辑内容（保留来源关联）"
              : runtime.inputs[f.id]?.sources.length
                ? "已关联选区来源"
                : "手动输入 · 用户内容"}
          </span>
          {selection && selection.moduleId !== p.mod.id && (
            <button
              className="text-button"
              aria-label={`使用当前选区作为${f.label}`}
              onClick={() => setInput(f.id, selection.text, true)}
            >
              使用当前选区作为{f.label}
            </button>
          )}
          {!!runtime.inputs[f.id]?.sources.length && (
            <button
              className="text-button"
              aria-label={`移除${f.label}的来源关联`}
              onClick={() =>
                mutateRuntime((s) => ({
                  ...s,
                  inputs: {
                    ...s.inputs,
                    [f.id]: {
                      ...s.inputs[f.id],
                      connection: s.inputs[f.id].connection
                        ? { ...s.inputs[f.id].connection!, edited: true }
                        : undefined,
                      sources: [],
                      kind: "user",
                    },
                  },
                }))
              }
            >
              移除此字段来源关联
            </button>
          )}
        </label>
      ))}
      <details>
        <summary>本次输入与 Prompt 预览</summary>
        <p className="small">
          这些字段和关联来源将发送到现有模型服务；不会自动读取其他任务或整个工作台。
        </p>
        <pre className="custom-text">{promptPreview}</pre>
      </details>
      <div className="task-inline">
        <button
          className="btn primary"
          disabled={busy || editing}
          onClick={() => void run()}
        >
          {busy ? "运行中…" : "运行自定义模块"}
        </button>
        {busy && (
          <button className="btn" onClick={() => stop()}>
            取消运行
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}；上次成功结果保留。
        </p>
      )}
      <p className="small" role="status">
        {busy
          ? "正在运行，切换任务或修改输入会取消本次请求。"
          : "自动保存到此设备；任务面板展示本地与云端保存状态。"}
      </p>
      {viewed?.result && (
        <section aria-label="自定义模块运行结果">
          <h4>AI 生成结果</h4>
          <p className="small">
            {new Date(viewed.startedAt).toLocaleString()} · 配置 v
            {viewed.config.version} · 来源关联需核验是否支持结论
          </p>
          {customStateKey(viewed.config, viewed.inputs) !== signature && (
            <p className="small">
              当前输入或配置已变化；以下是历史结果，未被覆盖。
            </p>
          )}
          {viewed.config.display === "markdown" ? (
            <MarkdownContent>{viewed.result.text}</MarkdownContent>
          ) : (
            <pre className="custom-text">{viewed.result.text}</pre>
          )}
          <p className="small">
            在学习任务面板“关联已有学习成果”中选择本次运行，即可保存成果快照。
          </p>
          {!!p.noteTargets.length && (
            <label>
              保存到笔记模块
              <select
                aria-label="自定义结果目标笔记"
                value={noteTarget || p.noteTargets[0].id}
                onChange={(e) => setNoteTarget(e.target.value)}
              >
                {p.noteTargets.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="btn mini"
            disabled={saving || !p.noteTargets.length}
            onClick={async () => {
              setSaving(true);
              try {
                await p.saveCustomNote(
                  noteTarget || p.noteTargets[0].id,
                  viewed.id,
                );
              } catch (e) {
                setError(e instanceof Error ? e.message : "保存失败，请重试");
              } finally {
                setSaving(false);
              }
            }}
          >
            另存到笔记
          </button>
          {!p.noteTargets.length && (
            <p className="small">
              也可添加现有笔记模块后另存结果；当前运行记录已自动保存。
            </p>
          )}
          {customEvidence(viewed)
            .filter((e) => viewed.result!.citations.includes(e.id))
            .map((e) => (
              <details key={e.id}>
                <summary>
                  [{e.id}] {e.source.resourceName || e.field} ·{" "}
                  {e.source.kind === "pdf"
                    ? `第 ${e.source.page} 页`
                    : "关联来源"}
                </summary>
                <p>{e.source.text}</p>
                <button
                  className="text-button"
                  onClick={() => p.jump(e.source)}
                >
                  定位来源
                </button>
              </details>
            ))}
        </section>
      )}
      <details>
        <summary>运行记录（{runtime.runs.length}/10）</summary>
        <p className="small">
          保留最近 10
          次，旧记录会滚动移除；重要结果请先关联为成果。取消或超时不代表模型一定停止计费。
        </p>
        {[...runtime.runs].reverse().map((r) => (
          <article key={r.id} className="task-link">
            <b>
              {statusLabels[r.status]} ·{" "}
              {new Date(r.startedAt).toLocaleString()}
            </b>
            <p className="small">
              配置 v{r.config.version}
              {r.retryOf ? " · 按原快照重试" : ""}
            </p>
            {r.error && <p>{r.error}</p>}
            <details>
              <summary>输入、配置与来源快照</summary>
              <pre className="custom-text">{renderCustomPrompt(r)}</pre>
              {Object.entries(r.inputs)
                .filter(([, i]) => i.connection)
                .map(([key, i]) => (
                  <p key={key} className="small">
                    {r.config.fields.find((f) => f.id === key)?.label || key} ·{" "}
                    {i.sources[0]?.resourceName || "所选材料"} ·{" "}
                    {i.connection!.edited
                      ? "使用编辑后的内容"
                      : "使用当时的内容快照"}
                  </p>
                ))}
              {customEvidence(r).map((e) => (
                <p key={e.id}>
                  [{e.id}] {e.source.resourceName || e.field} · {e.source.text}
                </p>
              ))}
            </details>
            {r.result && (
              <button className="btn mini" onClick={() => setSelected(r.id)}>
                查看此结果
              </button>
            )}
            {r.status !== "running" && (
              <button
                className="btn mini"
                disabled={busy || editing}
                onClick={() => void run(r)}
              >
                按原快照重试
              </button>
            )}
          </article>
        ))}
      </details>
    </div>
  );
}
