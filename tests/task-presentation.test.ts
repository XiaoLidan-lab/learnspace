import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { fromTemplate, builtins, uid } from "../src/model";
import { addTask, taskFromPlan, linkArtifact, finishTask } from "../src/tasks";
import {
  manualPlan,
  manualPlanKey,
  saveManualPlan,
  completeStep,
} from "../src/taskPresentation";
import { cloudPayload, parseCloudPayload } from "../src/cloudData";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
function fixture() {
  let w = fromTemplate(builtins[0]);
  const task = taskFromPlan(
    {
      goal: "任务面板验收",
      steps: [
        { title: "阅读", description: "理解合成内容", moduleTypes: ["pdf"] },
        { title: "记录", description: "记下要点", moduleTypes: ["note"] },
      ],
      outcomes: ["一份笔记"],
      layoutReason: "合成",
    },
    w.modules,
  );
  w = addTask(w, task);
  return { w, task };
}
test("计划草案独立编辑，取消不影响原任务；保存保留进度、来源和成果快照", () => {
  const { w, task } = fixture();
  task.steps[0].done = true;
  const candidate = {
    key: "note:x",
    title: "合成笔记",
    moduleId: w.modules[0].id,
    kind: "note" as const,
    snapshot: "合成成果",
    sources: [],
    contentKind: "user" as const,
  };
  w.tasks![0] = linkArtifact(task, candidate, task.steps[0].id);
  const t = w.tasks![0],
    before = JSON.stringify(w),
    draft = manualPlan(t);
  draft.goal = "新的可检验目标";
  draft.steps.reverse();
  draft.steps[0].title = "整理结论";
  assert.equal(JSON.stringify(w), before);
  const next = saveManualPlan(w, t.id, draft, manualPlanKey(t)),
    updated = next.tasks![0];
  assert.equal(updated.goal, draft.goal);
  assert.equal(updated.steps[1].done, true);
  assert.deepEqual(updated.artifacts, t.artifacts);
  assert.equal(updated.planHistory!.length, 1);
  assert.equal(JSON.stringify(w), before);
  assert.equal(
    parseCloudPayload(cloudPayload(next, [])).workspace.tasks![0].goal,
    draft.goal,
  );
});
test("已完成及已有成果步骤不能删除；允许增删未完成步骤并校验模块与内容", () => {
  const { w, task } = fixture();
  task.steps[0].done = true;
  const key = manualPlanKey(task),
    draft = manualPlan(task);
  assert.throws(
    () =>
      saveManualPlan(w, task.id, { ...draft, steps: [draft.steps[1]] }, key),
    /不能直接删除/,
  );
  const fresh = {
    id: uid(),
    title: "核验证据",
    description: "检查结论支持",
    moduleIds: [w.modules[0].id],
  };
  const next = saveManualPlan(
    w,
    task.id,
    { ...draft, steps: [draft.steps[0], fresh] },
    key,
  );
  assert.equal(next.tasks![0].steps[1].done, false);
  assert.throws(
    () =>
      saveManualPlan(
        w,
        task.id,
        { ...draft, steps: [{ ...draft.steps[0], moduleIds: ["missing"] }] },
        key,
      ),
    /模块已移除/,
  );
  assert.throws(() => saveManualPlan(w, task.id, { ...draft, goal: "" }, key));
  assert.throws(
    () =>
      saveManualPlan(
        w,
        task.id,
        { ...draft, steps: [draft.steps[0], draft.steps[0]] },
        key,
      ),
    /重复/,
  );
  task.steps[0].done = false;
  task.artifacts.push({
    id: uid(),
    key: "custom:example",
    title: "结果",
    kind: "custom",
    moduleId: w.modules[0].id,
    snapshot: "snapshot",
    sources: [],
    contentKind: "ai",
    stepId: task.steps[0].id,
    createdAt: 1,
  });
  assert.throws(
    () =>
      saveManualPlan(
        w,
        task.id,
        { ...manualPlan(task), steps: [draft.steps[1]] },
        manualPlanKey(task),
      ),
    /不能直接删除/,
  );
});
test("切换任务或并发计划/进度变化后拒绝迟到保存；完成步骤不会更改掌握证据", () => {
  const { w, task } = fixture();
  const draft = manualPlan(task),
    key = manualPlanKey(task);
  const progressed = completeStep(w, task.id, task.steps[0].id, true);
  assert.throws(
    () => saveManualPlan(progressed, task.id, draft, key),
    /已变化/,
  );
  const b = taskFromPlan(
      {
        goal: "任务B",
        steps: [
          { title: "学习", description: "独立内容", moduleTypes: ["note"] },
        ],
        layoutReason: "合成",
      },
      w.modules,
    ),
    switched = addTask(w, b);
  assert.throws(
    () => completeStep(switched, task.id, task.steps[0].id, true),
    /已切换/,
  );
  assert.throws(() => saveManualPlan(switched, task.id, draft, key), /已切换/);
  assert.equal(task.steps[0].done, false);
  assert.equal(progressed.tasks![0].steps[0].done, true);
  assert(!progressed.tasks![0].feedback);
  assert(!progressed.tasks![0].learningSummary);
  assert.throws(() => finishTask(progressed, task.id), /所有步骤/);
  const all = completeStep(progressed, task.id, task.steps[1].id, true);
  assert.throws(() => finishTask(all, task.id), /学习成果/);
});
