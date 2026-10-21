import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  ClipboardCheck,
  FileText,
  Plus,
  Pause,
  Play,
  SlidersHorizontal,
  X,
  ArrowUp,
  ArrowDown,
  Trash2,
  CheckCheck,
  ArrowRight,
} from "lucide-react";
import type { Workspace, Note, Resource, Source } from "./model";
import { uid } from "./model";
import type { LayoutPlanning } from "./layoutPlan";
import { PlanFields } from "./PlanEditor";
import {
  addTask,
  activateTask,
  artifactCandidates,
  finishTask,
  linkArtifact,
  taskFromPlan,
  type LearningTask,
  type TaskArtifact,
} from "./tasks";
import {
  manualPlan,
  manualPlanKey,
  saveManualPlan,
  completeStep,
  type ManualPlan,
} from "./taskPresentation";
import { MarkdownContent } from "./MarkdownContent";
import { contentKindLabels } from "./noteContent";
import { TaskDialog } from "./TaskDialog";
import "./taskPanel.css";
const statuses = { active: "进行中", paused: "已暂停", completed: "已完成" };
type Tab = "plan" | "results";
type Dialog =
  | { type: "create" }
  | { type: "artifact"; taskId: string; stepId: string }
  | { type: "step"; taskId: string; stepId: string }
  | { type: "edit"; taskId: string; draft: ManualPlan; expected: string }
  | { type: "view"; taskId: string; artifact: TaskArtifact };
