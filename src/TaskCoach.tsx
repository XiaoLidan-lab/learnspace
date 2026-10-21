import { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace, Note, Resource, Source } from "./model";
import { uid } from "./model";
import { activateTask, type LearningTask } from "./tasks";
import {
  assistantHistory,
  buildTaskContext,
  contextKey,
  planKey,
  applyAdjustment,
  mastery,
  nextOperation,
} from "./taskIntelligence";
import {
  coachRequestSchema,
  validateCoachResult,
  type CoachResult,
  type Evidence,
} from "./taskAssistantSchemas";
import { taskResources } from "./taskResources";
import { useAI } from "./useAI";
import { coachText } from "./coachText";
import { MarkdownContent } from "./MarkdownContent";

export function TaskCoach({
  workspace: w,
  task,
  notes,
  resources,
  change,
  focus,
  jump,
  notify,
}: {
  workspace: Workspace;
  task: LearningTask;
  notes: Note[];
  resources: Resource[];
  change: (transform: (w: Workspace) => Workspace) => void;
  focus: (id: string, noteId?: string) => void;
  jump: (source: Source) => void;
  notify: (message: string) => void;
}) {
  const [question, setQuestion] = useState(""),
    [feedbackText, setFeedbackText] = useState("");
  const [level, setLevel] = useState<"stuck" | "unsure" | "confident">(
    "unsure",
  );
  const [preparing, setPreparing] = useState(false),
    [resourceProgress, setResourceProgress] = useState(""),
    [retrievalInfo, setRetrievalInfo] = useState<string[]>([]),
    [localError, setLocalError] = useState("");
  const [proposal, setProposal] = useState<{
    result: CoachResult;
    key: string;
    plan: string;
  }>();
  const [pending, setPending] = useState<Evidence | { moduleId: string }>();
  const selected = useMemo(
    () => w.tasks?.find((t) => t.id === task.id),
    [w, task.id],
  )!;
  const bindings = Object.entries(selected.moduleStates || {}).flatMap(
    ([id, s]) =>
      s.resourceId
        ? [
            `绑定资料 ${id}：${resources.find((r) => r.id === s.resourceId)?.version || "本机文件缺失"}；当前页 ${s.page || 1}`,
          ]
        : [],
  );
  const context = buildTaskContext(w, task.id, notes, [], bindings);
  const key = contextKey(context),
    currentKey = useRef(key);
  currentKey.current = key;
  const { busy, error, run, cancel } = useAI(key);
  const extracting = useRef<AbortController>(),
    alive = useRef(true),
    autoStarted = useRef(false);
  const loading = preparing || busy;
  const assessment = mastery(w, task.id);
  const latest = task.assistantLog?.at(-1);
  const next =
    latest?.contextKey === key && latest.result.next.moduleId
      ? latest.result.next
      : nextOperation(w, task);
  const updateTask = (transform: (t: LearningTask) => LearningTask) =>
    change((ws) => ({
      ...ws,
      tasks: ws.tasks?.map((t) => (t.id === task.id ? transform(t) : t)),
    }));
  useEffect(() => {
    extracting.current?.abort();
    setPreparing(false);
    setProposal(undefined);
  }, [key]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      extracting.current?.abort();
    };
  }, []);
  const executeNavigation = (target: Evidence | { moduleId: string }) => {
    if (!target.moduleId || !w.modules.some((m) => m.id === target.moduleId)) {
      notify("原模块已移除，仍可查看引用快照");
      return;
    }
    if (
      "noteId" in target &&
      target.noteId &&
      !notes.some(
        (n) =>
          n.id === target.noteId &&
          n.taskId === task.id &&
          n.workspaceId === w.id,
      )
    ) {
      notify("原笔记已移除，引用快照仍保留");
      return;
    }
    if ("locator" in target && target.locator) {
      jump({
        ...target.locator,
        kind: "pdf",
        moduleId: target.moduleId,
        text: target.text,
      });
      return;
    }
    focus(target.moduleId, "noteId" in target ? target.noteId : undefined);
  };
  useEffect(() => {
    if (pending && w.activeTaskId === task.id) {
      executeNavigation(pending);
      setPending(undefined);
    }
  }, [w.activeTaskId, pending]);
  function navigate(target: Evidence | { moduleId: string }) {
    if (
      "locator" in target &&
      target.locator &&
      !resources.some(
        (r) =>
          r.id === target.locator!.resourceId &&
          r.version === target.locator!.version,
      )
    ) {
      notify("原 PDF 文件缺失或版本已变化；引用快照仍保留，请重新绑定原文件。");
      return;
    }
    if (w.activeTaskId === task.id) executeNavigation(target);
    else {
      if (
        task.status === "completed" &&
        !confirm("重新打开此任务以定位模块？历史成果仍保留。")
      )
        return;
      setPending(target);
      change((ws) => activateTask(ws, task.id));
    }
  }
  async function request(mode: "ask" | "adjust" | "summary") {
    const prompt =
      mode === "summary"
        ? "整理本次学习过程、知识、成果、薄弱环节和复习建议"
        : question.trim() || "请根据当前困难和证据提出具体计划调整建议";
    if (mode === "ask" && !question.trim()) return;
    if (mode === "adjust" && w.activeTaskId !== task.id) {
      setLocalError("请先继续此任务再调整计划");
      return;
    }
    extracting.current?.abort();
    const abort = new AbortController();
    extracting.current = abort;
    const startKey = key,
      originalPlan = planKey(task);
    setPreparing(true);
    setLocalError("");
    setResourceProgress("");
    setRetrievalInfo([]);
    setProposal(undefined);
    try {
      const extracted = await taskResources(
        w,
        task.id,
        resources,
        abort.signal,
        undefined,
        mode === "ask"
          ? prompt
          : [task.goal, prompt, task.feedback?.at(-1)?.text || ""].join(" "),
        (message) => {
          if (alive.current && !abort.signal.aborted)
            setResourceProgress(message);
        },
      );
      if (
        !alive.current ||
        abort.signal.aborted ||
        currentKey.current !== startKey
      )
        return;
      setRetrievalInfo(extracted.coverage);
      const ctx = buildTaskContext(w, task.id, notes, extracted.evidence, [
        ...bindings,
        ...extracted.coverage,
      ]);
      const history = assistantHistory(task, mode, startKey);
      const parsed = coachRequestSchema.safeParse({
        mode,
        question: prompt,
        context: ctx,
        history,
      });
      if (!parsed.success)
        throw Error("任务上下文过大或格式无效，请精简计划、材料或问题后重试");
      const payload = parsed.data;
      setPreparing(false);
      await run("taskAssist", payload, (value) => {
        const result = validateCoachResult(value, payload);
        const entry = {
          id: uid(),
          question: prompt,
          result,
          evidence: ctx.evidence,
          coverage: ctx.coverage,
          contextKey: startKey,
          createdAt: Date.now(),
        };
        updateTask((t) =>
          mode === "summary"
            ? {
                ...t,
                summaryPending: false,
                learningSummary: {
                  result,
                  evidence: ctx.evidence,
                  coverage: ctx.coverage,
                  contextKey: startKey,
                  createdAt: Date.now(),
                },
              }
            : {
                ...t,
                assistantLog: [...(t.assistantLog || []).slice(-11), entry],
              },
        );
        if (mode === "adjust")
          setProposal({ result, key: startKey, plan: originalPlan });
      });
    } catch (e) {
      if (
        alive.current &&
        !abort.signal.aborted &&
        currentKey.current === startKey
      ) {
        setLocalError(e instanceof Error ? e.message : "读取任务上下文失败");
        if (mode === "summary")
          updateTask((t) => ({ ...t, summaryPending: false }));
      }
    } finally {
      if (alive.current && extracting.current === abort) setPreparing(false);
    }
  }
  // Only explicit new completions opt in. Never auto-send legacy tasks just by opening them.
  useEffect(() => {
    if (task.status !== "completed") autoStarted.current = false;
    if (
      task.status === "completed" &&
      task.summaryPending &&
      !autoStarted.current
    ) {
      autoStarted.current = true;
      void request("summary");
    }
  }, [task.status, task.summaryPending]);
  useEffect(() => {
    if (error && task.summaryPending)
      updateTask((t) => ({ ...t, summaryPending: false }));
  }, [error]);
  const citations = (result: CoachResult, evidence: Evidence[]) => (
    <div className="coach-citations">
      {result.citations.map((id) => {
        const e = evidence.find((e) => e.id === id);
        return (
          e && (
            <details key={id}>
              <summary>
                [{id}] {e.label} ·{" "}
                {
                  {
                    original: "原始资料",
                    user: "用户内容",
                    ai: "AI 内容",
                    mixed: "混合内容",
                    unknown: "来源未分类",
                  }[e.kind]
                }
              </summary>
              <p className="coach-excerpt">{e.text}</p>
              {e.moduleId ? (
                <button className="btn mini" onClick={() => navigate(e)}>
                  定位来源模块
                </button>
              ) : (
                <p className="small">此条为任务记录，可在任务面板查看。</p>
              )}
            </details>
          )
        );
      })}
      {!result.citations.length && (
        <p className="small">此回答没有可定位引用，请核验其依据。</p>
      )}
    </div>
  );
  return (
    <section className="task-coach" aria-label="任务学习助手">
      <h3>学习助手</h3>
      <p className="small">当前上下文：{task.title}</p>
      <div className="coach-next">
        <b>建议下一步：{next.label}</b>
        <p>{coachText(next.reason, w)}</p>
        {next.moduleId && (
          <button
            className="btn mini"
            onClick={() => navigate({ moduleId: next.moduleId! })}
          >
            前往对应模块
          </button>
        )}
      </div>
      <details className="coach-mastery" open>
        <summary>知识掌握：{assessment.label}</summary>
        <ul>
          {assessment.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {!!assessment.items.length && (
          <details>
            <summary>逐题掌握证据（最近提交）</summary>
            <ul>
              {assessment.items.slice(0, 50).map((item, i) => (
                <li key={i}>
                  {item.question} · {item.status}
                  <button
                    className="text-button"
                    onClick={() => navigate({ moduleId: item.moduleId })}
                  >
                    查看测验
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        <label className="form-label">
          我的理解情况
          <select
            aria-label="理解情况自评"
            value={level}
            onChange={(e) => setLevel(e.target.value as typeof level)}
          >
            <option value="unsure">还不确定</option>
            <option value="stuck">遇到困难</option>
            <option value="confident">有信心</option>
          </select>
        </label>
        <label className="form-label">
          困难或学习反馈
          <textarea
            aria-label="学习反馈"
            maxLength={300}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="例如：能记住公式，但不会解释原因"
          />
        </label>
        <button
          className="btn mini"
          disabled={loading}
          onClick={() => {
            updateTask((t) => ({
              ...t,
              feedback: [
                ...(t.feedback || []).slice(-19),
                {
                  id: uid(),
                  level,
                  text: feedbackText.trim(),
                  stepId: task.steps.find((s) => !s.done)?.id,
                  createdAt: Date.now(),
                },
              ],
            }));
            setFeedbackText("");
            notify("自评已保存，未改变步骤完成状态");
          }}
        >
          保存自评
        </button>
        {task.feedback?.at(-1)?.text && (
          <p className="small">最近反馈：{task.feedback.at(-1)!.text}</p>
        )}
      </details>
      <p className="small">
        AI 仅使用此任务的资料和成果。绑定阅读文件
        在本机逐页建立全文索引，按问题检索最多六个相关片段；不支持扫描页
        OCR。相关文本会发送给已配置的模型。
      </p>
      <label className="form-label">
        向当前任务提问或说明调整需求
        <textarea
          aria-label="任务助手问题"
          maxLength={1000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="我在哪些地方还不理解？下一步该怎么练习？"
        />
      </label>
      <div className="task-inline">
        <button
          className="btn mini primary"
          disabled={loading || !question.trim()}
          onClick={() => void request("ask")}
        >
          询问助手
        </button>
        <button
          className="btn mini"
          disabled={loading || w.activeTaskId !== task.id}
          onClick={() => void request("adjust")}
        >
          建议调整计划
        </button>
        {loading && (
          <button
            className="btn mini"
            onClick={() => {
              extracting.current?.abort();
              cancel();
              setPreparing(false);
              if (task.summaryPending)
                updateTask((t) => ({ ...t, summaryPending: false }));
            }}
          >
            取消请求
          </button>
        )}
      </div>
      {loading && (
        <p role="status">
          {preparing
            ? resourceProgress || "正在检索此任务的资料…"
            : "AI 正在分析此任务…"}
        </p>
      )}
      {!!retrievalInfo.length && (
        <details>
          <summary>本次资料检索情况</summary>
          <ul>
            {retrievalInfo.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </details>
      )}
      {(localError || error) && (
        <p className="inline-error" role="alert">
          {localError || error}。可保留输入后重试。
        </p>
      )}
      {proposal && (
        <section className="coach-proposal" aria-label="计划调整预览">
          <h4>计划调整预览</h4>
          <p>{coachText(proposal.result.adjustment!.reason, w)}</p>
          <p className="small">
            确认前原计划不变；已完成步骤和有关联成果的步骤必须保留。
          </p>
          <ol>
            {proposal.result.adjustment!.steps.map((s, index) => {
              const oldIndex = task.steps.findIndex((old) => old.id === s.id),
                old = task.steps[oldIndex];
              return (
                <li key={s.id || index}>
                  <b>{s.title}</b> ·{" "}
                  {old
                    ? oldIndex !== index
                      ? "调整顺序"
                      : old.title !== s.title ||
                          old.description !== s.description ||
                          JSON.stringify(old.moduleIds) !==
                            JSON.stringify(s.moduleIds)
                        ? "修改"
                        : "保留"
                    : "新增"}
                  <p>{s.description}</p>
                  <p className="small">
                    {s.moduleIds
                      .map((id) => w.modules.find((m) => m.id === id)?.title)
                      .join("、") || "无关联模块"}
                  </p>
                </li>
              );
            })}
          </ol>
          {task.steps
            .filter(
              (s) =>
                !proposal.result.adjustment!.steps.some((n) => n.id === s.id),
            )
            .map((s) => (
              <p key={s.id}>将移除：{s.title}</p>
            ))}
          <button
            className="btn mini primary"
            disabled={loading || proposal.key !== key}
            onClick={() => {
              if (
                !confirm(
                  "确认应用以上步骤增删、顺序和内容调整？历史计划与成果会保留。",
                )
              )
                return;
              try {
                change((ws) =>
                  applyAdjustment(ws, task.id, proposal.result, proposal.plan),
                );
                setProposal(undefined);
                notify("计划调整已确认并保存");
              } catch (e) {
                setLocalError(e instanceof Error ? e.message : "应用失败");
              }
            }}
          >
            确认应用调整
          </button>
          <button className="btn mini" onClick={() => setProposal(undefined)}>
            放弃建议
          </button>
        </section>
      )}
      {!!task.planHistory?.length && (
        <details>
          <summary>已确认的计划调整 · {task.planHistory.length} 次</summary>
          {task.planHistory.map((h, i) => (
            <div key={i}>
              <p>
                {new Date(h.createdAt).toLocaleString("zh-CN")} ·{" "}
                {coachText(h.reason, w)}
              </p>
              <p className="small">
                调整前：{h.steps.map((s) => s.title).join(" → ")}
              </p>
            </div>
          ))}
        </details>
      )}
      {!!task.assistantLog?.length && (
        <details open>
          <summary>当前任务的助手记录</summary>
          {task.assistantLog.slice(-3).map((entry) => (
            <article className="coach-answer" key={entry.id}>
              <b>{entry.question}</b>
              {entry.result.adjustment &&
                entry.contextKey === key &&
                w.activeTaskId === task.id && (
                  <button
                    className="btn mini"
                    onClick={() =>
                      setProposal({
                        result: entry.result,
                        key,
                        plan: planKey(task),
                      })
                    }
                  >
                    重新预览此计划建议
                  </button>
                )}

              <p className="small">
                AI 回答 · 引用表示关联材料，仍需核验是否支持具体结论。
              </p>
              <MarkdownContent>
                {coachText(entry.result.answer, w)}
              </MarkdownContent>
              {entry.contextKey !== key && (
                <p className="small">
                  任务内容已变化，这是生成时的回答与引用快照。
                </p>
              )}
              <details>
                <summary>本次上下文范围</summary>
                <ul>
                  {entry.coverage?.map((text, i) => <li key={i}>{text}</li>)}
                </ul>
              </details>
              {citations(entry.result, entry.evidence)}
            </article>
          ))}
        </details>
      )}
      {task.status === "completed" && (
        <section aria-label="学习成果总结">
          <h4>学习成果总结</h4>
          <button
            className="btn mini"
            disabled={loading}
            onClick={() => void request("summary")}
          >
            {task.learningSummary ? "重新整理总结" : "重试生成总结"}
          </button>
          {task.learningSummary && (
            <>
              {task.learningSummary.contextKey !== key && (
                <p className="small">任务内容已变化，可重新整理总结。</p>
              )}
              <MarkdownContent>
                {coachText(task.learningSummary.result.answer, w)}
              </MarkdownContent>
              {(["knowledge", "weaknesses", "review"] as const).map(
                (field, i) => (
                  <div key={field}>
                    <b>
                      {
                        [
                          "核心知识与成果",
                          "薄弱环节与证据限制",
                          "后续复习建议",
                        ][i]
                      }
                    </b>
                    <ul>
                      {task.learningSummary!.result.summary?.[field].map(
                        (s, j) => <li key={j}>{s}</li>,
                      )}
                    </ul>
                  </div>
                ),
              )}
              <details>
                <summary>总结依据范围</summary>
                <ul>
                  {task.learningSummary.coverage?.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </details>
              {citations(
                task.learningSummary.result,
                task.learningSummary.evidence,
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
