import { MarkdownContent } from "./MarkdownContent";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Sparkles,
  Copy,
  RotateCcw,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Check,
  GripVertical,
} from "lucide-react";
import type { ModuleProps } from "./moduleProps";
import { patchData } from "./moduleProps";
import { uid } from "./model";
import { ContextInput, SourceLink } from "./SelectionTools";
import { useAI } from "./useAI";
export function SummaryModule(p: ModuleProps) {
  const { mod, update, send, notify } = p;
  const { busy, error, run } = useAI(
    (mod.input || "") + (mod.settings?.summaryStyle || "brief"),
  );
  return (
    <div className="utility-body">
      <ContextInput {...p} />
      <select
        aria-label="摘要方式"
        value={mod.settings?.summaryStyle || "brief"}
        onChange={(e) =>
          update({
            settings: {
              ...mod.settings,
              summaryStyle: e.target.value as "brief" | "detailed" | "bullets",
            },
          })
        }
      >
        <option value="brief">简短摘要</option>
        <option value="detailed">详细摘要</option>
        <option value="bullets">要点提炼</option>
      </select>
      <textarea
        aria-label="待总结内容"
        placeholder="输入文本或接收其他模块的选段…"
        value={mod.input || ""}
        onChange={(e) => update({ input: e.target.value })}
      />
      <button
        className="btn primary"
        disabled={busy || !mod.input?.trim()}
        onClick={() =>
          void run(
            "summary",
            { text: mod.input, style: mod.settings?.summaryStyle || "brief" },
            (output) => update({ output }),
          )
        }
      >
        <Sparkles size={14} />
        {busy ? "总结中…" : "生成摘要"}
      </button>
      {error && <p className="inline-error">{error}</p>}
      {mod.output && (
        <div className="ai-output">
          <MarkdownContent>{mod.output}</MarkdownContent>
          <div className="inner-toolbar">
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(mod.output!)
                  .then(() => notify("已复制"))
                  .catch(() => notify("复制失败"))
              }
            >
              <Copy size={13} />
              复制
            </button>
            <button onClick={() => send("note", mod.output!, mod.source)}>
              存入笔记
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function CardsModule(p: ModuleProps) {
  const { mod, update } = p;
  const cards = mod.data?.cards || [];
  const [front, setFront] = useState(""),
    [back, setBack] = useState(""),
    [editing, setEditing] = useState<string>(),
    [flipped, setFlipped] = useState<string[]>([]);
  const { busy, error, run } = useAI(
    (mod.input || "") + JSON.stringify(mod.data || {}),
  );
  const save = () => {
    if (!front.trim() || !back.trim()) return;
    update(
      patchData(mod, {
        cards: editing
          ? cards.map((c) => (c.id === editing ? { ...c, front, back } : c))
          : [...cards, { id: uid(), front, back, source: mod.source }],
      }),
    );
    setFront("");
    setBack("");
    setEditing(undefined);
  };
  return (
    <div className="utility-body">
      <ContextInput {...p} />
      <details open={!!mod.input}>
        <summary>用选段生成卡片</summary>
        <textarea
          aria-label="卡片学习材料"
          placeholder="输入学习材料…"
          value={mod.input || ""}
          onChange={(e) => update({ input: e.target.value })}
        />
        <button
          className="btn primary"
          disabled={busy || !mod.input?.trim()}
          onClick={() =>
            void run("cards", { text: mod.input }, (result) =>
              update(
                patchData(mod, {
                  cards: [
                    ...cards,
                    ...result.cards.map((c: any) => ({
                      ...c,
                      id: uid(),
                      source: mod.source,
                    })),
                  ],
                }),
              ),
            )
          }
        >
          <Sparkles size={14} />
          {busy ? "生成中…" : "AI 生成卡片"}
        </button>
      </details>
      {error && <p className="inline-error">{error}</p>}
      <div className="card-form">
        <input
          aria-label="卡片正面"
          placeholder="正面 · 一个问题"
          value={front}
          onChange={(e) => setFront(e.target.value)}
        />
        <textarea
          aria-label="卡片背面"
          placeholder="背面 · 答案与解释"
          value={back}
          onChange={(e) => setBack(e.target.value)}
        />
        <button
          className="btn mini"
          disabled={!front.trim() || !back.trim()}
          onClick={save}
        >
          <Plus size={13} />
          {editing ? "保存修改" : "添加卡片"}
        </button>
      </div>
      {cards.map((c) => (
        <article className="knowledge-card" key={c.id}>
          <button
            className="card-flip"
            onClick={() =>
              setFlipped((f) =>
                f.includes(c.id) ? f.filter((x) => x !== c.id) : [...f, c.id],
              )
            }
          >
            <small>{flipped.includes(c.id) ? "答案" : "问题"} · 点击翻转</small>
            <p>{flipped.includes(c.id) ? c.back : c.front}</p>
          </button>
          <div className="inner-toolbar">
            <SourceLink source={c.source} jump={p.jump} />
            <button
              onClick={() => {
                setFront(c.front);
                setBack(c.back);
                setEditing(c.id);
              }}
            >
              编辑
            </button>
            <button
              title="删除卡片"
              onClick={() =>
                update(
                  patchData(mod, { cards: cards.filter((x) => x.id !== c.id) }),
                )
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        </article>
      ))}
      {!cards.length && (
        <p className="empty-hint">将知识变成可复习的问答卡片</p>
      )}
    </div>
  );
}
export function TodoModule({ mod, update }: ModuleProps) {
  const tasks = mod.data?.tasks || [];
  const [text, setText] = useState("");
  const dragged = useRef("");
  return (
    <div className="utility-body">
      <div className="todo-progress">
        已完成 {tasks.filter((t) => t.done).length} / {tasks.length}
        <span
          style={{
            width: `${tasks.length ? (tasks.filter((t) => t.done).length / tasks.length) * 100 : 0}%`,
          }}
        />
      </div>
      <div className="inline-form">
        <input
          aria-label="新任务"
          value={text}
          placeholder="接下来要做什么？"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              update(
                patchData(mod, {
                  tasks: [...tasks, { id: uid(), text, done: false }],
                }),
              );
              setText("");
            }
          }}
        />
        <button
          className="btn mini"
          disabled={!text.trim()}
          onClick={() => {
            update(
              patchData(mod, {
                tasks: [...tasks, { id: uid(), text, done: false }],
              }),
            );
            setText("");
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      {tasks.map((t) => (
        <div
          key={t.id}
          className={`task-row ${t.done ? "done" : ""}`}
          draggable
          onDragStart={(e) => {
            dragged.current = t.id;
            e.dataTransfer.setData("application/learnspace-task", t.id);
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/learnspace-task"))
              e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const moving = tasks.find((t) => t.id === dragged.current);
            if (!moving) return;
            const reordered = tasks.filter((x) => x.id !== moving.id);
            reordered.splice(
              reordered.findIndex((x) => x.id === t.id),
              0,
              moving,
            );
            update(patchData(mod, { tasks: reordered }));
          }}
        >
          <GripVertical size={13} />
          <input
            type="checkbox"
            aria-label={`完成${t.text}`}
            checked={t.done}
            onChange={(e) =>
              update(
                patchData(mod, {
                  tasks: tasks.map((x) =>
                    x.id === t.id ? { ...x, done: e.target.checked } : x,
                  ),
                }),
              )
            }
          />
          <input
            aria-label="编辑任务"
            value={t.text}
            onChange={(e) =>
              update(
                patchData(mod, {
                  tasks: tasks.map((x) =>
                    x.id === t.id ? { ...x, text: e.target.value } : x,
                  ),
                }),
              )
            }
          />
          <div className="task-order">
            <button
              title="上移任务"
              onClick={() => {
                const i = tasks.indexOf(t);
                if (i > 0) {
                  const a = [...tasks];
                  [a[i - 1], a[i]] = [a[i], a[i - 1]];
                  update(patchData(mod, { tasks: a }));
                }
              }}
            >
              ↑
            </button>
            <button
              title="下移任务"
              onClick={() => {
                const i = tasks.indexOf(t);
                if (i < tasks.length - 1) {
                  const a = [...tasks];
                  [a[i + 1], a[i]] = [a[i], a[i + 1]];
                  update(patchData(mod, { tasks: a }));
                }
              }}
            >
              ↓
            </button>
          </div>
          <button
            title="删除任务"
            onClick={() =>
              update(
                patchData(mod, { tasks: tasks.filter((x) => x.id !== t.id) }),
              )
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
export function QuizModule(p: ModuleProps) {
  const { mod, update } = p;
  const { busy, error, run } = useAI(
    (mod.input || "") + JSON.stringify(mod.data || {}),
  );
  const quiz = mod.data?.quiz || [],
    answers = mod.data?.answers || {},
    submitted = mod.data?.submitted;
  return (
    <div className="utility-body">
      <ContextInput {...p} />
      <details open={!quiz.length}>
        <summary>练习材料</summary>
        <textarea
          aria-label="测验材料"
          placeholder="输入学习内容以生成练习…"
          value={mod.input || ""}
          onChange={(e) => update({ input: e.target.value })}
        />
        <button
          className="btn primary"
          disabled={busy || !mod.input?.trim()}
          onClick={() => {
            if (
              quiz.length &&
              !confirm("生成新题目会替换当前练习和答题进度，继续？")
            )
              return;
            void run("quiz", { text: mod.input }, (result) =>
              update(
                patchData(mod, {
                  quiz: result.questions.map((q: any) => ({ ...q, id: uid() })),
                  answers: {},
                  submitted: false,
                }),
              ),
            );
          }}
        >
          <Sparkles size={14} />
          {busy ? "生成中…" : "生成测验"}
        </button>
      </details>
      {error && <p className="inline-error">{error}</p>}
      {quiz.map((q, i) => (
        <div className="quiz-question" key={q.id}>
          <h4>
            {i + 1}. {q.question}
          </h4>
          {q.type === "choice" ? (
            q.options?.map((o, j) => (
              <label key={j} className="quiz-option">
                <input
                  type="radio"
                  disabled={submitted}
                  name={mod.id + q.id}
                  checked={answers[q.id] === o}
                  onChange={() =>
                    update(
                      patchData(mod, { answers: { ...answers, [q.id]: o } }),
                    )
                  }
                />
                {o}
              </label>
            ))
          ) : (
            <textarea
              aria-label={`第${i + 1}题答案`}
              disabled={submitted}
              value={answers[q.id] || ""}
              onChange={(e) =>
                update(
                  patchData(mod, {
                    answers: { ...answers, [q.id]: e.target.value },
                  }),
                )
              }
              placeholder="写下你的理解…"
            />
          )}
          {submitted && (
            <div className="quiz-explanation">
              <b>
                {q.type === "short"
                  ? "参考答案，请自行对照"
                  : answers[q.id] === q.answer
                    ? "回答正确"
                    : "继续加油"}
              </b>
              <p>答案：{q.answer}</p>
              <p>{q.explanation}</p>
            </div>
          )}
        </div>
      ))}
      {!!quiz.length && (
        <button
          className="btn primary full"
          disabled={!submitted && quiz.some((q) => !answers[q.id]?.trim())}
          onClick={() => update(patchData(mod, { submitted: !submitted }))}
        >
          {submitted ? "重新作答" : "提交并查看解析"}
        </button>
      )}
    </div>
  );
}
export function PomodoroModule({ mod, update }: ModuleProps) {
  const focus = mod.settings?.focusMinutes || 25,
    rest = mod.settings?.breakMinutes || 5;
  const timer = mod.data?.timer || {
    mode: "focus" as const,
    remaining: focus * 60,
  };
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const remaining = timer.endsAt
    ? Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
    : timer.remaining;
  const completed = useRef<number>();
  useEffect(() => {
    if (timer.endsAt && remaining === 0 && completed.current !== timer.endsAt) {
      completed.current = timer.endsAt;
      update(
        patchData(mod, {
          timer: {
            mode: timer.mode === "focus" ? "break" : "focus",
            remaining: (timer.mode === "focus" ? rest : focus) * 60,
          },
        }),
      );
    }
  }, [remaining, timer.endsAt]);
  return (
    <div className="pomodoro-module">
      <div className="timer-mode">
        {timer.mode === "focus" ? "保持专注，慢慢来" : "休息一下，让思考沉淀"}
      </div>
      <div className="timer-face">
        <span>
          {String(Math.floor(remaining / 60)).padStart(2, "0")}:
          {String(remaining % 60).padStart(2, "0")}
        </span>
        <small>{timer.mode === "focus" ? "专注时间" : "休息时间"}</small>
      </div>
      <div className="timer-actions">
        <button
          className="btn primary"
          onClick={() =>
            update(
              patchData(mod, {
                timer: {
                  ...timer,
                  remaining,
                  endsAt: timer.endsAt
                    ? undefined
                    : Date.now() + remaining * 1000,
                },
              }),
            )
          }
        >
          {timer.endsAt ? <Pause size={16} /> : <Play size={16} />}{" "}
          {timer.endsAt ? "暂停" : "开始"}
        </button>
        <button
          className="btn"
          title="重置计时"
          onClick={() =>
            update(
              patchData(mod, {
                timer: {
                  mode: timer.mode,
                  remaining: (timer.mode === "focus" ? focus : rest) * 60,
                },
              }),
            )
          }
        >
          <RotateCcw size={15} />
        </button>
        <button
          className="btn"
          onClick={() =>
            update(
              patchData(mod, {
                timer: {
                  mode: timer.mode === "focus" ? "break" : "focus",
                  remaining: (timer.mode === "focus" ? rest : focus) * 60,
                },
              }),
            )
          }
        >
          切换
        </button>
      </div>
      <div className="timer-settings">
        <label>
          专注
          <input
            aria-label="专注分钟数"
            type="number"
            min="1"
            max="120"
            value={focus}
            onChange={(e) => {
              const minutes = Math.max(
                1,
                Math.min(120, Number(e.target.value)),
              );
              update({
                settings: { ...mod.settings, focusMinutes: minutes },
                ...(!timer.endsAt && timer.mode === "focus"
                  ? patchData(mod, {
                      timer: { ...timer, remaining: minutes * 60 },
                    })
                  : {}),
              });
            }}
          />
          分钟
        </label>
        <label>
          休息
          <input
            aria-label="休息分钟数"
            type="number"
            min="1"
            max="60"
            value={rest}
            onChange={(e) =>
              update({
                settings: {
                  ...mod.settings,
                  breakMinutes: Math.max(
                    1,
                    Math.min(60, Number(e.target.value)),
                  ),
                },
              })
            }
          />
          分钟
        </label>
      </div>
    </div>
  );
}
const dateString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function CalendarModule({ mod, update }: ModuleProps) {
  const month = mod.data?.month || dateString(new Date()).slice(0, 7),
    selected = mod.data?.selectedDate || dateString(new Date());
  const [year, mon] = month.split("-").map(Number),
    events = mod.data?.events || [];
  const [title, setTitle] = useState(""),
    [time, setTime] = useState("09:00"),
    [editing, setEditing] = useState<string>();
  const start = new Date(year, mon - 1, 1).getDay(),
    days = new Date(year, mon, 0).getDate();
  const shift = (delta: number) =>
    update(
      patchData(mod, {
        month: dateString(new Date(year, mon - 1 + delta, 1)).slice(0, 7),
      }),
    );
  return (
    <div className="utility-body calendar-module">
      <div className="calendar-month">
        <button title="上个月" onClick={() => shift(-1)}>
          <ChevronLeft size={16} />
        </button>
        <b>
          {year} 年 {mon} 月
        </b>
        <button title="下个月" onClick={() => shift(1)}>
          <ChevronRight size={16} />
        </button>
        <button
          className="text-button"
          onClick={() =>
            update(
              patchData(mod, {
                month: dateString(new Date()).slice(0, 7),
                selectedDate: dateString(new Date()),
              }),
            )
          }
        >
          今天
        </button>
      </div>
      <div className="calendar-grid">
        {"日一二三四五六".split("").map((d) => (
          <span key={d}>{d}</span>
        ))}
        {Array.from({ length: start }, (_, i) => (
          <i key={"empty" + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <button
              key={date}
              className={selected === date ? "selected" : ""}
              onClick={() => update(patchData(mod, { selectedDate: date }))}
            >
              {i + 1}
              {events.some((e) => e.date === date) && <i />}
            </button>
          );
        })}
      </div>
      <h4 className="date-heading">{selected} 的安排</h4>
      {events
        .filter((e) => e.date === selected)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((e) => (
          <div key={e.id} className="event-row">
            <span>{e.time}</span>
            <button
              onClick={() => {
                setEditing(e.id);
                setTitle(e.title);
                setTime(e.time);
              }}
            >
              {e.title}
            </button>
            <button
              title="删除日程"
              onClick={() =>
                update(
                  patchData(mod, {
                    events: events.filter((x) => x.id !== e.id),
                  }),
                )
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      <div className="event-form">
        <input
          aria-label="日程时间"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <input
          aria-label="日程标题"
          placeholder="添加学习安排…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          className="btn mini"
          disabled={!title.trim()}
          onClick={() => {
            update(
              patchData(mod, {
                events: editing
                  ? events.map((e) =>
                      e.id === editing ? { ...e, title, time } : e,
                    )
                  : [...events, { id: uid(), date: selected, title, time }],
              }),
            );
            setTitle("");
            setEditing(undefined);
          }}
        >
          {editing ? <Check size={14} /> : <Plus size={14} />}
        </button>
      </div>
    </div>
  );
}
export function MindmapModule(p: ModuleProps) {
  const { mod, update } = p;
  const nodes = mod.data?.nodes || [];
  const [selected, setSelected] = useState<string>();
  const { busy, error, run } = useAI(
    (mod.input || "") + JSON.stringify(mod.data || {}),
  );
  const scale = mod.data?.mapScale || 1,
    pan = mod.data?.mapPan || { x: 0, y: 0 };
  const host = useRef<HTMLDivElement>(null);
  const node = nodes.find((n) => n.id === selected);
  const move = (e: React.PointerEvent, id?: string) => {
    if ((e.target as HTMLElement).closest("button,input")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const el = e.currentTarget as HTMLElement;
    const x = e.clientX,
      y = e.clientY;
    let dx = 0,
      dy = 0;
    const n = nodes.find((n) => n.id === id);
    const motion = (event: PointerEvent) => {
      dx = (event.clientX - x) / scale;
      dy = (event.clientY - y) / scale;
      if (n) {
        (el as HTMLElement).style.left = `${n.x + dx}px`;
        (el as HTMLElement).style.top = `${n.y + dy}px`;
      } else if (host.current)
        host.current.style.transform = `translate(${pan.x + dx * scale}px,${pan.y + dy * scale}px) scale(${scale})`;
    };
    const end = () => {
      el.removeEventListener("pointermove", motion);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      if (n)
        update(
          patchData(mod, {
            nodes: nodes.map((z) =>
              z.id === id
                ? { ...z, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) }
                : z,
            ),
          }),
        );
      else
        update(
          patchData(mod, {
            mapPan: { x: pan.x + dx * scale, y: pan.y + dy * scale },
          }),
        );
    };
    el.addEventListener("pointermove", motion);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  return (
    <div className="mindmap-module">
      <div className="map-controls">
        <button
          className="btn mini"
          onClick={() => {
            const id = uid();
            update(
              patchData(mod, {
                nodes: [
                  ...nodes,
                  {
                    id,
                    parentId: node?.id,
                    text: "新节点",
                    x: node ? node.x + 190 : 50,
                    y: node ? node.y + 70 : nodes.length * 80 + 50,
                  },
                ],
              }),
            );
            setSelected(id);
          }}
        >
          <Plus size={12} />
          {node ? "添加子节点" : "添加节点"}
        </button>
        <button
          className="btn mini"
          disabled={!node}
          onClick={() => {
            const ids = new Set([selected]);
            let changed = true;
            while (changed) {
              changed = false;
              nodes.forEach((n) => {
                if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
                  ids.add(n.id);
                  changed = true;
                }
              });
            }
            update(
              patchData(mod, { nodes: nodes.filter((n) => !ids.has(n.id)) }),
            );
            setSelected(undefined);
          }}
        >
          <Trash2 size={12} />
        </button>
        <input
          aria-label="思维导图缩放"
          type="range"
          min="30"
          max="180"
          value={Math.round(scale * 100)}
          onChange={(e) =>
            update(patchData(mod, { mapScale: Number(e.target.value) / 100 }))
          }
        />
        <button
          title="恢复视图"
          onClick={() =>
            update(patchData(mod, { mapPan: { x: 0, y: 0 }, mapScale: 1 }))
          }
        >
          <RotateCcw size={13} />
        </button>
      </div>
      {node && (
        <input
          className="map-label-input"
          aria-label="节点文字"
          value={node.text}
          onChange={(e) =>
            update(
              patchData(mod, {
                nodes: nodes.map((n) =>
                  n.id === node.id ? { ...n, text: e.target.value } : n,
                ),
              }),
            )
          }
        />
      )}
      <div className="map-stage" onPointerDown={(e) => move(e)}>
        <div
          className="map-world"
          ref={host}
          style={{
            transform: `translate(${pan.x}px,${pan.y}px) scale(${scale})`,
          }}
        >
          <svg width="2000" height="1500">
            {nodes
              .filter((n) => n.parentId)
              .map((n) => {
                const parent = nodes.find((p) => p.id === n.parentId);
                return parent ? (
                  <path
                    key={n.id}
                    d={`M ${parent.x + 145} ${parent.y + 22} C ${parent.x + 175} ${parent.y + 22}, ${n.x - 30} ${n.y + 22}, ${n.x} ${n.y + 22}`}
                  />
                ) : null;
              })}
          </svg>
          {nodes.map((n) => (
            <div
              key={n.id}
              className={`map-node ${selected === n.id ? "selected" : ""}`}
              style={{ left: n.x, top: n.y }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelected(n.id);
                move(e, n.id);
              }}
              onDoubleClick={() => {
                const text = prompt("节点文字", n.text);
                if (text)
                  update(
                    patchData(mod, {
                      nodes: nodes.map((x) =>
                        x.id === n.id ? { ...x, text } : x,
                      ),
                    }),
                  );
              }}
            >
              {n.text}
            </div>
          ))}
        </div>
        {!nodes.length && (
          <div className="map-empty">添加节点，或让 AI 从材料生成导图</div>
        )}
      </div>
      <details>
        <summary>AI 生成思维导图</summary>
        <ContextInput {...p} />
        <textarea
          aria-label="导图材料"
          placeholder="输入材料…"
          value={mod.input || ""}
          onChange={(e) => update({ input: e.target.value })}
        />
        <button
          className="btn primary"
          disabled={busy || !mod.input?.trim()}
          onClick={() => {
            if (nodes.length && !confirm("AI 生成会替换当前节点，继续？"))
              return;
            void run("mindmap", { text: mod.input }, (result) =>
              update(
                patchData(mod, {
                  nodes: result.nodes,
                  mapPan: { x: 0, y: 0 },
                  mapScale: 1,
                }),
              ),
            );
          }}
        >
          <Sparkles size={14} />
          {busy ? "生成中…" : "生成导图"}
        </button>
        {error && <p className="inline-error">{error}</p>}
      </details>
    </div>
  );
}
