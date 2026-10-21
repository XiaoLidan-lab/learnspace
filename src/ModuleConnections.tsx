import { noteTitle } from "./noteContent";
import { dataFlowRole } from "./definitions";
import { graphInputs, graphOutputs } from "./connectionLayout";
import { ConnectionBinding } from "./FlowInputs";
import { inputPorts, privateConnectionSource } from "./connectionGraph";
import { useEffect, useRef, useState } from "react";
import type { ModuleProps } from "./moduleProps";
import type { Workspace, Note } from "./model";
import { uid } from "./model";
import {
  outputPorts,
  portNames,
  connectionError,
  upstreamVersion,
  readConnection,
  applyConnectedInput,
  type Connection,
  type ConnectedInput,
} from "./connections";
export function ConnectionEditor({
  workspace,
  notes,
  targetId,
  initial,
  initialTarget,
  existing,
  templateMode = false,
  save,
  cancel,
}: {
  workspace: Workspace;
  notes: Note[];
  targetId?: string;
  initial?: Connection["source"];
  initialTarget?: Connection["target"];
  existing?: Connection;
  templateMode?: boolean;
  save: (c: Connection) => void;
  cancel: () => void;
}) {
  initial = existing?.source || initial;
  const [from, setFrom] = useState(initial?.moduleId || ""),
    [port, setPort] = useState<Connection["source"]["port"]>(
      initial?.port || "text",
    ),
    [noteId, setNoteId] = useState(initial?.noteId || ""),
    [query, setQuery] = useState(initial?.query || ""),
    [target, setTarget] = useState(
      targetId || existing?.target.moduleId || initialTarget?.moduleId || "",
    ),
    [field, setField] = useState(
      existing?.target.field || initialTarget?.field || "",
    ),
    [error, setError] = useState("");
  const source = workspace.modules.find((m) => m.id === from),
    to = workspace.modules.find((m) => m.id === target);
  const visibleEdges = existing ? [existing] : [];
  const fields = to ? graphInputs(to, visibleEdges) : [];
  return (
    <section aria-label="连接配置" className="custom-config">
      <p className="small">
        连接配置共享；取数只读取当前任务。指定笔记仅在所属任务可用。保存连接不会读取内容或调用
        AI。
      </p>
      <label>
        来源模块实例
        <select
          aria-label="连接来源模块"
          value={from}
          onChange={(e) => {
            const id = e.target.value;
            setFrom(id);
            const selected = workspace.modules.find((m) => m.id === id);
            setPort(
              selected ? graphOutputs(selected, visibleEdges)[0] : "text",
            );
            setNoteId("");
          }}
        >
          <option value="">请选择来源</option>
          {workspace.modules
            .filter(
              (m) => m.id !== target && graphOutputs(m, visibleEdges).length,
            )
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} · {m.id.slice(-6)}
              </option>
            ))}
        </select>
      </label>
      <label>
        输出内容
        <select
          aria-label="连接来源输出"
          value={port}
          onChange={(e) => setPort(e.target.value as typeof port)}
        >
          {source &&
            graphOutputs(source, visibleEdges).map((p) => (
              <option key={p} value={p}>
                {portNames[p]}
              </option>
            ))}
        </select>
      </label>
      {port === "note" && !templateMode && (
        <label>
          具体篇目
          <select
            aria-label="连接笔记篇目"
            value={noteId}
            onChange={(e) => setNoteId(e.target.value)}
          >
            <option value="">请选择具体笔记</option>
            {notes
              .filter(
                (n) =>
                  n.moduleId === from &&
                  n.workspaceId === workspace.id &&
                  n.taskId === workspace.activeTaskId,
              )
              .map((n) => (
                <option value={n.id} key={n.id}>
                  {noteTitle(n.content, "空白笔记")} ·{" "}
                  {n.id.slice(-6)}
                </option>
              ))}
          </select>
        </label>
      )}
      {port === "retrieval" && !templateMode && (
        <label>
          检索关键词
          <input
            aria-label="连接 PDF 检索关键词"
            maxLength={500}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {templateMode && privateConnectionSource(source?.type, port) && (
        <p role="status">
          私人来源将在安装后重新绑定；此处仅配置模块关系，不读取资料。
        </p>
      )}
      {!targetId && (
        <label>
          目标工具
          <select
            aria-label="连接目标模块"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setField("");
            }}
          >
            <option value="">请选择目标</option>
            {workspace.modules
              .filter(
                (m) => graphInputs(m, visibleEdges).length > 0 && m.id !== from,
              )
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} · {m.id.slice(-6)}
                </option>
              ))}
          </select>
        </label>
      )}
      <label>
        命名输入字段
        <select
          aria-label="连接目标字段"
          value={field}
          onChange={(e) => setField(e.target.value)}
        >
          <option value="">请选择输入字段</option>
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label} · {f.id}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <button
        className="btn primary"
        onClick={() => {
          const c: Connection = {
            id:
              existing?.id ||
              (templateMode
                ? `c${Math.max(0, ...(workspace.connections || []).map((e) => Number(e.id.slice(1)) || 0)) + 1}`
                : uid()),
            source: {
              moduleId: from,
              port,
              ...(templateMode
                ? privateConnectionSource(source?.type, port)
                  ? { needsBinding: true as const }
                  : {}
                : port === "note"
                  ? { noteId }
                  : {}),
              ...(!templateMode && port === "retrieval" ? { query } : {}),
            },
            target: { moduleId: target, field },
            trigger: "manual",
            mode: "replace",
          };
          if (
            !existing &&
            (!source ||
              !to ||
              ["练习巩固", "辅助工具"].includes(dataFlowRole(source.type)) ||
              ["内容来源", "辅助工具"].includes(dataFlowRole(to.type)))
          ) {
            setError(
              "此方向不支持新建连接，请从来源或处理工具连接到处理工具或成果",
            );
            return;
          }
          const issue = connectionError(workspace.modules, [
            ...(workspace.connections || []).filter(
              (e) => e.id !== existing?.id,
            ),
            c,
          ]);
          if (issue) {
            setError(issue);
            return;
          }
          try {
            save(c);
          } catch (e) {
            setError(e instanceof Error ? e.message : "连接保存失败");
          }
        }}
      >
        保存连接
      </button>{" "}
      <button className="btn" onClick={cancel}>
        取消配置
      </button>
    </section>
  );
}
export function ModuleConnections(
  p: ModuleProps & { compact?: boolean; connectionId?: string },
) {
  const [editing, setEditing] = useState(false),
    [existing, setExisting] = useState<Connection>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [selection, setSelection] = useState(p.bus.selection),
    [preview, setPreview] = useState<{
      edge: Connection;
      input: ConnectedInput;
      expected: string;
    } | null>(null);
  const controller = useRef<AbortController>(),
    latest = useRef(p);
  latest.current = p;
  const [undoInput, setUndoInput] = useState<{
    field: string;
    before: ConnectedInput | undefined;
    after: string;
  }>();
  const scope = `${p.workspaceId}:${p.taskId || "free"}`;
  const live = useRef(scope);
  live.current = scope;
  useEffect(() => {
    live.current = scope;
    const off = p.bus.on("selection.changed", setSelection),
      clear = p.bus.on("selection.cleared", () => setSelection(null));
    return () => {
      off();
      clear();
      controller.current?.abort();
      live.current = "closed";
    };
  }, [p.bus]);
  const ctx = {
    workspace: p.workspace,
    notes: p.notes,
    resources: p.resources,
    selection,
    selections: p.bus.selections,
  };
  const edges = (p.workspace.connections || []).filter(
    (c) =>
      c.target.moduleId === p.mod.id &&
      (!p.connectionId || c.id === p.connectionId),
  );
  async function fetchInput(c: Connection) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(c.id);
    setError("");
    setPreview(null);
    const expected = JSON.stringify(
      p.mod.data?.custom?.inputs[c.target.field] || null,
    );
    try {
      const input = await readConnection(c, ctx, abort.signal);
      if (!abort.signal.aborted && live.current === scope) {
        const now = latest.current;
        const edge = now.workspace.connections?.find((e) => e.id === c.id);
        if (!edge || JSON.stringify(edge) !== JSON.stringify(c))
          throw Error("连接已变化，请重新获取");
        if (
          upstreamVersion(edge, {
            workspace: now.workspace,
            notes: now.notes,
            resources: now.resources,
            selection: now.bus.selection,
            selections: now.bus.selections,
          }) !== input.connection?.version
        )
          throw Error("来源已变化，请重新获取");
        applyConnectedInput(
          now.mod,
          c,
          input,
          now.workspaceId,
          now.taskId,
          expected,
        );
        const before = now.mod.data?.custom?.inputs[c.target.field];
        now.mutate((m) => {
          try {
            return applyConnectedInput(
              m,
              c,
              input,
              now.workspaceId,
              now.taskId,
              expected,
            );
          } catch {
            queueMicrotask(() => now.notify("输入已变化，未覆盖新内容。"));
            return {};
          }
        });
        setUndoInput({
          field: c.target.field,
          before: before ? structuredClone(before) : undefined,
          after: JSON.stringify(input),
        });
        setPreview({ edge: structuredClone(c), input, expected });
        now.notify("输入已获取，未运行 AI。");
      }
    } catch (e) {
      if (!abort.signal.aborted && live.current === scope)
        setError(e instanceof Error ? e.message : "获取失败，现有输入保留");
    } finally {
      if (live.current === scope && controller.current === abort) setBusy("");
    }
  }
  const undoControl = undoInput && (
    <button
      className="text-button"
      onClick={() => {
        const now = latest.current;
        if (
          JSON.stringify(now.mod.data?.custom?.inputs[undoInput.field]) !==
          undoInput.after
        ) {
          setError("输入已继续编辑，无法撤销覆盖这些修改");
          return;
        }
        now.mutate((m) => {
          const runtime = m.data?.custom || { inputs: {}, runs: [] };
          if (
            JSON.stringify(runtime.inputs[undoInput.field]) !== undoInput.after
          )
            return {};
          const inputs = { ...runtime.inputs };
          if (undoInput.before) inputs[undoInput.field] = undoInput.before;
          else delete inputs[undoInput.field];
          return { data: { ...m.data, custom: { ...runtime, inputs } } };
        });
        setUndoInput(undefined);
        setPreview(null);
      }}
    >
      撤销本次获取
    </button>
  );
  if (p.compact)
    return (
      <div className="connection-quick-transfer">
        <button
          className="btn mini"
          disabled={!!busy || !edges.length}
          onClick={() => void fetchInput(edges[0])}
        >
          {busy ? "传递中…" : "传递内容"}
        </button>
        {busy && (
          <button
            className="text-button"
            onClick={() => {
              controller.current?.abort();
              setBusy("");
            }}
          >
            取消
          </button>
        )}
        {undoControl}
        {error && (
          <span className="connection-quick-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  return (
    <details className="module-connections">
      <summary>模块数据连接（{edges.length}）</summary>
      <p className="small">
        点击获取即替换对应输入，可撤销；上游更新不会自动覆盖，也不触发 AI。
      </p>
      {!edges.length && <p>未建立连接，仍可手动输入并独立运行。</p>}
      {edges.map((c) => {
        const input = p.mod.data?.custom?.inputs[c.target.field];
        let status = "尚未获取";
        try {
          const v = upstreamVersion(c, ctx);
          if (input?.connection?.id === c.id)
            status =
              input.connection.version !== v
                ? "上游内容已变化，请手动重新获取"
                : input.connection.edited
                  ? "输入已手动编辑，原取数快照保留"
                  : "已获取，来源未变化";
        } catch (e) {
          status = e instanceof Error ? e.message : "来源不可用";
        }
        return (
          <article className="task-link" key={c.id}>
            <b>
              {p.workspace.modules.find((m) => m.id === c.source.moduleId)
                ?.title || "来源已删除"}{" "}
              · {c.source.moduleId.slice(-6)} →{" "}
              {p.mod.customConfig?.fields.find((f) => f.id === c.target.field)
                ?.label || c.target.field}
            </b>
            <p className="small">
              {portNames[c.source.port]}
              {c.source.noteId ? ` · 篇目 ${c.source.noteId.slice(-6)}` : ""}
              {c.source.query ? ` · ${c.source.query}` : ""}
            </p>
            <p role="status">{status}</p>
            <button
              className="btn mini"
              disabled={!!busy}
              onClick={() => void fetchInput(c)}
            >
              {busy === c.id ? "正在获取…" : "获取内容"}
            </button>{" "}
            <button
              className="btn mini"
              onClick={() => {
                controller.current?.abort();
                setBusy("");
                setPreview(null);
                p.setConnections(
                  (p.workspace.connections || []).filter((e) => e.id !== c.id),
                );
              }}
            >
              移除连接
            </button>{" "}
            <button
              className="btn mini"
              onClick={() => {
                setPreview(null);
                setExisting(c);
                setEditing(true);
              }}
            >
              {c.source.needsBinding ? "重新绑定来源" : "编辑连接"}
            </button>
          </article>
        );
      })}
      {busy && (
        <button
          className="btn mini"
          onClick={() => {
            controller.current?.abort();
            setBusy("");
          }}
        >
          取消获取
        </button>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {undoControl}
      {preview && (
        <details>
          <summary>已获取内容与来源</summary>
          <pre className="custom-text">{preview.input.text}</pre>
          {preview.input.sources.map((s, i) => (
            <button key={i} className="source-chip" onClick={() => p.jump(s)}>
              {s.resourceName || "来源"}
              {s.kind === "pdf" ? ` · 第${s.page}页` : ""} ↗
            </button>
          ))}
        </details>
      )}
      {!editing ? (
        <button
          className="btn mini"
          onClick={() => {
            setExisting(undefined);
            setEditing(true);
          }}
        >
          添加数据连接
        </button>
      ) : existing ? (
        <div>
          <ConnectionBinding
            edge={
              p.workspace.connections?.find((c) => c.id === existing.id) ||
              existing
            }
            workspace={p.workspace}
            notes={p.notes}
            save={p.setConnections}
          />
          <button className="text-button" onClick={() => setEditing(false)}>
            收起设置
          </button>
        </div>
      ) : (
        <ConnectionEditor
          key="new"
          existing={existing}
          workspace={p.workspace}
          notes={p.notes}
          targetId={p.mod.id}
          save={(c) => {
            p.setConnections([
              ...(p.workspace.connections || []).filter((e) => e.id !== c.id),
              c,
            ]);
            setEditing(false);
          }}
          cancel={() => setEditing(false)}
        />
      )}
    </details>
  );
}
