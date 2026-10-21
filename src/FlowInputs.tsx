import { noteTitle } from "./noteContent";
import { contentKindLabels } from "./noteContent";
import { useEffect, useRef, useState } from "react";
import type { ModuleProps } from "./moduleProps";
import type { Connection, ReadContext } from "./connections";
import { readConnection, upstreamVersion, contentVersion } from "./connections";
import {
  inputPorts,
  outputPorts,
  portNames,
  connectionError,
} from "./connectionGraph";
import { flowPatch, flowInputSignature, readableInput } from "./flowData";
import type { Mod, Note } from "./model";
export function ConnectionBinding({
  edge,
  workspace,
  notes,
  save,
}: {
  edge: Connection;
  workspace: ModuleProps["workspace"];
  notes: Note[];
  save: (edges: Connection[]) => void;
}) {
  const [query, setQuery] = useState(edge.source.query || ""),
    [error, setError] = useState("");
  useEffect(
    () => setQuery(edge.source.query || ""),
    [edge.id, edge.source.query],
  );
  const source = workspace.modules.find((m) => m.id === edge.source.moduleId),
    target = workspace.modules.find((m) => m.id === edge.target.moduleId);
  const update = (value: Connection["source"]) => {
    try {
      const next = {
        ...edge,
        source: {
          ...value,
          ...(source?.type === "pdf" &&
          value.port === "selection" &&
          edge.source.range
            ? { range: edge.source.range }
            : {}),
        },
      };
      const edges = (workspace.connections || []).map((e) =>
        e.id === edge.id ? next : e,
      );
      const error = connectionError(workspace.modules, edges);
      if (error) throw Error(error);
      save(edges);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接更新失败");
    }
  };
  const bindQuery = () => {
    const q = query.trim();
    update({
      moduleId: edge.source.moduleId,
      port: "retrieval",
      ...(q ? { query: q } : { needsBinding: true as const }),
    });
  };
  const rows =
    edge.source.port === "tasks"
      ? source?.data?.tasks?.map((t) => ({ id: t.id, label: t.text }))
      : edge.source.port === "cards"
        ? source?.data?.cards?.map((t) => ({ id: t.id, label: t.front }))
        : edge.source.port === "events"
          ? source?.data?.events?.map((t) => ({ id: t.id, label: t.title }))
          : undefined;
  return (
    <div className="flow-binding">
      <label>
        输出内容
        <select
          aria-label="连接输出内容"
          value={edge.source.port}
          onChange={(e) => {
            const port = e.target.value as Connection["source"]["port"];
            update({
              moduleId: edge.source.moduleId,
              port,
              ...(["note", "retrieval"].includes(port)
                ? { needsBinding: true as const }
                : {}),
            });
          }}
        >
          {source &&
            outputPorts(source.type)
              .filter(
                (p) =>
                  target &&
                  inputPorts(target)
                    .find((f) => f.id === edge.target.field)
                    ?.accept.includes(p),
              )
              .map((p) => (
                <option key={p} value={p}>
                  {portNames[p]}
                </option>
              ))}
        </select>
      </label>
      {edge.source.port === "note" && (
        <label>
          来源篇目
          <select
            aria-label="连接来源篇目"
            value={edge.source.noteId || ""}
            onChange={(e) =>
              update({
                moduleId: edge.source.moduleId,
                port: "note",
                ...(e.target.value
                  ? { noteId: e.target.value }
                  : { needsBinding: true as const }),
              })
            }
          >
            <option value="">请选择篇目</option>
            {notes
              .filter(
                (n) =>
                  n.workspaceId === workspace.id &&
                  n.taskId === workspace.activeTaskId &&
                  n.moduleId === edge.source.moduleId,
              )
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {noteTitle(n.content, "空白笔记")}
                </option>
              ))}
          </select>
        </label>
      )}
      {edge.source.port === "retrieval" && (
        <label>
          检索关键词
          <input
            aria-label="连接检索关键词"
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={bindQuery}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </label>
      )}
      {rows && (
        <label>
          来源条目
          <select
            aria-label="连接来源条目"
            value={edge.source.itemId || ""}
            onChange={(e) =>
              update({
                ...edge.source,
                needsBinding: undefined,
                ...(e.target.value
                  ? { itemId: e.target.value }
                  : { itemId: undefined }),
              })
            }
          >
            <option value="">全部条目</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label.slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
      )}
      {edge.source.needsBinding &&
        !["note", "retrieval"].includes(edge.source.port) && (
          <button
            className="btn mini"
            onClick={() => update({ ...edge.source, needsBinding: undefined })}
          >
            使用来源模块中当前任务的内容
          </button>
        )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function FlowInputs(
  p: ModuleProps & { compact?: boolean; connectionId?: string },
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [expanded, setExpanded] = useState<string>(),
    [noteId, setNoteId] = useState(""),
    [date, setDate] = useState(p.mod.data?.selectedDate || ""),
    [time, setTime] = useState("09:00"),
    [undo, setUndo] = useState<{
      before: Mod;
      after: string;
      beforeNote?: Note;
      afterNote?: Note;
    }>();
  const controller = useRef<AbortController>(),
    latest = useRef(p),
    alive = useRef(true);
  latest.current = p;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const edges = (p.workspace.connections || []).filter(
    (e) =>
      e.target.moduleId === p.mod.id &&
      (!p.connectionId || e.id === p.connectionId),
  );
  const context = (props: ModuleProps): ReadContext => ({
    workspace: props.workspace,
    notes: props.notes,
    resources: props.resources,
    selection: props.bus.selection,
    selections: props.bus.selections,
  });
  async function get(ids: string[]) {
    const initial = latest.current;
    const selected = edges.filter((e) => ids.includes(e.id));
    if (!selected.length) return;
    const scope = `${initial.workspaceId}:${initial.taskId || "free"}`;
    const expected = flowInputSignature(initial.mod);
    const before = structuredClone(initial.mod);
    const oldNote = noteId
      ? initial.notes.find(
          (n) =>
            n.id === noteId &&
            n.moduleId === initial.mod.id &&
            n.workspaceId === initial.workspaceId &&
            n.taskId === initial.taskId,
        )
      : undefined;
    if (noteId && !oldNote) {
      setError("指定笔记在当前任务不可用，请重新选择");
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    try {
      const packets = await Promise.all(
        selected.map((c) => readConnection(c, context(initial), abort.signal)),
      );
      const now = latest.current;
      if (
        !alive.current ||
        abort.signal.aborted ||
        scope !== `${now.workspaceId}:${now.taskId || "free"}`
      )
        return;
      if (expected !== flowInputSignature(now.mod))
        throw Error("获取期间目标内容已变化，未覆盖编辑，请重新获取");
      for (let i = 0; i < selected.length; i++) {
        const c = now.workspace.connections?.find(
          (e) => e.id === selected[i].id,
        );
        if (
          !c ||
          JSON.stringify(c) !== JSON.stringify(selected[i]) ||
          upstreamVersion(c, context(now)) !== packets[i].connection?.version
        )
          throw Error("来源或连接已变化，请重新获取");
      }
      if (
        oldNote &&
        JSON.stringify(now.notes.find((n) => n.id === oldNote.id)) !==
          JSON.stringify(oldNote)
      )
        throw Error("篇目已被编辑，请重新获取");
      const append =
        ["text", "sticky", "note", "todo", "calendar"].includes(now.mod.type) ||
        selected.some((e) =>
          ["import", "transcript", "caption"].includes(e.target.field),
        );
      const destination = `${noteId || date || "default"}:${time}`;
      const same = packets.every((packet) =>
        now.mod.data?.flow?.inputs.some(
          (old) =>
            old.connection?.id === packet.connection?.id &&
            old.connection?.version === packet.connection?.version,
        ),
      );
      if (append && same && now.mod.data?.flow?.destination === destination) {
        p.notify("这些内容已获取，未重复追加。");
        return;
      }
      const result = flowPatch(
        now.mod,
        now.workspace.connections || [],
        packets,
        now.workspaceId,
        now.taskId,
        { note: oldNote, date, time },
      );
      result.patch.data!.flow!.destination = destination;
      if (result.note && !(await now.saveNote(result.note)))
        throw Error("笔记保存失败，未更新连接取用记录");
      if (!alive.current || abort.signal.aborted) return;
      now.mutate((m) => {
        if (flowInputSignature(m) !== expected) {
          queueMicrotask(() => p.notify("目标已变化，未覆盖新内容。"));
          return {};
        }
        return result.patch;
      });
      setUndo({
        before,
        after: flowInputSignature({ ...now.mod, ...result.patch }),
        beforeNote: oldNote,
        afterNote: result.note,
      });
      p.notify("内容已获取并保存，未调用 AI。");
    } catch (e) {
      if (!abort.signal.aborted && alive.current)
        setError(
          e instanceof Error
            ? e.name === "ZodError"
              ? "内容格式、日期或数量不符合目标要求，请检查来源设置。"
              : e.message
            : "获取失败，原内容保留",
        );
    } finally {
      if (alive.current && controller.current === abort) setBusy(false);
    }
  }
  const undoControl = undo && (
    <button
      className="text-button"
      disabled={busy}
      onClick={() => {
        const now = latest.current;
        try {
          if (flowInputSignature(now.mod) !== undo.after)
            throw Error("内容已继续编辑，不能覆盖这些修改");
          if (undo.afterNote) {
            const current = now.notes.find((n) => n.id === undo.afterNote!.id);
            if (
              !current ||
              JSON.stringify(current) !== JSON.stringify(undo.afterNote)
            )
              throw Error("笔记已变化，不能撤销覆盖");
            if (undo.beforeNote) void now.saveNote(undo.beforeNote);
            else now.deleteNote(undo.afterNote.id);
          }
          now.mutate((m) =>
            flowInputSignature(m) === undo.after
              ? {
                  data: undo.before.data,
                  input: undo.before.input,
                  output: undo.before.output,
                  source: undo.before.source,
                  resourceId: undo.before.resourceId,
                  page: undo.before.page,
                  activeNoteId: undo.before.activeNoteId,
                }
              : {},
          );
          setUndo(undefined);
          p.notify("已撤销本次获取。");
        } catch (e) {
          setError(e instanceof Error ? e.message : "无法撤销");
        }
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
          disabled={busy || !edges.length}
          onClick={() => void get(edges.map((e) => e.id))}
        >
          {busy ? "传递中…" : "传递内容"}
        </button>
        {busy && (
          <button
            className="text-button"
            onClick={() => {
              controller.current?.abort();
              setBusy(false);
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
  if (!edges.length && !p.mod.data?.flow?.inputs.length) return null;
  return (
    <section className="flow-inputs" aria-label="连接资料与取用记录">
      <div className="flow-inputs-heading">
        <b>
          {p.mod.type === "chat" ? "参考资料" : "连接内容"} · {edges.length}
        </b>
        {!!edges.length && (
          <button
            className="btn mini"
            disabled={busy}
            onClick={() => void get(edges.map((e) => e.id))}
          >
            {busy
              ? "获取中…"
              : p.mod.type === "note"
                ? noteId
                  ? "获取并追加到所选笔记"
                  : "获取并新建笔记"
                : "获取全部内容"}
          </button>
        )}
      </div>
      <p>点击获取即应用到此工具；连接不自动运行 AI。</p>
      {p.mod.type === "note" && (
        <label>
          写入篇目
          <select
            value={noteId}
            aria-label="连接写入篇目"
            onChange={(e) => setNoteId(e.target.value)}
          >
            <option value="">新建笔记（保留已有篇目）</option>
            {p.notes
              .filter(
                (n) =>
                  n.moduleId === p.mod.id &&
                  n.workspaceId === p.workspaceId &&
                  n.taskId === p.taskId,
              )
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {noteTitle(n.content, "空白笔记")}
                </option>
              ))}
          </select>
        </label>
      )}
      {p.mod.type === "calendar" && (
        <div className="flow-binding">
          <label>
            添加到日期
            <input
              type="date"
              aria-label="连接日程日期"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            时间
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
        </div>
      )}
      {edges.map((c) => {
        const previous = p.mod.data?.flow?.inputs.find(
          (v) => v.connection?.id === c.id,
        );
        let status = "尚未获取";
        try {
          const version = upstreamVersion(c, context(p));
          if (previous)
            status =
              version === previous.connection?.version
                ? "已获取"
                : "来源有更新";
        } catch (e) {
          status = e instanceof Error ? e.message : "来源不可用";
        }
        return (
          <article key={c.id}>
            <div>
              <b>
                {p.workspace.modules.find((m) => m.id === c.source.moduleId)
                  ?.title || "来源已移除"}
              </b>
              <span>
                {portNames[c.source.port]} · {status}
              </span>
            </div>
            <div className="task-actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void get([c.id])}
              >
                获取内容
              </button>
              <button
                className="text-button"
                onClick={() =>
                  setExpanded(expanded === c.id ? undefined : c.id)
                }
              >
                来源设置
              </button>
              <button
                className="text-button"
                onClick={() =>
                  p.setConnections(
                    (p.workspace.connections || []).filter(
                      (e) => e.id !== c.id,
                    ),
                  )
                }
              >
                移除
              </button>
            </div>
            {expanded === c.id && (
              <ConnectionBinding
                edge={c}
                workspace={p.workspace}
                notes={p.notes}
                save={p.setConnections}
              />
            )}
          </article>
        );
      })}
      {busy && (
        <button
          className="text-button"
          onClick={() => {
            controller.current?.abort();
            setBusy(false);
          }}
        >
          取消获取
        </button>
      )}
      {undoControl}
      {p.mod.data?.flow?.previousOutput && (
        <details>
          <summary>上次生成结果（历史保留）</summary>
          <pre>{p.mod.data.flow.previousOutput.text}</pre>
          {p.mod.data.flow.previousOutput.source && (
            <button
              className="source-chip"
              onClick={() => p.jump(p.mod.data!.flow!.previousOutput!.source!)}
            >
              查看当时参考资料
            </button>
          )}
        </details>
      )}
      {!!p.mod.data?.flow?.inputs.length && (
        <details>
          <summary>已获取内容与来源</summary>
          {p.mod.data.flow.inputs.map((v, i) => (
            <div key={v.connection?.id || i}>
              <small>
                {contentKindLabels[v.kind]} ·{" "}
                {v.connection
                  ? new Date(v.connection.fetchedAt).toLocaleString()
                  : ""}
              </small>
              <pre>
                {["document", "image_ref", "video_ref"].includes(
                  v.connection?.port || "",
                )
                  ? `文件引用：${v.sources[0]?.resourceName || "来源文件"}`
                  : readableInput(v)}
              </pre>
              {v.sources.map((s, j) => (
                <button
                  className="source-chip"
                  key={j}
                  onClick={() => p.jump(s)}
                >
                  {s.resourceName || "来源"}
                  {s.kind === "pdf" ? ` · 第${s.page}页` : ""} ↗
                </button>
              ))}
            </div>
          ))}
        </details>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