export function TaskPanel({
  workspace: w,
  rawWorkspace,
  allNotes,
  resources,
  jump,
  notes,
  change,
  focus,
  notify,
  reuse,
  saveStatus,
  cloudStatus,
  children,
  editing = false,
}: {
  workspace: Workspace;
  rawWorkspace: Workspace;
  allNotes: Note[];
  resources: Resource[];
  jump: (source: Source) => void;
  notes: Note[];
  change: (update: (w: Workspace) => Workspace) => void;
  focus: (id: string, noteId?: string) => void;
  notify: (message: string) => void;
  reuse?: (sourceTaskId?: string) => void;
  saveStatus?: string;
  cloudStatus?: string;
  children?: ReactNode;
  editing?: boolean;
}) {
  const tasks = w.tasks || [],
    active = tasks.find((t) => t.id === w.activeTaskId);
  const [preferences] = useState<{ drawer?: boolean; collapsed?: boolean }>(
    () => {
      try {
        const value = JSON.parse(
          localStorage.getItem(`learnspace-task-ui:${w.id}`) || "{}",
        );
        return {
          drawer: typeof value.drawer === "boolean" ? value.drawer : undefined,
          collapsed:
            typeof value.collapsed === "boolean" ? value.collapsed : undefined,
        };
      } catch {
        return {};
      }
    },
  );
  const [pendingFocus, setPendingFocus] = useState<{
    taskId: string;
    moduleId: string;
    noteId?: string;
  }>();
  const [drawer, setDrawer] = useState(
      () =>
        preferences.drawer ??
        (!!active &&
          !editing &&
          !window.matchMedia("(max-width: 1100px)").matches),
    ),
    [tab, setTab] = useState<Tab>("plan"),
    [collapsed, setCollapsed] = useState(preferences.collapsed || false),
    [menu, setMenu] = useState(false),
    [stepId, setStepId] = useState(""),
    [reviewId, setReviewId] = useState(""),
    [completedId, setCompletedId] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [error, setError] = useState(""),
    [candidateKey, setCandidateKey] = useState(""),
    [reuseSource, setReuseSource] = useState("");
  const [narrow, setNarrow] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1100px)").matches,
  );
  const [plan, setPlan] = useState<LayoutPlanning>({
    goal: "",
    steps: [
      {
        title: "开始学习",
        description: "理解资料并整理成果",
        moduleTypes: [...new Set(w.modules.map((m) => m.type))].slice(0, 1),
      },
    ],
    outcomes: ["保存一项学习成果"],
    layoutReason: "用户创建",
  });
  const picker = useRef<HTMLDivElement>(null),
    pickerButton = useRef<HTMLButtonElement>(null),
    drawerRef = useRef<HTMLElement>(null),
    canvas = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  const reviewed =
    tasks.find((t) => t.id === reviewId) ||
    active ||
    tasks.find((t) => t.id === completedId) ||
    [...tasks].reverse().find((t) => t.status === "completed") ||
    tasks.at(-1);
  const completed = tasks.find(
      (t) => t.id === completedId && t.status === "completed",
    ),
    display = active || completed;
  const selectedStep =
    active?.steps.find((s) => s.id === stepId) ||
    active?.steps.find((s) => !s.done) ||
    active?.steps.at(-1);
  const primaryModule = selectedStep?.moduleIds
    .map((id) => w.modules.find((m) => m.id === id))
    .find(Boolean);
  const continueLabel =
    primaryModule &&
    ["custom-ai", "chat", "summary", "translate"].includes(primaryModule.type)
      ? "继续分析"
      : primaryModule?.type === "note"
        ? "继续整理笔记"
        : primaryModule && ["quiz", "cards"].includes(primaryModule.type)
          ? "开始巩固练习"
          : primaryModule &&
              ["pdf", "text", "web", "video", "image"].includes(
                primaryModule.type,
              )
            ? "查看学习资料"
            : "继续学习";
  const count = display?.steps.filter((s) => s.done).length || 0;
  const candidates = artifactCandidates(w, notes),
    selectedCandidate = candidates.find((c) => c.key === candidateKey);
  const closeDialog = () => {
    setDialog(null);
    setError("");
    queueMicrotask(() => pickerButton.current?.focus());
  };
  const open = (next: Tab) => {
    setTab(next);
    setDrawer(true);
  };
  const show = (next: Dialog) => {
    setError("");
    setMenu(false);
    setCandidateKey("");
    if (next.type === "create")
      setPlan({
        goal: "",
        steps: [
          {
            title: "开始学习",
            description: "理解资料并整理成果",
            moduleTypes: [...new Set(w.modules.map((m) => m.type))].slice(0, 1),
          },
        ],
        outcomes: ["保存一项学习成果"],
        layoutReason: "用户创建",
      });
    setDialog(next);
  };
  const act = (operation: () => void) => {
    try {
      operation();
      setError("");
    } catch (e) {
      const message = e instanceof Error ? e.message : "操作失败，原内容保留";
      setError(message);
      notify(message);
    }
  };
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)"),
      update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setStepId("");
    setDialog(null);
    setError("");
    setCandidateKey("");
    setReuseSource("");
  }, [w.activeTaskId]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (!picker.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);
  useEffect(() => {
    try {
      localStorage.setItem(
        `learnspace-task-ui:${w.id}`,
        JSON.stringify({ drawer, collapsed }),
      );
    } catch {}
  }, [drawer, collapsed, w.id]);
  useEffect(() => {
    if (!pendingFocus || w.activeTaskId !== pendingFocus.taskId) return;
    // Run after the task-scoped editor's effects, even in a background tab.
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      if (w.modules.some((m) => m.id === pendingFocus.moduleId)) {
        setDrawer(false);
        focus(pendingFocus.moduleId, pendingFocus.noteId);
      }
      setPendingFocus(undefined);
    });
    return () => {
      live = false;
    };
  }, [w.activeTaskId, pendingFocus, focus, w.modules]);
  useEffect(() => {
    if (!narrow || !drawer) return;
    const root = canvas.current?.closest(".learning-system"),
      header = root?.closest(".editor-shell")?.querySelector(".editor-header");
    const backgrounds = [
      canvas.current,
      root?.querySelector(".learning-taskbar"),
      header,
    ].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement && !el.hasAttribute("inert"),
    );
    backgrounds.forEach((el) => el.setAttribute("inert", ""));
    closeButton.current?.focus();
    return () => {
      backgrounds.forEach((el) => el.removeAttribute("inert"));
      queueMicrotask(() => {
        if (pickerButton.current?.isConnected) pickerButton.current.focus();
      });
    };
  }, [drawer, narrow]);
  const selectTask = (id?: string) => {
    setMenu(false);
    setCompletedId("");
    setReviewId(id || "");
    change((ws) => activateTask(ws, id));
    pickerButton.current?.focus();
  };
  const toggleStep = (taskId: string, id: string, done: boolean) => {
    change((ws) => completeStep(ws, taskId, id, done));
    if (done) {
      const next = active?.steps.find((s) => s.id !== id && !s.done);
      setStepId(next?.id || id);
      notify(
        next
          ? "步骤已完成，可以继续下一步"
          : "所有步骤已确认，可检查成果并完成任务",
      );
    }
  };
  const finish = () =>
    act(() => {
      if (!active) return;
      finishTask(rawWorkspace, active.id);
      if (
        !confirm(
          "确认已完成学习目标，并检查成果要求？完成后可以回顾步骤与学习成果。",
        )
      )
        return;
      const id = active.id;
      change((ws) => finishTask(ws, id));
      setCompletedId(id);
      setReviewId(id);
      open("results");
    });
  function onDrawerKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setDrawer(false);
      pickerButton.current?.focus();
    }
    if (narrow && e.key === "Tab") {
      const list = Array.from(
        drawerRef.current!.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length);
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0]?.focus();
      }
    }
  }
  return (
    <section className="learning-system" aria-label="学习任务">
      <div className="learning-taskbar">
        <div
          className="learning-picker"
          ref={picker}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setMenu(false);
              pickerButton.current?.focus();
            }
          }}
        >
          <button
            className="learning-picker-button"
            ref={pickerButton}
            aria-expanded={menu}
            aria-controls="learning-task-menu"
            onClick={() => setMenu(!menu)}
          >
            <ClipboardCheck size={17} />
            <span>{display?.title || "自由学习"}</span>
            <ChevronDown size={14} />
          </button>
          {menu && (
            <div
              className="learning-task-menu"
              id="learning-task-menu"
              aria-label="切换学习任务"
            >
              {tasks.map((t) => (
                <button
                  key={t.id}
                  aria-current={t.id === display?.id ? "true" : undefined}
                  onClick={() => {
                    if (t.status === "completed") {
                      setReviewId(t.id);
                      if (!active) setCompletedId(t.id);
                      setMenu(false);
                      open("results");
                    } else selectTask(t.id);
                  }}
                >
                  <span>
                    <strong>{t.title}</strong>
                    <small>
                      {t.steps.filter((s) => s.done).length}/{t.steps.length} 步
                      · {statuses[t.status]}
                      {t.status === "completed" ? " · 查看回顾" : ""}
                    </small>
                  </span>
                  {t.id === display?.id && <Check size={15} />}
                </button>
              ))}
              <button onClick={() => selectTask()}>
                <span>
                  <strong>自由学习</strong>
                  <small>暂停当前任务，进度与内容保留</small>
                </span>
              </button>
              <button
                className="learning-new-task"
                onClick={() => show({ type: "create" })}
              >
                <Plus size={15} />
                新建学习任务
              </button>
            </div>
          )}
        </div>
        {display && (
          <span className="learning-state">{statuses[display.status]}</span>
        )}
        <div className="learning-taskbar-end">
          {display && (
            <div
              className="learning-progress"
              aria-label={`已完成 ${count}/${display.steps.length} 步`}
            >
              <progress value={count} max={display.steps.length} />
              <span>
                {count}/{display.steps.length} 步
              </span>
            </div>
          )}
          <span
            className={`learning-save ${saveStatus === "保存失败" || cloudStatus?.includes("冲突") || cloudStatus?.includes("失败") ? "has-error" : ""}`}
            role="status"
            title={`本地：${saveStatus || "自动保存"}${cloudStatus ? ` · 云端：${cloudStatus}` : " · 可按需开启云端同步"}`}
          >
            {saveStatus || "自动保存"}
            {cloudStatus && cloudStatus !== "已同步"
              ? ` · 云端：${cloudStatus}`
              : cloudStatus
                ? " · 已同步"
                : ""}
          </span>
          <button
            className="learning-icon"
            aria-label={collapsed ? "展开当前步骤" : "收起当前步骤"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
          </button>
          <button
            className="learning-text-button"
            aria-expanded={drawer}
            onClick={() => (drawer ? setDrawer(false) : open("plan"))}
          >
            {drawer ? "收起任务面板" : "查看计划"}
          </button>
        </div>
      </div>
      <div className={`learning-layout ${drawer ? "with-drawer" : ""}`}>
        <div className="learning-canvas" ref={canvas}>
          {!collapsed && (
            <section className="learning-current" aria-label="当前学习步骤">
              {active && selectedStep ? (
                <>
                  <div className="learning-row learning-spread">
                    <span className="learning-eyebrow">
                      {selectedStep.done ? "已完成步骤" : "当前行动"}{" "}
                      <span>
                        {String(
                          active.steps.indexOf(selectedStep) + 1,
                        ).padStart(2, "0")}{" "}
                        / {String(active.steps.length).padStart(2, "0")}
                      </span>
                    </span>
                    <button
                      className="learning-icon"
                      aria-label="暂停当前任务"
                      onClick={() => selectTask()}
                    >
                      <Pause size={16} />
                    </button>
                  </div>
                  <h2>{selectedStep.title}</h2>
                  <p>{selectedStep.description}</p>
                  <div className="learning-current-actions">
                    {selectedStep.moduleIds.some((id) =>
                      w.modules.some((m) => m.id === id),
                    ) ? (
                      <button
                        className="learning-button primary"
                        onClick={() => {
                          const id = selectedStep.moduleIds.find((id) =>
                            w.modules.some((m) => m.id === id),
                          );
                          if (id) {
                            if (narrow) setDrawer(false);
                            focus(id);
                          }
                        }}
                      >
                        {continueLabel}
                        <ArrowUpRight size={15} />
                      </button>
                    ) : (
                      <button
                        className="learning-button primary"
                        onClick={() => {
                          open("plan");
                          show({
                            type: "edit",
                            taskId: active.id,
                            draft: manualPlan(active),
                            expected: manualPlanKey(active),
                          });
                        }}
                      >
                        关联学习模块
                      </button>
                    )}
                    <button
                      className="learning-button"
                      onClick={() => {
                        if (selectedStep.done)
                          toggleStep(active.id, selectedStep.id, false);
                        else if (
                          !active.artifacts.some(
                            (a) => a.stepId === selectedStep.id,
                          )
                        )
                          show({
                            type: "step",
                            taskId: active.id,
                            stepId: selectedStep.id,
                          });
                        else toggleStep(active.id, selectedStep.id, true);
                      }}
                    >
                      {selectedStep.done ? "撤销完成" : "完成此步骤"}
                    </button>
                    <button
                      className="learning-artifact-link"
                      onClick={() =>
                        show({
                          type: "artifact",
                          taskId: active.id,
                          stepId: selectedStep.id,
                        })
                      }
                    >
                      {active.artifacts.some(
                        (a) => a.stepId === selectedStep.id,
                      ) ? (
                        `已关联 ${active.artifacts.filter((a) => a.stepId === selectedStep.id).length} 项成果`
                      ) : (
                        <>
                          <Plus size={14} />
                          添加成果
                        </>
                      )}
                    </button>
                  </div>
                  {active.steps.every((s) => s.done) && (
                    <div className="learning-finish-line">
                      <span>步骤已完成，检查成果后可以收尾。</span>
                      <button className="learning-text-button" onClick={finish}>
                        完成任务并回顾
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                </>
              ) : completed ? (
                <>
                  <span className="learning-eyebrow">
                    <CheckCheck size={15} />
                    任务已完成
                  </span>
                  <h2>这次学习，留下了什么？</h2>
                  <p>
                    {completed.steps.length} 个步骤已完成 ·{" "}
                    {completed.artifacts.length}{" "}
                    项成果已保存，仍待验证的内容可以继续完善。
                  </p>
                  <div className="learning-current-actions">
                    <button
                      className="learning-button primary"
                      onClick={() => open("results")}
                    >
                      查看学习回顾
                      <ArrowRight size={15} />
                    </button>
                    <button
                      className="learning-text-button"
                      onClick={() => {
                        if (confirm("重新打开此任务？原有成果与记录将保留。"))
                          selectTask(completed.id);
                      }}
                    >
                      继续完善
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="learning-eyebrow">自由学习</span>
                  <h2>从一个想法开始，也很好</h2>
                  <p>
                    直接阅读、提问或记笔记。需要清晰的行动路线时，再创建任务。
                  </p>
                  <button
                    className="learning-button primary"
                    onClick={() => show({ type: "create" })}
                  >
                    <Plus size={15} />
                    创建学习任务
                  </button>
                </>
              )}
            </section>
          )}
          {children}
        </div>
        {drawer && narrow && (
          <div
            className="learning-drawer-backdrop"
            aria-hidden="true"
            onClick={() => setDrawer(false)}
          />
        )}
        <aside
          className="learning-drawer"
          hidden={!drawer}
          ref={drawerRef}
          role={narrow ? "dialog" : undefined}
          aria-modal={narrow && drawer ? true : undefined}
          aria-label="学习任务详情"
          onKeyDown={onDrawerKey}
        >
          <header className="learning-drawer-heading">
            <strong>学习任务</strong>
            <button
              className="learning-icon"
              ref={closeButton}
              aria-label="关闭任务抽屉"
              onClick={() => {
                setDrawer(false);
                pickerButton.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          </header>
          <div className="learning-tabs" role="tablist" aria-label="任务详情">
            {(
              [
                ["plan", "计划"],
                ["results", "成果"],
              ] as const
            ).map(([id, label], i) => (
              <button
                key={id}
                id={`learning-tab-${id}`}
                role="tab"
                tabIndex={tab === id ? 0 : -1}
                aria-selected={tab === id}
                aria-controls={`learning-pane-${id}`}
                onClick={() => setTab(id)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const ids: Tab[] = ["plan", "results"],
                      next =
                        ids[
                          (i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) %
                            ids.length
                        ];
                    setTab(next);
                    document.getElementById(`learning-tab-${next}`)?.focus();
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="learning-drawer-scroll">
            <section
              id="learning-pane-plan"
              role="tabpanel"
              aria-labelledby="learning-tab-plan"
              hidden={tab !== "plan"}
            >
              {active ? (
                <>
                  <div className="learning-caption">这次想做到</div>
                  <p className="learning-goal">{active.goal}</p>
                  <ol className="learning-timeline">
                    {active.steps.map((s, i) => (
                      <li
                        key={s.id}
                        className={`${s.done ? "is-done" : ""} ${s.id === selectedStep?.id ? "is-selected" : ""}`}
                      >
                        <span className="learning-step-marker">
                          {s.done ? <Check size={12} /> : i + 1}
                        </span>
                        <button
                          className="learning-step-title"
                          onClick={() => setStepId(s.id)}
                          aria-current={
                            s.id === selectedStep?.id ? "step" : undefined
                          }
                        >
                          {s.title}
                          {s.id === selectedStep?.id && !s.done && (
                            <span className="learning-badge">当前</span>
                          )}
                        </button>
                        {s.id === selectedStep?.id && (
                          <>
                            <p>{s.description}</p>
                            <div className="learning-step-modules">
                              {s.moduleIds.map((id) => {
                                const m = w.modules.find((m) => m.id === id);
                                return m ? (
                                  <button
                                    key={id}
                                    onClick={() => {
                                      if (narrow) setDrawer(false);
                                      focus(id);
                                    }}
                                  >
                                    <ArrowUpRight size={12} />
                                    {m.title}
                                  </button>
                                ) : (
                                  <span key={id}>关联模块已移除</span>
                                );
                              })}
                            </div>
                            <button
                              className="learning-text-button"
                              onClick={() =>
                                show({
                                  type: "artifact",
                                  taskId: active.id,
                                  stepId: s.id,
                                })
                              }
                            >
                              添加本步骤成果
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ol>
                  <button
                    className="learning-text-button"
                    onClick={() =>
                      show({
                        type: "edit",
                        taskId: active.id,
                        draft: manualPlan(active),
                        expected: manualPlanKey(active),
                      })
                    }
                  >
                    <SlidersHorizontal size={14} />
                    编辑计划
                  </button>
                  {!!active.outcomes.length && (
                    <div className="learning-divider-section">
                      <div className="learning-caption">完成时留下</div>
                      <ul className="learning-outcomes">
                        {active.outcomes.map((o, i) => (
                          <li key={i}>{o}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!!active.plan?.moduleRoles?.length && (
                    <details className="learning-divider-section">
                      <summary>模块分工</summary>
                      {active.plan.moduleRoles.map((r) => (
                        <p className="small" key={r.moduleId}>
                          {w.modules.find((m) => m.id === r.moduleId)?.title ||
                            "原方案模块已移除"}
                          ：{r.purpose}
                        </p>
                      ))}
                    </details>
                  )}
                  {reuse && (
                    <details className="learning-divider-section">
                      <summary>复用已有内容</summary>
                      <label className="form-label">
                        内容来源
                        <select
                          aria-label="复用内容来源"
                          value={reuseSource}
                          onChange={(e) => setReuseSource(e.target.value)}
                        >
                          <option value="">自由学习／升级前的内容</option>
                          {tasks
                            .filter((t) => t.id !== active.id)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.title}
                              </option>
                            ))}
                        </select>
                      </label>
                      <p className="small">
                        复制模块内容与笔记，不复制任务进度、作答记录或成果关联。
                      </p>
                      <button
                        className="learning-button"
                        onClick={() => {
                          if (
                            confirm(
                              "将来源模块状态复制到当前任务？当前模块状态将替换，已有笔记仍保留。",
                            )
                          )
                            act(() => reuse(reuseSource || undefined));
                        }}
                      >
                        复制到当前任务
                      </button>
                    </details>
                  )}
                  <div className="learning-divider-section">
                    <button className="learning-text-button" onClick={finish}>
                      完成任务并回顾
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="learning-empty">
                  <ClipboardCheck size={23} />
                  <h3>按自己的节奏探索</h3>
                  <p>
                    创建任务后，计划与成果会在这里汇集。已有任务可从顶部切换。
                  </p>
                  <button
                    className="learning-button primary"
                    onClick={() => show({ type: "create" })}
                  >
                    创建学习任务
                  </button>
                </div>
              )}
            </section>
            <section
              id="learning-pane-results"
              role="tabpanel"
              aria-labelledby="learning-tab-results"
              hidden={tab !== "results"}
            >
              {reviewed ? (
                <>
                  <label className="form-label">
                    查看任务
                    <select
                      aria-label="回顾学习任务"
                      value={reviewed.id}
                      onChange={(e) => setReviewId(e.target.value)}
                    >
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title} · {statuses[t.status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {reviewed.status === "completed" && (
                    <>
                      <span className="learning-eyebrow">学习回顾</span>
                      <h3 className="learning-review-title">
                        每一步，都有留下。
                      </h3>
                    </>
                  )}
                  <div className="learning-row learning-spread">
                    <span className="learning-caption">
                      已保存的成果 · {reviewed.artifacts.length}
                    </span>
                    {reviewed.id === active?.id && selectedStep && (
                      <button
                        className="learning-text-button"
                        onClick={() =>
                          show({
                            type: "artifact",
                            taskId: active.id,
                            stepId: selectedStep.id,
                          })
                        }
                      >
                        <Plus size={14} />
                        添加
                      </button>
                    )}
                  </div>
                  {reviewed.artifacts.map((a) => (
                    <button
                      className="learning-artifact-card"
                      key={a.id}
                      onClick={() =>
                        show({ type: "view", taskId: reviewed.id, artifact: a })
                      }
                    >
                      <span className="learning-caption">
                        {reviewed.steps.find((s) => s.id === a.stepId)?.title ||
                          "原步骤"}{" "}
                        · {contentKindLabels[a.contentKind]}
                      </span>
                      <strong>{a.title}</strong>
                      <p>
                        {a.snapshot.slice(0, 110)}
                        {a.snapshot.length > 110 ? "…" : ""}
                      </p>
                      <span className="learning-caption">
                        已保存快照 · 查看内容 ↗
                      </span>
                    </button>
                  ))}
                  {!reviewed.artifacts.length && (
                    <div className="learning-empty">
                      <FileText size={23} />
                      <p>
                        把笔记、卡片、测验或 AI
                        结果留在这里，让每一步都有迹可循。
                      </p>
                    </div>
                  )}
                  <details className="learning-divider-section">
                    <summary>查看步骤完成情况</summary>
                    <ul className="learning-outcomes">
                      {reviewed.steps.map((s) => (
                        <li key={s.id}>
                          {s.done ? "✓ 已完成" : "待完成"} · {s.title} ·{" "}
                          {
                            reviewed.artifacts.filter((a) => a.stepId === s.id)
                              .length
                          }{" "}
                          项成果
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="learning-divider-section">
                    {reviewed.status !== "active" && (
                      <button
                        className="learning-button"
                        onClick={() => {
                          if (
                            reviewed.status !== "completed" ||
                            confirm("重新打开此任务？历史成果会保留。")
                          )
                            selectTask(reviewed.id);
                        }}
                      >
                        <Play size={14} />
                        {reviewed.status === "completed"
                          ? "重新打开任务"
                          : "继续任务"}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="learning-empty">
                  <FileText size={23} />
                  <p>
                    还没有任务成果。可以自由学习，也可以创建一个任务开始积累。
                  </p>
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
      {dialog && (
        <TaskDialog
          title={
            dialog.type === "create"
              ? "给这次学习，一个清晰的目标"
              : dialog.type === "artifact"
                ? "给这一步，留下一份成果"
                : dialog.type === "step"
                  ? "这一步还没有关联成果"
                  : dialog.type === "edit"
                    ? "编辑学习计划"
                    : dialog.artifact.title
          }
          close={closeDialog}
        >
          {dialog.type === "create" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(() => {
                  const clean = {
                    ...plan,
                    goal: plan.goal.trim(),
                    outcomes: plan.outcomes
                      ?.map((s) => s.trim())
                      .filter(Boolean),
                  };
                  if (
                    !clean.goal ||
                    clean.goal.length > 300 ||
                    clean.steps.some(
                      (s) =>
                        !s.title.trim() ||
                        !s.description.trim() ||
                        !s.moduleTypes.length,
                    ) ||
                    clean.outcomes?.some((o) => o.length > 300) ||
                    (clean.outcomes?.length || 0) > 10
                  )
                    throw Error(
                      "请填写目标、每一步行动及关联工具，成果最多10项",
                    );
                  const created = taskFromPlan(clean, w.modules);
                  change((ws) => addTask(ws, created));
                  setReviewId(created.id);
                  setCompletedId("");
                  setDialog(null);
                  setCollapsed(false);
                  open("plan");
                });
              }}
            >
              <p className="small">
                先写下想做到的事，步骤和成果可以随时调整。
              </p>
              <PlanFields
                plan={plan}
                availableTypes={[...new Set(w.modules.map((m) => m.type))]}
                change={setPlan}
              />
              {!w.modules.length && (
                <p className="learning-inline-error">
                  请先在模块库添加学习工具，再创建任务。
                </p>
              )}
              {error && (
                <p role="alert" className="learning-inline-error">
                  {error}
                </p>
              )}
              <div className="learning-dialog-actions">
                <button
                  type="button"
                  className="learning-button"
                  onClick={closeDialog}
                >
                  取消
                </button>
                <button
                  className="learning-button primary"
                  type="submit"
                  disabled={!w.modules.length}
                >
                  创建并开始
                </button>
              </div>
            </form>
          )}
          {dialog.type === "artifact" && (
            <>
              <label className="form-label">
                成果对应步骤
                <select
                  aria-label="成果对应步骤"
                  value={dialog.stepId}
                  onChange={(e) =>
                    setDialog({ ...dialog, stepId: e.target.value })
                  }
                >
                  {active?.steps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <div
                className="learning-candidate-list"
                role="radiogroup"
                aria-label="选择已有成果"
              >
                {candidates.map((c) => (
                  <label
                    key={c.key}
                    className={`learning-candidate ${candidateKey === c.key ? "is-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="task-artifact-candidate"
                      value={c.key}
                      checked={candidateKey === c.key}
                      onChange={() => setCandidateKey(c.key)}
                    />
                    <span>
                      <strong>{c.title}</strong>
                      <p>
                        {c.snapshot.slice(0, 150)}
                        {c.snapshot.length > 150 ? "…" : ""}
                      </p>
                      <small>
                        {contentKindLabels[c.contentKind]} ·{" "}
                        {c.kind === "note"
                          ? "笔记"
                          : c.kind === "custom"
                            ? "AI 运行"
                            : c.kind === "cards"
                              ? "卡片"
                              : "测验"}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {!candidates.length && (
                <p className="learning-empty">
                  先保存笔记、卡片、测验或成功运行自定义模块，再来关联成果。
                </p>
              )}
              <p className="small">
                保存当前内容快照，后续编辑原内容不会覆盖它。
              </p>
              {error && (
                <p role="alert" className="learning-inline-error">
                  {error}
                </p>
              )}
              <div className="learning-dialog-actions">
                <button className="learning-button" onClick={closeDialog}>
                  取消
                </button>
                <button
                  className="learning-button primary"
                  disabled={!selectedCandidate}
                  onClick={() =>
                    act(() => {
                      if (!selectedCandidate) return;
                      if (active?.id !== dialog.taskId)
                        throw Error("任务已切换，请重新选择成果");
                      change((ws) => {
                        if (ws.activeTaskId !== dialog.taskId)
                          throw Error("任务已切换，未关联成果");
                        return {
                          ...ws,
                          tasks: ws.tasks?.map((t) =>
                            t.id === dialog.taskId
                              ? linkArtifact(
                                  t,
                                  selectedCandidate,
                                  dialog.stepId,
                                )
                              : t,
                          ),
                        };
                      });
                      setDialog(null);
                      notify("成果快照已保存到此步骤");
                    })
                  }
                >
                  保存到此步骤
                </button>
              </div>
            </>
          )}
          {dialog.type === "step" && (
            <>
              <p>可以先保留产出，也可以按自己的判断完成步骤。</p>
              <div className="learning-dialog-actions">
                <button
                  className="learning-button"
                  onClick={() =>
                    show({
                      type: "artifact",
                      taskId: dialog.taskId,
                      stepId: dialog.stepId,
                    })
                  }
                >
                  添加成果
                </button>
                <button
                  className="learning-button primary"
                  onClick={() => {
                    toggleStep(dialog.taskId, dialog.stepId, true);
                    setDialog(null);
                  }}
                >
                  仍然完成
                </button>
              </div>
              <button className="learning-text-button" onClick={closeDialog}>
                返回继续学习
              </button>
            </>
          )}
          {dialog.type === "edit" && (
            <>
              <p className="small">
                修改先保留在草案，保存后生效。已完成或已有成果的步骤保留。
              </p>
              <label className="form-label">
                学习目标
                <textarea
                  aria-label="编辑任务目标"
                  maxLength={300}
                  value={dialog.draft.goal}
                  onChange={(e) =>
                    setDialog({
                      ...dialog,
                      draft: { ...dialog.draft, goal: e.target.value },
                    })
                  }
                />
              </label>
              {dialog.draft.steps.map((s, i) => (
                <fieldset className="learning-edit-step" key={s.id}>
                  <legend>步骤 {i + 1}</legend>
                  <label className="form-label">
                    步骤名称
                    <input
                      value={s.title}
                      maxLength={80}
                      onChange={(e) =>
                        setDialog({
                          ...dialog,
                          draft: {
                            ...dialog.draft,
                            steps: dialog.draft.steps.map((x, j) =>
                              i === j ? { ...x, title: e.target.value } : x,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="form-label">
                    行动说明
                    <textarea
                      value={s.description}
                      maxLength={300}
                      onChange={(e) =>
                        setDialog({
                          ...dialog,
                          draft: {
                            ...dialog.draft,
                            steps: dialog.draft.steps.map((x, j) =>
                              i === j
                                ? { ...x, description: e.target.value }
                                : x,
                            ),
                          },
                        })
                      }
                    />
                  </label>
                  <div
                    className="task-module-options"
                    role="group"
                    aria-label={`步骤 ${i + 1} 关联模块`}
                  >
                    {w.modules.map((m) => (
                      <label key={m.id}>
                        <input
                          type="checkbox"
                          checked={s.moduleIds.includes(m.id)}
                          onChange={(e) =>
                            setDialog({
                              ...dialog,
                              draft: {
                                ...dialog.draft,
                                steps: dialog.draft.steps.map((x, j) =>
                                  i === j
                                    ? {
                                        ...x,
                                        moduleIds: e.target.checked
                                          ? [...x.moduleIds, m.id]
                                          : x.moduleIds.filter(
                                              (id) => id !== m.id,
                                            ),
                                      }
                                    : x,
                                ),
                              },
                            })
                          }
                        />
                        {m.title}
                      </label>
                    ))}
                  </div>
                  {s.moduleIds.some(
                    (id) => !w.modules.some((m) => m.id === id),
                  ) && (
                    <button
                      className="learning-text-button"
                      onClick={() =>
                        setDialog({
                          ...dialog,
                          draft: {
                            ...dialog.draft,
                            steps: dialog.draft.steps.map((x, j) =>
                              i === j
                                ? {
                                    ...x,
                                    moduleIds: x.moduleIds.filter((id) =>
                                      w.modules.some((m) => m.id === id),
                                    ),
                                  }
                                : x,
                            ),
                          },
                        })
                      }
                    >
                      清除已移除的模块关联
                    </button>
                  )}
                  <div className="learning-row">
                    <button
                      className="learning-icon"
                      aria-label={`上移步骤 ${i + 1}`}
                      disabled={i === 0}
                      onClick={() => {
                        const steps = [...dialog.draft.steps];
                        [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                        setDialog({
                          ...dialog,
                          draft: { ...dialog.draft, steps },
                        });
                      }}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      className="learning-icon"
                      aria-label={`下移步骤 ${i + 1}`}
                      disabled={i === dialog.draft.steps.length - 1}
                      onClick={() => {
                        const steps = [...dialog.draft.steps];
                        [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                        setDialog({
                          ...dialog,
                          draft: { ...dialog.draft, steps },
                        });
                      }}
                    >
                      <ArrowDown size={15} />
                    </button>
                    <button
                      className="learning-icon"
                      aria-label={`删除步骤 ${i + 1}`}
                      disabled={
                        dialog.draft.steps.length === 1 ||
                        !!active?.steps.find((x) => x.id === s.id)?.done ||
                        !!active?.artifacts.some((a) => a.stepId === s.id)
                      }
                      onClick={() =>
                        setDialog({
                          ...dialog,
                          draft: {
                            ...dialog.draft,
                            steps: dialog.draft.steps.filter(
                              (x) => x.id !== s.id,
                            ),
                          },
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </fieldset>
              ))}
              <button
                className="learning-button"
                disabled={dialog.draft.steps.length >= 20}
                onClick={() =>
                  setDialog({
                    ...dialog,
                    draft: {
                      ...dialog.draft,
                      steps: [
                        ...dialog.draft.steps,
                        {
                          id: uid(),
                          title: "新步骤",
                          description: "说明要完成的行动",
                          moduleIds: [],
                        },
                      ],
                    },
                  })
                }
              >
                <Plus size={15} />
                添加步骤
              </button>
              <label className="form-label">
                成果要求（每行一项）
                <textarea
                  aria-label="编辑成果要求"
                  value={dialog.draft.outcomes.join("\n")}
                  onChange={(e) =>
                    setDialog({
                      ...dialog,
                      draft: {
                        ...dialog.draft,
                        outcomes: e.target.value.split("\n"),
                      },
                    })
                  }
                />
              </label>
              {error && (
                <p role="alert" className="learning-inline-error">
                  {error}
                </p>
              )}
              <div className="learning-dialog-actions">
                <button className="learning-button" onClick={closeDialog}>
                  取消
                </button>
                <button
                  className="learning-button primary"
                  onClick={() =>
                    act(() => {
                      const draft = {
                        ...dialog.draft,
                        outcomes: dialog.draft.outcomes
                          .map((s) => s.trim())
                          .filter(Boolean),
                      };
                      saveManualPlan(
                        rawWorkspace,
                        dialog.taskId,
                        draft,
                        dialog.expected,
                      );
                      change((ws) =>
                        saveManualPlan(
                          ws,
                          dialog.taskId,
                          draft,
                          dialog.expected,
                        ),
                      );
                      setDialog(null);
                      notify("学习计划已保存，进度与成果保留");
                    })
                  }
                >
                  保存修改
                </button>
              </div>
            </>
          )}
          {dialog.type === "view" && (
            <>
              <p className="learning-caption">
                {contentKindLabels[dialog.artifact.contentKind]} ·{" "}
                {new Date(dialog.artifact.createdAt).toLocaleString("zh-CN")} ·
                关联时快照
              </p>
              <MarkdownContent>{dialog.artifact.snapshot}</MarkdownContent>
              {dialog.artifact.sources.map((s, i) => (
                <button
                  key={i}
                  className="learning-source"
                  onClick={() => {
                    if (w.activeTaskId !== dialog.taskId) {
                      notify(
                        "请先继续此任务，再定位它的来源，快照仍可直接查看",
                      );
                      return;
                    }
                    closeDialog();
                    if (narrow) setDrawer(false);
                    jump(s);
                  }}
                >
                  {s.resourceName || "参考资料"}
                  {!s.kind || s.kind === "pdf" ? ` · 第 ${s.page} 页` : ""}
                  <ArrowUpRight size={13} />
                </button>
              ))}
              <div className="learning-dialog-actions">
                <button className="learning-button" onClick={closeDialog}>
                  关闭
                </button>
                {w.modules.some((m) => m.id === dialog.artifact.moduleId) ? (
                  <button
                    className="learning-button primary"
                    onClick={() => {
                      if (active?.id !== dialog.taskId) {
                        if (
                          tasks.find((t) => t.id === dialog.taskId)?.status ===
                            "completed" &&
                          !confirm("重新打开此任务？历史成果保留。")
                        )
                          return;
                        setPendingFocus({
                          taskId: dialog.taskId,
                          moduleId: dialog.artifact.moduleId,
                          noteId:
                            dialog.artifact.kind === "note"
                              ? dialog.artifact.key.slice(5)
                              : undefined,
                        });
                        selectTask(dialog.taskId);
                        setDialog(null);
                        return;
                      }
                      closeDialog();
                      if (narrow) setDrawer(false);
                      focus(
                        dialog.artifact.moduleId,
                        dialog.artifact.kind === "note"
                          ? dialog.artifact.key.slice(5)
                          : undefined,
                      );
                    }}
                  >
                    定位原内容
                    <ArrowUpRight size={14} />
                  </button>
                ) : (
                  <span className="small">原模块已移除，快照仍保留</span>
                )}
              </div>
            </>
          )}
        </TaskDialog>
      )}
    </section>
  );
}
