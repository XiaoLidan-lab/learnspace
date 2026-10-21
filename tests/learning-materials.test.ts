import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  learningMaterials,
  chooseMaterials,
  materialEdges,
  workspaceMaterials,
} from "../src/learningMaterials";
import { prepareLearningInput } from "../src/materialInput";
import { prepareChatContext } from "../src/chatContext";
import { cloudPayload, parseCloudPayload, cloudCopy } from "../src/cloudData";
import {
  uid,
  safeTemplate,
  fromTemplate,
  type Workspace,
  type Mod,
  type Note,
} from "../src/model";
import {
  taskFromPlan,
  addTask,
  activateTask,
  projectWorkspace,
  updateModule,
} from "../src/tasks";
import { scheduleQuickRun } from "../src/useQuickRun";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const mod = (type: Mod["type"], id = uid()): Mod => ({
  id,
  type,
  title: type,
  layout: { x: 0, y: 0, w: 6, h: 8 },
});
function fixture() {
  const source = mod("note"),
    target = mod("quiz"),
    other = mod("note");
  const workspace: Workspace = {
    id: uid(),
    title: "材料选择合成验收",
    description: "",
    createdAt: 0,
    updatedAt: 0,
    isolationVersion: 1,
    modules: [source, target, other],
  };
  workspace.modules.forEach((m, i) => {
    m.layout.y = i * 8;
  });
  const note: Note = {
    id: uid(),
    moduleId: source.id,
    workspaceId: workspace.id,
    content: "合成知识点：七轮复习，每轮九分钟。",
    contentKind: "user",
    sources: [],
  };
  return {
    source,
    target,
    note,
    ctx: {
      workspace,
      notes: [
        note,
        {
          ...note,
          id: uid(),
          taskId: "other-task",
          content: "不应读取的任务资料",
        },
      ],
      resources: [],
      selection: null,
    },
  };
}
test("材料只显示当前任务的具体笔记，不包括自己、辅助工具及其他任务", () => {
  const { target, note, ctx } = fixture();
  ctx.workspace.modules.push(mod("pomodoro"));
  const items = learningMaterials(target, ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].source.noteId, note.id);
});
test("确认选择后执行时读取指定材料，允许保留手动草稿或切回材料；取消不修改", async () => {
  const { target, ctx } = fixture();
  const before = structuredClone(ctx.workspace);
  const items = learningMaterials(target, ctx);
  assert.deepEqual(ctx.workspace, before);
  const refs = chooseMaterials(target, ctx, items);
  assert.deepEqual(ctx.workspace, before);
  target.input = "手动草稿";
  target.data = {
    flow: { inputs: [], materials: refs, materialMode: "sources" },
  };
  let result = await prepareLearningInput(target, ctx);
  assert.match(result.material.input!, /七轮复习/);
  target.data.flow!.materialMode = "manual";
  result = await prepareLearningInput(target, ctx);
  assert.equal(result.material.input, "手动草稿");
});
test("新材料预设优先于旧连接；清空预设不会偷偷恢复旧连接", () => {
  const { target, source, ctx } = fixture();
  ctx.workspace.connections = [
    {
      id: uid(),
      source: { moduleId: source.id, port: "note", noteId: ctx.notes[0].id },
      target: { moduleId: target.id, field: "input" },
      mode: "replace",
      trigger: "manual",
    },
  ];
  assert.equal(materialEdges(target, ctx.workspace).length, 1);
  target.data = { flow: { inputs: [], materials: [] } };
  assert.equal(materialEdges(target, ctx.workspace).length, 0);
  assert.equal(workspaceMaterials(ctx.workspace).length, 0);
});
test("材料保存经过端口和循环校验，不接受同一内容的重复选择", () => {
  const { target, source, ctx } = fixture();
  const item = learningMaterials(target, ctx)[0];
  assert.throws(() => chooseMaterials(target, ctx, [item, item]), /重复/);
  source.data = {
    flow: {
      inputs: [],
      materials: [
        {
          id: uid(),
          source: { moduleId: target.id, port: "results" },
          target: { moduleId: source.id, field: "append" },
          trigger: "manual",
          mode: "replace",
        },
      ],
    },
  };
  assert.throws(() => chooseMaterials(target, ctx, [item]), /循环引用/);
});
test("材料设置可云端往返，模板脱敏后重映射且不包含笔记正文", () => {
  const { target, ctx, note } = fixture();
  const refs = chooseMaterials(target, ctx, learningMaterials(target, ctx));
  target.data = {
    flow: { inputs: [], materials: refs, materialMode: "sources" },
  };
  const payload = cloudPayload(ctx.workspace, [note]);
  const restored = parseCloudPayload(payload);
  assert.deepEqual(restored.workspace.modules[1].data?.flow?.materials, refs);
  const copy = cloudCopy(payload);
  assert.notEqual(
    copy.workspace.modules[1].data?.flow?.materials?.[0].source.noteId,
    note.id,
  );
  const t = safeTemplate(ctx.workspace);
  assert(!JSON.stringify(t).includes(note.content));
  assert.equal(t.connections?.[0].source.needsBinding, true);
  const installed = fromTemplate(t);
  assert.notEqual(installed.connections?.[0].source.moduleId, sourceId(refs));
});
function sourceId(refs: ReturnType<typeof chooseMaterials>) {
  return refs[0].source.moduleId;
}
test("材料选择保存在任务状态，切换后不串用具体笔记", async () => {
  const { target, ctx } = fixture();
  target.data = {
    flow: {
      inputs: [],
      materials: chooseMaterials(target, ctx, learningMaterials(target, ctx)),
      materialMode: "sources",
    },
  };
  const task = taskFromPlan(
    {
      goal: "合成任务",
      steps: [
        {
          title: "复习",
          description: "对照材料",
          moduleTypes: ["note", "quiz"],
        },
      ],
      moduleRoles: [],
      layoutReason: "合成测试布局",
    },
    ctx.workspace.modules,
  );
  let w = addTask(ctx.workspace, task);
  const projected = projectWorkspace(w);
  assert.equal(projected.modules[1].data?.flow?.materials, undefined);
  w = activateTask(w, undefined);
  assert.equal(
    projectWorkspace(w).modules[1].data?.flow?.materials?.[0].source.noteId,
    ctx.notes[0].id,
  );
});
test("快捷操作只执行一次，React 挂载清理不吞掉操作，也不在刷新后重放", async () => {
  const pending = new Set(["target"]);
  let calls = 0;
  const cancel = scheduleQuickRun(pending, "target", false, () => calls++);
  cancel();
  scheduleQuickRun(pending, "target", false, () => calls++);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(pending.size, 0);
  scheduleQuickRun(pending, "target", false, () => calls++);
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("明确保存的文件选区可在刷新后恢复使用，但旧文件版本和其他任务不能冒用", async () => {
  const { readConnection } = await import("../src/connections");
  const { target, ctx } = fixture();
  const file = mod("pdf");
  file.resourceId = uid();
  ctx.workspace.modules.push(file);
  const resource = {
    id: file.resourceId,
    version: "v1",
    name: "合成.txt",
    file: new Blob(["选中内容 KEY-112"]),
    createdAt: 0,
  };
  const selection = {
    moduleId: file.id,
    resourceId: resource.id,
    resourceName: resource.name,
    kind: "pdf" as const,
    version: resource.version,
    text: "选中内容 KEY-112",
    page: 1,
    createdAt: 0,
  };
  const c = { ...ctx, resources: [resource], selection };
  const item = learningMaterials(target, c).find((i) => i.file)!;
  const refs = chooseMaterials(target, c, [item]);
  const snapshot = await readConnection(refs[0], c);
  target.data = {
    flow: { inputs: [snapshot], materials: refs, materialMode: "sources" },
  };
  const restored = await prepareLearningInput(target, {
    ...c,
    selection: null,
  });
  assert.match(restored.material.input!, /KEY-112/);
  await assert.rejects(
    prepareLearningInput(target, {
      ...c,
      selection: null,
      resources: [{ ...resource, version: "v2" }],
    }),
    /选择/,
  );
  await assert.rejects(
    prepareLearningInput(target, {
      ...c,
      selection: null,
      workspace: { ...ctx.workspace, activeTaskId: "another-task" },
    }),
    /选择/,
  );
});
