import { z } from "zod";
import type { Workspace } from "./model.js";
import type { LearningTask } from "./tasks.js";
export const manualPlanSchema = z
  .object({
    goal: z.string().trim().min(1).max(300),
    outcomes: z.array(z.string().trim().min(1).max(300)).max(20),
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().trim().min(1).max(80),
            description: z.string().trim().min(1).max(300),
            moduleIds: z.array(z.string()).max(24),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type ManualPlan = z.infer<typeof manualPlanSchema>;
export function manualPlan(task: LearningTask): ManualPlan {
  return {
    goal: task.goal,
    outcomes: [...task.outcomes],
    steps: task.steps.map(({ id, title, description, moduleIds }) => ({
      id,
      title,
      description,
      moduleIds: [...moduleIds],
    })),
  };
}
export function manualPlanKey(task: LearningTask) {
  return JSON.stringify({
    plan: manualPlan(task),
    done: task.steps.map((s) => s.done),
    artifacts: task.artifacts.map((a) => [a.id, a.stepId]),
  });
}
export function saveManualPlan(
  w: Workspace,
  taskId: string,
  input: ManualPlan,
  expected: string,
): Workspace {
  const task = w.tasks?.find((t) => t.id === taskId);
  if (!task || w.activeTaskId !== taskId || task.status !== "active")
    throw Error("任务已切换，请重新打开计划编辑");
  if (manualPlanKey(task) !== expected)
    throw Error("任务进度或计划已变化，请重新打开编辑，当前内容已保留");
  const draft = manualPlanSchema.parse(input),
    ids = new Set(draft.steps.map((s) => s.id));
  if (ids.size !== draft.steps.length) throw Error("步骤标识重复，请重新编辑");
  if (
    draft.steps.some((s) =>
      s.moduleIds.some((id) => !w.modules.some((m) => m.id === id)),
    )
  )
    throw Error("关联模块已移除，请重新选择步骤的模块");
  if (
    task.steps.some(
      (s) =>
        (s.done || task.artifacts.some((a) => a.stepId === s.id)) &&
        !ids.has(s.id),
    )
  )
    throw Error("已完成或已有成果的步骤不能直接删除");
  return {
    ...w,
    tasks: w.tasks?.map((t) =>
      t.id === taskId
        ? {
            ...t,
            goal: draft.goal,
            title: draft.goal.slice(0, 80),
            outcomes: draft.outcomes,
            steps: draft.steps.map((s) => ({
              ...s,
              moduleIds: [...new Set(s.moduleIds)],
              done: task.steps.find((old) => old.id === s.id)?.done || false,
            })),
            planHistory: [
              ...(t.planHistory || []).slice(-9),
              {
                createdAt: Date.now(),
                reason: "用户编辑学习计划",
                steps: structuredClone(t.steps),
              },
            ],
          }
        : t,
    ),
  };
}
export function completeStep(
  w: Workspace,
  taskId: string,
  stepId: string,
  done: boolean,
): Workspace {
  const task = w.tasks?.find((t) => t.id === taskId);
  if (!task || w.activeTaskId !== taskId || task.status !== "active")
    throw Error("任务已切换，此次操作未应用");
  if (!task.steps.some((s) => s.id === stepId))
    throw Error("步骤已改变，请重新选择");
  return {
    ...w,
    tasks: w.tasks?.map((t) =>
      t.id === taskId
        ? {
            ...t,
            steps: t.steps.map((s) => (s.id === stepId ? { ...s, done } : s)),
          }
        : t,
    ),
  };
}
