import { quizPreview } from "./quizPreview";
import { MathText } from "./MathText";
import { ActionMenu } from "./ActionMenu";
import { SourceReferences } from "./SourceReferences";
import { LearningInput, isDirectInput } from "./LearningInput";
import { DocumentStatus } from "./DocumentStatus";
import { useQuickRun } from "./useQuickRun";
import { QuizFeedback } from "./QuizFeedback";
import { useMaterialAI } from "./useMaterialAI";
import { MarkdownContent } from "./MarkdownContent";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Layers,
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
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ModuleProps } from "./moduleProps";
import { patchData } from "./moduleProps";
import { quizAttempt } from "./taskIntelligence";
import { uid } from "./model";
import { ContextInput } from "./SelectionTools";
import { useAI } from "./useAI";
export function SummaryModule(p: ModuleProps) {
  const { mod, update, send, notify } = p;
  const { busy, error, run, connected, progress, cancel } = useMaterialAI(
    p,
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
      <LearningInput p={p} label="待总结内容" />
      <button
        className="btn primary"
        disabled={busy || (!mod.input?.trim() && !connected)}
        onClick={() =>
          void run(
            "summary",
            { text: mod.input, style: mod.settings?.summaryStyle || "brief" },
            (output) => ({ output }),
          )
        }
      >
        <Sparkles size={14} />
        {busy ? "总结中…" : "生成摘要"}
      </button>
      <DocumentStatus
        mod={mod}
        busy={busy}
        progress={progress}
        cancel={cancel}
      />
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
            <button onClick={() => send("note", mod.output!, mod.source, "ai")}>
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
    [editor, setEditor] = useState(false),
    [collection, setCollection] = useState(false),
    [index, setIndex] = useState(0),
    [flipped, setFlipped] = useState(false),
    [setup, setSetup] = useState(false);
  const { busy, error, run, connected, progress, cancel } = useMaterialAI(
    p,
    (mod.input || "") + JSON.stringify(mod.data || {}),
  );
  useEffect(() => {
    setFront("");
    setBack("");
    setEditing(undefined);
    setEditor(false);
    setCollection(false);
    setIndex(0);
    setFlipped(false);
    setSetup(false);
  }, [p.taskId, p.workspaceId, mod.id]);
  const activeIndex = Math.min(index, Math.max(0, cards.length - 1));
  useEffect(
    () =>
      p.bus.on("material.edit", ({ moduleId }) => {
        if (moduleId === mod.id) setSetup(true);
      }),
    [p.bus, mod.id],
  );
  const card = cards[activeIndex];
  const move = (next: number) => {
    setIndex(Math.max(0, Math.min(cards.length - 1, next)));
    setFlipped(false);
  };
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
    setEditor(false);
  };
  const edit = (id?: string) => {
    if (
      editor &&
      (front.trim() || back.trim()) &&
      !confirm("放弃尚未保存的卡片编辑？")
    )
      return;
    const selected = cards.find((c) => c.id === id);
    setFront(selected?.front || "");
    setBack(selected?.back || "");
    setEditing(id);
    setEditor(true);
  };
  const remove = (id: string) => {
    if (confirm("删除这张卡片？"))
      update(patchData(mod, { cards: cards.filter((c) => c.id !== id) }));
  };
  const generate = () => {
    void run("cards", { text: mod.input }, (result, material) =>
      patchData(material, {
        cards: [
          ...cards,
          ...result.cards.map((c: any) => ({
            ...c,
            id: uid(),
            source: material.source,
          })),
        ],
      }),
    );
  };
  useQuickRun(p, busy, generate);
  return (
    <div className="utility-body cards-module">
      <div className="learning-section-toolbar">
        <div className="segmented-control" aria-label="卡片查看方式">
          <button
            aria-pressed={!collection}
            onClick={() => setCollection(false)}
          >
            复习
          </button>
          <button aria-pressed={collection} onClick={() => setCollection(true)}>
            卡片集{cards.length ? ` · ${cards.length}` : ""}
          </button>
        </div>
        <ActionMenu label="卡片操作">
          <button onClick={() => edit()}>
            <Plus size={14} />
            手动添加卡片
          </button>
          <button onClick={() => setSetup((v) => !v)}>从材料制作卡片</button>
        </ActionMenu>
      </div>
      {(!cards.length || setup) && (
        <div className="learning-setup">
          <LearningInput p={p} label="卡片学习内容" />
          <button
            className="btn primary"
            disabled={
              busy || (isDirectInput(p) ? !mod.input?.trim() : !connected)
            }
            onClick={generate}
          >
            <Sparkles size={14} />
            {busy ? "制作中…" : cards.length ? "继续制作卡片" : "制作卡片"}
          </button>
          {!cards.length && !editor && (
            <button className="text-button" onClick={() => edit()}>
              手动添加
            </button>
          )}
        </div>
      )}
      <DocumentStatus
        mod={mod}
        busy={busy}
        progress={progress}
        cancel={cancel}
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {editor && (
        <div className="card-form">
          <h4>{editing ? "编辑卡片" : "添加卡片"}</h4>
          <input
            aria-label="卡片正面"
            placeholder="问题或概念"
            value={front}
            onChange={(e) => setFront(e.target.value)}
          />
          <textarea
            aria-label="卡片背面"
            placeholder="答案与解释"
            value={back}
            onChange={(e) => setBack(e.target.value)}
          />
          <div className="inner-toolbar">
            <button
              className="btn primary mini"
              disabled={!front.trim() || !back.trim()}
              onClick={save}
            >
              保存卡片
            </button>
            <button
              onClick={() => {
                if (
                  (!front.trim() && !back.trim()) ||
                  confirm("放弃尚未保存的卡片编辑？")
                )
                  setEditor(false);
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {card && !collection ? (
        <div
          className="card-study"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              move(activeIndex - 1);
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              move(activeIndex + 1);
            }
          }}
        >
          <button
            className={`study-card ${flipped ? "flipped" : ""}`}
            aria-label={flipped ? "查看卡片问题" : "查看卡片答案"}
            aria-pressed={flipped}
            onClick={() => setFlipped((v) => !v)}
          >
            <span>{flipped ? "答案" : "问题"}</span>
            <div>{flipped ? card.back : card.front}</div>
            <small>{flipped ? "点击返回问题" : "想好答案后，点击翻面"}</small>
          </button>
          <div className="card-study-navigation">
            <button
              aria-label="上一张卡片"
              disabled={!activeIndex}
              onClick={() => move(activeIndex - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span aria-live="polite">
              {activeIndex + 1} / {cards.length}
            </span>
            <button
              aria-label="下一张卡片"
              disabled={activeIndex === cards.length - 1}
              onClick={() => move(activeIndex + 1)}
            >
              <ChevronRight size={17} />
            </button>
            <ActionMenu label="当前卡片操作">
              <button onClick={() => edit(card.id)}>编辑卡片</button>
              <button onClick={() => remove(card.id)}>删除卡片</button>
            </ActionMenu>
          </div>
          <SourceReferences
            sources={card.source ? [card.source] : []}
            jump={p.jump}
          />
        </div>
      ) : collection && cards.length ? (
        <div className="card-collection">
          {cards.map((c, i) => (
            <article key={c.id}>
              <button
                className="card-collection-open"
                onClick={() => {
                  move(i);
                  setCollection(false);
                }}
              >
                <span>{i + 1}</span>
                <strong>{c.front}</strong>
                <small>{c.back.slice(0, 160)}</small>
              </button>
              <ActionMenu label={`卡片 ${i + 1} 操作`}>
                <button onClick={() => edit(c.id)}>编辑</button>
                <button onClick={() => remove(c.id)}>删除</button>
              </ActionMenu>
            </article>
          ))}
        </div>
      ) : null}
      {!cards.length && !editor && (
        <div className="learning-empty">
          <Layers size={28} />
          <h3>把知识变成记忆</h3>
          <p>选择一段材料制作卡片，或手动记下一组问答。</p>
        </div>
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
  const { busy, partial, clearPartial, error, run, connected, progress, cancel } = useMaterialAI(
    p,
    (mod.input || "") + JSON.stringify(mod.data || {}),
  );
  const previewQuestions = useMemo(() => quizPreview(partial), [partial]);
  const showingPreview = previewQuestions.length > 0;
  const [setup, setSetup] = useState(false),
    [onlyWrong, setOnlyWrong] = useState(false);
  useEffect(() => {
    setSetup(false);
    setOnlyWrong(false);
  }, [p.taskId, p.workspaceId, mod.id]);
  const quiz = mod.data?.quiz || [],
    answers = mod.data?.answers || {},
    submitted = mod.data?.submitted;
  useEffect(
    () =>
      p.bus.on("material.edit", ({ moduleId }) => {
        if (moduleId === mod.id) setSetup(true);
      }),
    [p.bus, mod.id],
  );
  const makeCards = (questions: typeof quiz) => {
    const text = questions
      .map(
        (q) =>
          `问题：${q.question}\n正确答案：${q.answer}\n解析：${q.explanation}`,
      )
      .join("\n\n");
    if (text.length > 23000) {
      p.notify("错题内容较多，请使用每道错题下的制作卡片按钮分批整理。");
      return;
    }
    p.send(
      "cards",
      text,
      mod.source ? { ...mod.source, contentKind: "ai" } : undefined,
      "ai",
    );
  };
  const generate = () => {
    if (quiz.length && !confirm("生成新题目会替换当前练习和答题进度，继续？"))
      return;
    void run("quiz", { text: mod.input }, (result, material) => {
      setSetup(false);
      setOnlyWrong(false);
      return patchData(material, {
        quiz: result.questions.map((q: any) => ({ ...q, id: uid() })),
        answers: {},
        submitted: false,
      });
    });
  };
  useQuickRun(p, busy, generate);
  return (
    <div className="utility-body quiz-module">
      {!!quiz.length && !showingPreview && (
        <div className="learning-section-toolbar">
          <span>
            {submitted
              ? `答对 ${quiz.filter((q) => q.type === "choice" && answers[q.id] === q.answer).length} / ${quiz.filter((q) => q.type === "choice").length} 道选择题`
              : `已作答 ${quiz.filter((q) => answers[q.id]?.trim()).length} / ${quiz.length}`}
          </span>
          <button className="text-button" disabled={busy} onClick={() => setSetup((v) => !v)}>
            {setup ? "返回答题" : "重新出题"}
          </button>
        </div>
      )}
      {(!quiz.length || setup) && (
        <div className="learning-setup">
          <LearningInput p={p} label="测验学习内容" />
          {!quiz.length && (
            <p className="setup-caption">
              根据所选内容生成单选题，完成后查看解析。
            </p>
          )}
          <button
            className="btn primary"
            disabled={
              busy || (isDirectInput(p) ? !mod.input?.trim() : !connected)
            }
            onClick={generate}
          >
            <Sparkles size={14} />
            {busy ? "出题中…" : quiz.length ? "生成新测验" : "生成测验"}
          </button>
        </div>
      )}
      <DocumentStatus
        mod={mod}
        busy={busy}
        progress={progress}
        cancel={cancel}
      />
      {error && <p className="inline-error" role="alert">{error}</p>}
      {showingPreview && (
        <section className="quiz-stream-preview" aria-label="测验生成预览" aria-busy={busy}>
          <p className="small" role="status">
            {busy ? `正在出题，已生成 ${previewQuestions.length} 道，完成后即可作答。` : "生成已中断，以下题目尚未组成完整测验，原练习与作答仍保留。"}
          </p>
          {previewQuestions.map((q, i) => (
            <div className="quiz-question" key={i}>
              <h4>{i + 1}. <MathText>{q.question}</MathText></h4>
              {q.options.map((option, j) => (
                <label className="quiz-option" key={j}>
                  <input type="radio" disabled name={`${mod.id}-preview-${i}`} />
                  <MathText>{option}</MathText>
                </label>
              ))}
            </div>
          ))}
          {!busy && <div className="quiz-review-actions">
            <button className="text-button" onClick={generate}>重新生成</button>
            <button className="text-button" onClick={clearPartial}>{quiz.length ? "返回原测验" : "收起预览"}</button>
          </div>}
        </section>
      )}
      {!showingPreview && <>
      {submitted && (
        <div className="quiz-review-actions">
          <button
            className="text-button"
            aria-pressed={onlyWrong}
            onClick={() => setOnlyWrong((v) => !v)}
          >
            {onlyWrong ? "查看全部题目" : "只看错题"}
          </button>
          <button
            className="text-button"
            disabled={
              !quiz.some(
                (q) => q.type === "choice" && answers[q.id] !== q.answer,
              )
            }
            onClick={() =>
              makeCards(
                quiz.filter(
                  (q) => q.type === "choice" && answers[q.id] !== q.answer,
                ),
              )
            }
          >
            <Layers size={13} />
            错题制作卡片
          </button>
        </div>
      )}
      {quiz.map((q, i) =>
        !onlyWrong ||
        !submitted ||
        q.type !== "choice" ||
        answers[q.id] !== q.answer ? (
          <div className="quiz-question" key={q.id}>
            <h4>
              {i + 1}. <MathText>{q.question}</MathText>
            </h4>
            {q.type === "choice" ? (
              q.options?.map((o, j) => (
                <label key={j} className="quiz-option">
                  <input
                    type="radio"
                    disabled={submitted || busy}
                    name={mod.id + q.id}
                    checked={answers[q.id] === o}
                    onChange={() =>
                      update(
                        patchData(mod, { answers: { ...answers, [q.id]: o } }),
                      )
                    }
                  />
                  <MathText>{o}</MathText>
                </label>
              ))
            ) : (
              <textarea
                aria-label={`第${i + 1}题答案`}
                disabled={submitted || busy}
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
            <QuizFeedback
              type={q.type}
              answer={q.answer}
              userAnswer={answers[q.id]}
              explanation={q.explanation}
              submitted={!!submitted}
            />
            {submitted && q.type === "choice" && answers[q.id] !== q.answer && (
              <button className="text-button" onClick={() => makeCards([q])}>
                <Layers size={13} />
                将这道错题制作成卡片
              </button>
            )}
          </div>
        ) : null,
      )}
      {onlyWrong &&
        submitted &&
        quiz.every(
          (q) => q.type === "choice" && answers[q.id] === q.answer,
        ) && <p className="empty-hint">本次全部答对，没有错题。</p>}
      {!!quiz.length && (
        <button
          className="btn primary full"
          disabled={busy || (!submitted && quiz.some((q) => !answers[q.id]?.trim()))}
          onClick={() =>
            update(
              patchData(mod, {
                submitted: !submitted,
                ...(!submitted
                  ? {
                      quizAttempts: [
                        ...(mod.data?.quizAttempts || []).slice(-19),
                        quizAttempt(mod),
                      ],
                    }
                  : {}),
              }),
            )
          }
        >
          {submitted ? "重新作答" : "提交并查看解析"}
        </button>
      )}
      </>}
      <SourceReferences
        sources={
          mod.data?.flow?.inputs.flatMap((p) => p.sources) ||
          (mod.source ? [mod.source] : [])
        }
        jump={p.jump}
      />
      {!!mod.data?.quizAttempts?.length && (
        <details className="quiz-history">
          <summary>练习记录 · {mod.data.quizAttempts.length}</summary>
          {[...mod.data.quizAttempts].reverse().map((attempt) => (
            <p key={attempt.id}>
              {new Date(attempt.createdAt).toLocaleString()} · 答对{" "}
              {attempt.questions.filter((q) => q.correct === true).length} /{" "}
              {attempt.questions.filter((q) => q.type === "choice").length}{" "}
              道选择题
            </p>
          ))}
        </details>
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
    setNow(Date.now());
    if (!timer.endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [timer.endsAt]);
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
      {mod.data?.text && (
        <p className="focus-topic">本次专注：{mod.data.text}</p>
      )}
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
  const [selected, setSelected] = useState<string>(),
    [editMaterial, setEditMaterial] = useState(false);
  useEffect(() => {
    setSelected(undefined);
    setEditMaterial(false);
  }, [p.taskId, p.workspaceId, mod.id]);
  const { busy, error, run, connected, progress, cancel } = useMaterialAI(
    p,
    (mod.input || "") + JSON.stringify(mod.data || {}),
  );
  const scale = mod.data?.mapScale || 1,
    pan = mod.data?.mapPan || { x: 0, y: 0 };
  useEffect(
    () =>
      p.bus.on("material.edit", ({ moduleId }) => {
        if (moduleId === mod.id) setEditMaterial(true);
      }),
    [p.bus, mod.id],
  );
  const host = useRef<HTMLDivElement>(null);
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
  const zoomMap = (delta: number) => {
    const next = Math.min(1.8, Math.max(0.3, Math.round((scale + delta) * 10) / 10));
    const stage = host.current?.parentElement;
    const x = (stage?.clientWidth || 0) / 2, y = (stage?.clientHeight || 0) / 2;
    update(patchData(mod, {
      mapScale: next,
      mapPan: { x: x - (x - pan.x) * next / scale, y: y - (y - pan.y) * next / scale },
    }));
  };
  const generate = () => {
    if (nodes.length && !confirm("AI 生成会替换当前节点，继续？")) return;
    void run("mindmap", { text: mod.input }, (result, material) => {
      setEditMaterial(false);
      return patchData(material, {
        nodes: result.nodes,
        mapPan: { x: 0, y: 0 },
        mapScale: 1,
      });
    });
  };
  useQuickRun(p, busy, generate);
  return (
    <div className="mindmap-module">
      {(editMaterial || !nodes.length) && (
        <LearningInput p={p} label="导图学习内容" />
      )}
      <div className="map-stage" onPointerDown={(e) => move(e)}>
        <div className="map-toolbar" role="group" aria-label="思维导图操作">
          <button className="btn mini" disabled={busy || (isDirectInput(p) ? !mod.input?.trim() : !connected)} onClick={generate}>
            <Sparkles size={14} />
            {busy ? "生成中…" : nodes.length ? "重新生成" : "生成导图"}
          </button>
          <button className="btn mini" title="缩小" aria-label="缩小思维导图" disabled={scale <= 0.3} onClick={() => zoomMap(-0.1)}>
            <ZoomOut size={16} />
          </button>
          <button className="btn mini" title="放大" aria-label="放大思维导图" disabled={scale >= 1.8} onClick={() => zoomMap(0.1)}>
            <ZoomIn size={16} />
          </button>
        </div>
        {(busy || error) && <div className="map-feedback" onPointerDown={(e) => e.stopPropagation()}>
          {busy && <DocumentStatus mod={mod} busy progress={progress} cancel={cancel} />}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </div>}
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
          <div className="map-empty">选择学习材料，点击生成导图</div>
        )}
      </div>
    </div>
  );
}
