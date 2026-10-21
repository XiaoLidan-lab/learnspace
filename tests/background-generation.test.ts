import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { GenerationTasks } from "../src/generationTasks";
import { readGenerationTarget } from "../src/generationTarget";
import { updateModule } from "../src/tasks";
import { createLocalStore } from "../src/storage";
import type { Workspace } from "../src/model";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function fixture() {
  const workspace = (id: string): Workspace => ({
    id, title: id, description: "", createdAt: 0, updatedAt: 0,
    modules: [{ id: "same-module-id", type: "mindmap", title: "导图", input: "材料", layout: { x: 0, y: 0, w: 6, h: 6 } }],
  });
  return { workspaces: [workspace("A"), workspace("B")], notes: [], resources: [], owner: "user-A", blocked: false };
}

test("退出视图/切换工作台后继续生成，重新订阅恢复进度，只写回原工作台并可从本地恢复", async () => {
  const tasks = new GenerationTasks(), state = fixture(), gate = deferred<void>();
  const target = { workspaceId: "A", moduleId: "same-module-id", owner: state.owner };
  let upstream: AbortSignal | undefined, calls = 0, view = "A";
  const detach = tasks.subscribe(() => {});
  const valid = () => !!readGenerationTarget(state, target);
  const done = tasks.run("A/mindmap", valid, async (signal, report) => {
    calls++; upstream = signal;
    report({ progress: "正在分析", partial: "已有部分内容" });
    await gate.promise;
    return () => {
      state.workspaces = state.workspaces.map(w => w.id === target.workspaceId
        ? updateModule(w, target.moduleId, { output: "已完成导图" }, null) : w);
      tasks.reconcile(); // Saving a completed result must not cancel itself.
    };
  });
  await Promise.resolve();
  detach(); view = "B";
  tasks.reconcile();
  assert.equal(upstream?.aborted, false);
  assert.equal(tasks.snapshot("A/mindmap").busy, true);
  assert.equal(tasks.snapshot("A/mindmap").progress, "正在分析");
  const remount = tasks.subscribe(() => {});
  // Re-entering/clicking again during the same run must not pay for a second request.
  const same = tasks.run("A/mindmap", valid, async () => { throw Error("重复执行"); });
  assert.equal(same, done);
  gate.resolve(); await done;
  assert.equal(view, "B"); assert.equal(calls, 1);
  assert.equal(state.workspaces[0].modules[0].output, "已完成导图");
  assert.equal(state.workspaces[1].modules[0].output, undefined);
  assert.equal(tasks.snapshot("A/mindmap").busy, false);
  const name = `background-${crypto.randomUUID()}`, store = createLocalStore(name);
  await store.saveSnapshot(state.workspaces, []);
  assert.equal((await createLocalStore(name).workspaces()).find(w => w.id === "A")?.modules[0].output, "已完成导图");
  remount(); tasks.dispose();
});

test("导图和测验有独立进度与取消，取消后迟到结果不写入", async () => {
  const tasks = new GenerationTasks(), a = deferred<void>(), b = deferred<void>();
  const committed: string[] = [];
  const map = tasks.run("A/map", () => true, async (_signal, report) => {
    report({ progress: "导图分析" }); await a.promise;
    return () => { committed.push("map"); };
  });
  const quiz = tasks.run("A/quiz", () => true, async (_signal, report) => {
    report({ partial: '{"questions":[' }); await b.promise;
    return () => { committed.push("quiz"); };
  });
  await Promise.resolve();
  tasks.cancel("A/map");
  assert.equal(tasks.snapshot("A/quiz").busy, true);
  assert.equal(tasks.snapshot("A/quiz").partial, '{"questions":[');
  a.resolve(); b.resolve(); await Promise.all([map, quiz]);
  assert.deepEqual(committed, ["quiz"]);
  tasks.dispose();
});

test("输入变化、目标删除、退出账号或本地保存冲突阻止旧任务回写", async () => {
  for (const change of ["input", "module", "workspace", "account", "conflict"] as const) {
    const tasks = new GenerationTasks(), state = fixture(), gate = deferred<void>();
    const target = { workspaceId: "A", moduleId: "same-module-id", owner: state.owner };
    let saved = false, signal: AbortSignal | undefined;
    const valid = () => readGenerationTarget(state, target)?.mod.input === "材料";
    const done = tasks.run("A", valid, async value => { signal = value; await gate.promise; return () => { saved = true; }; });
    await Promise.resolve();
    if (change === "input") state.workspaces[0].modules[0].input = "新的手动材料";
    if (change === "module") state.workspaces[0].modules = [];
    if (change === "workspace") state.workspaces.shift();
    if (change === "account") state.owner = "user-B";
    if (change === "conflict") state.blocked = true;
    tasks.reconcile();
    assert.equal(signal?.aborted, true, change);
    gate.resolve(); await done;
    assert.equal(saved, false, change);
    assert.match(tasks.snapshot("A").error, /已停止旧任务/);
    tasks.dispose();
  }
});

test("不依赖视图挂载的失败反馈、重试及页面关闭清理", async () => {
  const tasks = new GenerationTasks();
  await tasks.run("quiz", () => true, async () => { throw Error("模拟网络失败"); });
  assert.equal(tasks.snapshot("quiz").error, "模拟网络失败");
  let commits = 0;
  await tasks.run("quiz", () => true, async () => () => { commits++; });
  assert.equal(tasks.snapshot("quiz").error, ""); assert.equal(commits, 1);
  const gate = deferred<void>();
  const done = tasks.run("quiz", () => true, async () => { await gate.promise; return () => { commits++; }; });
  await Promise.resolve(); tasks.dispose(); gate.resolve(); await done;
  assert.equal(commits, 1);
});

test("离开旧任务后仍读取其作用域，任务删除不能回落到默认模块", () => {
  const state = fixture();
  state.workspaces[0].activeTaskId = "other-task";
  assert.equal(readGenerationTarget(state, { workspaceId: "A", moduleId: "same-module-id", owner: state.owner })?.mod.input, "材料");
  assert.equal(readGenerationTarget(state, { workspaceId: "A", moduleId: "same-module-id", taskId: "deleted-task", owner: state.owner }), undefined);
});
