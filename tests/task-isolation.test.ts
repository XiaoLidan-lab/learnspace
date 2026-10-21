import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { fromTemplate, builtins, type Note } from "../src/model";
import {
  addTask,
  taskFromPlan,
  projectWorkspace,
  updateModule,
  scopedNotes,
  activateTask,
  migrateTaskContent,
  reuseTaskContent,
  changeStructure,
  artifactCandidates,
} from "../src/tasks";
import { store } from "../src/storage";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const plan = {
  goal: "合成学习",
  steps: [
    {
      title: "理解",
      description: "理解并记录",
      moduleTypes: ["note" as const],
    },
  ],
  layoutReason: "资料与笔记",
};
test("任务切换隔离正文与状态，异步旧会话写入不会污染新任务，布局仍共享", () => {
  let w = fromTemplate(builtins[0]);
  const m = w.modules.find((m) => m.type === "chat")!;
  w = updateModule(w, m.id, { input: "free content" });
  const a = taskFromPlan(plan, w.modules),
    b = taskFromPlan(plan, w.modules);
  w = addTask(w, a);
  assert.equal(
    projectWorkspace(w).modules.find((x) => x.id === m.id)!.input,
    undefined,
  );
  w = updateModule(w, m.id, {
    input: "task A",
    data: {
      cards: [{ id: "a", front: "A", back: "A answer" }],
      quiz: [
        {
          id: "q",
          type: "short",
          question: "A",
          answer: "A",
          explanation: "A",
        },
      ],
      answers: { q: "A" },
    },
  });
  w = addTask(w, b);
  assert.equal(
    projectWorkspace(w).modules.find((x) => x.id === m.id)!.data,
    undefined,
  );
  w = updateModule(w, m.id, { input: "late A" }, a.id);
  assert.equal(
    projectWorkspace(w).modules.find((x) => x.id === m.id)!.input,
    undefined,
  );
  w = updateModule(w, m.id, { input: "task B" });
  w = activateTask(w, a.id);
  assert.equal(
    projectWorkspace(w).modules.find((x) => x.id === m.id)!.input,
    "late A",
  );
  assert.equal(
    projectWorkspace(w).modules.find((x) => x.id === m.id)!.data?.answers?.q,
    "A",
  );
  const view = projectWorkspace(w);
  view.modules[0] = { ...view.modules[0], title: "shared title" };
  w = changeStructure(w, view.modules);
  w = activateTask(w, b.id);
  assert.equal(projectWorkspace(w).modules[0].title, "shared title");
  assert.equal(
    projectWorkspace(activateTask(w)).modules.find((x) => x.id === m.id)!.input,
    "free content",
  );
});
test("第一阶段共享数据升级保持原件、任务副本和成果快照，迁移可重复", async () => {
  let w = fromTemplate(builtins[0]);
  delete w.isolationVersion;
  const a = taskFromPlan(plan, w.modules),
    b = taskFromPlan(plan, w.modules);
  delete a.moduleStates;
  delete b.moduleStates;
  w = { ...w, tasks: [{ ...a, status: "paused" }, b], activeTaskId: b.id };
  const m = w.modules.find((m) => m.type === "note")!;
  const n: Note = {
    id: crypto.randomUUID(),
    workspaceId: w.id,
    moduleId: m.id,
    content: "legacy note",
    sources: [],
  };
  m.activeNoteId = n.id;
  const migrated = migrateTaskContent(w, [n]);
  assert.equal(migrated.notes.length, 3);
  assert.equal(migrated.notes[0].taskId, undefined);
  assert.equal(
    scopedNotes(migrated.workspace, migrated.notes)[0].content,
    "legacy note",
  );
  assert.equal(
    migrateTaskContent(migrated.workspace, migrated.notes).notes.length,
    3,
  );
  await store.saveSnapshot([migrated.workspace], migrated.notes);
  assert.deepEqual(
    (await store.workspaces()).find((x) => x.id === w.id)?.tasks,
    migrated.workspace.tasks,
  );
});
test("主动复用创建独立笔记及模块状态，之后编辑不影响来源", () => {
  let w = fromTemplate(builtins[0]);
  const a = taskFromPlan(plan, w.modules),
    b = taskFromPlan(plan, w.modules);
  w = addTask(w, a);
  const m = w.modules.find((x) => x.type === "note")!;
  const n: Note = {
    id: crypto.randomUUID(),
    workspaceId: w.id,
    moduleId: m.id,
    taskId: a.id,
    content: "source",
    sources: [],
  };
  w = updateModule(w, m.id, {
    activeNoteId: n.id,
    data: { text: "source state" },
  });
  w = addTask(w, b);
  assert.equal(artifactCandidates(projectWorkspace(w), [n]).length, 0);
  const copied = reuseTaskContent(w, [n], a.id);
  assert.equal(copied.notes.length, 2);
  assert.notEqual(copied.notes[1].id, n.id);
  assert.equal(copied.notes[1].taskId, b.id);
  const edited = updateModule(copied.workspace, m.id, {
    data: { text: "B changed" },
  });
  assert.equal(
    projectWorkspace(activateTask(edited, a.id)).modules.find(
      (x) => x.id === m.id,
    )!.data?.text,
    "source state",
  );
});
