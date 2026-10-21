import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { types, type ModuleType } from "../src/definitions";
import { defaultCustomConfig } from "../src/customAI";
import {
  inputPorts,
  outputPorts,
  connectionError,
  directConnection,
  type Port,
} from "../src/connectionGraph";
import {
  readConnection,
  upstreamVersion,
  type Connection,
  type ConnectedInput,
} from "../src/connections";
import { flowPatch, flowInputSignature } from "../src/flowData";
import {
  uid,
  safeTemplate,
  fromTemplate,
  templateSchema,
  type Mod,
  type Workspace,
  type Note,
} from "../src/model";
import { cloudPayload, parseCloudPayload } from "../src/cloudData";
import {
  addTask,
  taskFromPlan,
  activateTask,
  projectWorkspace,
  updateModule,
  reuseTaskContent,
} from "../src/tasks";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const mod = (type: ModuleType, id: string = type): Mod => ({
  id,
  type,
  title: type,
  layout: { x: 0, y: 0, w: 6, h: 8 },
  ...(type === "custom-ai" ? { customConfig: defaultCustomConfig() } : {}),
});
const workspace = (modules: Mod[]): Workspace => ({
  id: uid(),
  isolationVersion: 1,
  title: "合成数据流",
  description: "",
  createdAt: 0,
  updatedAt: 0,
  modules,
});
const context = (w: Workspace, notes: Note[] = []) => ({
  workspace: w,
  notes,
  resources: [],
  selection: null,
});
const edge = (from: Mod, to: Mod, port: Port, field: string): Connection =>
  directConnection([from, to], [], from.id, port, to.id, field, uid());
test("16个标准模块均有声明的输入输出；类型、重复、单来源、多来源、循环均校验", () => {
  for (const t of types) {
    const m = mod(t);
    assert(outputPorts(t).length, `${t}缺少输出`);
    assert(inputPorts(m).length, `${t}缺少输入`);
  }
  const a = mod("text", "a"),
    b = mod("text", "b"),
    chat = mod("chat"),
    custom = mod("custom-ai");
  const first = directConnection(
    [a, b, chat],
    [],
    a.id,
    "text",
    chat.id,
    "context",
    "c1",
  );
  const second = directConnection(
    [a, b, chat],
    [first],
    b.id,
    "text",
    chat.id,
    "context",
    "c2",
  );
  assert.equal(connectionError([a, b, chat], [first, second]), undefined);
  assert.throws(
    () =>
      directConnection(
        [a, chat],
        [first],
        a.id,
        "text",
        chat.id,
        "context",
        "dup",
      ),
    /重复/,
  );
  assert.throws(
    () =>
      directConnection([a, mod("pdf")], [], a.id, "text", "pdf", "file", "bad"),
    /不匹配/,
  );
  const single = directConnection(
    [a, b, custom],
    [],
    a.id,
    "text",
    custom.id,
    "paper",
    "single",
  );
  assert.throws(
    () =>
      directConnection(
        [a, b, custom],
        [single],
        b.id,
        "text",
        custom.id,
        "paper",
        "single2",
      ),
    /只允许/,
  );
  const summary = mod("summary"),
    note = mod("note");
  const e1 = edge(summary, note, "output", "append"),
    e2 = edge(note, summary, "note", "input");
  assert.match(connectionError([summary, note], [e1, e2])!, /依赖环/);
  assert.throws(
    () => directConnection([a], [], a.id, "text", a.id, "append", "self"),
    /端点/,
  );
  assert(!a.data, "连线不读取或修改内容");
});
test("多来源问答保留独立快照和问题；总结、翻译手动取数不触发AI且保留旧结果", async () => {
  const a = { ...mod("text", "a"), data: { text: "原始合成资料A" } },
    b = { ...mod("text", "b"), data: { text: "用户合成资料B" } },
    chat = { ...mod("chat"), input: "我的问题" };
  const w = workspace([a, b, chat]);
  w.connections = [
    edge(a, chat, "text", "context"),
    edge(b, chat, "text", "context"),
  ];
  const packets = await Promise.all(
    w.connections.map((e) => readConnection(e, context(w))),
  );
  const result = flowPatch(chat, w.connections, packets, w.id, undefined);
  assert.equal(result.patch.input, undefined);
  assert.equal(chat.input, "我的问题");
  assert.equal(result.patch.data!.flow!.inputs.length, 2);
  const translation = {
    ...mod("translate"),
    input: "旧输入",
    output: "旧译文",
    data: { autoTranslate: true, autoSync: true },
  };
  const c = edge(a, translation, "text", "input"),
    tw = workspace([a, translation]);
  tw.connections = [c];
  const packet = await readConnection(c, context(tw));
  const translated = flowPatch(
    translation,
    [c],
    [packet],
    tw.id,
    undefined,
  ).patch;
  assert.equal(translated.data!.autoTranslate, false);
  assert.equal(translated.data!.autoSync, false);
  assert.equal(translated.output, undefined);
  assert.equal(translated.data!.flow!.previousOutput!.text, "旧译文");
  assert.equal(translation.output, "旧译文");
  assert.notEqual(
    flowInputSignature(translation),
    flowInputSignature({ ...translation, output: "新结果" }),
  );
});
test("指定篇目、来源任务及输入快照作用域校验；切换任务不取其他篇目", async () => {
  const source = mod("note", "source"),
    target = mod("note", "target");
  const w = workspace([source, target]);
  const c = edge(source, target, "note", "append");
  assert(c.source.needsBinding);
  w.connections = [c];
  await assert.rejects(() => readConnection(c, context(w)), /尚未绑定/);
  const note: Note = {
    id: "n",
    workspaceId: w.id,
    moduleId: source.id,
    taskId: "task-a",
    content: "合成笔记",
    sources: [],
    contentKind: "user",
  };
  const bound = {
    ...c,
    source: { moduleId: source.id, port: "note" as const, noteId: note.id },
  };
  await assert.rejects(
    () =>
      readConnection(bound, context({ ...w, activeTaskId: "task-b" }, [note])),
    /当前任务/,
  );
  const packet = await readConnection(
    bound,
    context({ ...w, activeTaskId: "task-a" }, [note]),
  );
  assert.throws(
    () => flowPatch(target, [bound], [packet], w.id, "task-b"),
    /任务已变化/,
  );
  const existing = { ...note, moduleId: target.id };
  const applied = flowPatch(target, [bound], [packet], w.id, "task-a", {
    note: existing,
  });
  assert.equal(applied.note!.id, existing.id);
  assert(applied.note!.content.includes("合成笔记"));
  assert.equal(applied.note!.taskId, "task-a");
  assert.throws(
    () => flowPatch(target, [bound], [packet], w.id, "task-a", { note }),
    /不属于/,
  );
});
test("结构化卡片、导图、待办和日程按原类型读取及应用；不接受伪造类型", async () => {
  const cards = {
      ...mod("cards", "cards-a"),
      data: { cards: [{ id: "card1", front: "Q", back: "A" }] },
    },
    dest = mod("cards", "cards-b");
  const cw = workspace([cards, dest]);
  const c = edge(cards, dest, "cards", "import");
  cw.connections = [c];
  const result = flowPatch(
    dest,
    [c],
    [await readConnection(c, context(cw))],
    cw.id,
    undefined,
  );
  assert.equal(result.patch.data!.cards![0].front, "Q");
  assert.notEqual(result.patch.data!.cards![0].id, "card1");
  const map = {
      ...mod("mindmap", "map-a"),
      data: {
        nodes: [
          { id: "root", text: "root", x: 0, y: 0 },
          { id: "child", parentId: "root", text: "child", x: 20, y: 20 },
        ],
      },
    },
    mapDest = mod("mindmap", "map-b");
  const mw = workspace([map, mapDest]);
  const mc = edge(map, mapDest, "outline", "import");
  const mapped = flowPatch(
    mapDest,
    [mc],
    [await readConnection(mc, context(mw))],
    mw.id,
    undefined,
  ).patch.data!.nodes!;
  assert.equal(mapped[1].parentId, mapped[0].id);
  assert.notEqual(mapped[0].id, "root");
  const todo = {
      ...mod("todo"),
      data: { tasks: [{ id: "t1", text: "复习合成概念", done: false }] },
    },
    calendar = mod("calendar");
  const dw = workspace([todo, calendar]);
  const dc = edge(todo, calendar, "tasks", "schedule"),
    packet = await readConnection(dc, context(dw));
  assert.throws(() =>
    flowPatch(calendar, [dc], [packet], dw.id, undefined, {
      date: "2026-02-31",
    }),
  );
  const scheduled = flowPatch(calendar, [dc], [packet], dw.id, undefined, {
    date: "2026-10-20",
    time: "09:30",
  });
  assert.equal(scheduled.patch.data!.events![0].date, "2026-10-20");
});
test("媒体只传文件引用；网页仅安全网址；视频不伪造字幕；计时不伪造完成记录", async () => {
  const image = {
      ...mod("image", "image-a"),
      data: { mediaResourceId: "image-resource" },
    },
    dest = mod("image", "image-b");
  const iw = workspace([image, dest]);
  const ic = edge(image, dest, "image_ref", "file");
  const resource = {
    id: "image-resource",
    name: "synthetic.png",
    version: "v1",
    createdAt: 0,
    file: new File(["fake"], "synthetic.png", { type: "image/png" }),
  };
  const packet = await readConnection(ic, {
    ...context(iw),
    resources: [resource],
  });
  assert.equal(
    flowPatch(dest, [ic], [packet], iw.id, undefined).patch.data!
      .mediaResourceId,
    resource.id,
  );
  const web = { ...mod("web", "web-a"), data: { url: "javascript:alert(1)" } },
    webDest = mod("web", "web-b"),
    wc = edge(web, webDest, "web_url", "url");
  await assert.rejects(() =>
    readConnection(wc, context(workspace([web, webDest]))),
  );
  const video = mod("video"),
    summary = mod("summary"),
    vc = edge(video, summary, "transcript", "input");
  await assert.rejects(
    () => readConnection(vc, context(workspace([video, summary]))),
    /为空/,
  );
  const timer = {
      ...mod("pomodoro"),
      data: { timer: { mode: "focus" as const, remaining: 1500 } },
    },
    note = mod("note"),
    tc = edge(timer, note, "timer", "append");
  const tw = workspace([timer, note]);
  const tp = await readConnection(tc, context(tw));
  assert(tp.text.includes("不是已完成"));
  assert.equal((timer.data.timer as { endsAt?: number }).endsAt, undefined);
});
test("测验提交后才能输出结果；简答题不自动评分", async () => {
  const quiz = {
      ...mod("quiz"),
      data: {
        quiz: [
          {
            id: "q1",
            type: "short" as const,
            question: "解释合成概念",
            answer: "参考",
            explanation: "参考解析",
          },
        ],
        answers: { q1: "作答" },
        submitted: false,
      },
    },
    note = mod("note");
  const w = workspace([quiz, note]),
    c = edge(quiz, note, "results", "append");
  await assert.rejects(() => readConnection(c, context(w)), /先提交/);
  quiz.data.submitted = true;
  const p = await readConnection(c, context(w));
  assert.equal(JSON.parse(p.text)[0].correct, "未评分");
});
test("新增连接和取用记录可云端序列化恢复，模板只携带关系与重映射端点", async () => {
  const a = {
      ...mod("text", "a"),
      layout: { x: 0, y: 0, w: 6, h: 8 },
      data: { text: "PRIVATE_SYNTHETIC" },
    },
    b = { ...mod("chat", "b"), layout: { x: 6, y: 0, w: 6, h: 8 } };
  let w = workspace([a, b]);
  const c = edge(a, b, "text", "context");
  w.connections = [c];
  const packet = await readConnection(c, context(w));
  w = {
    ...w,
    modules: [
      a,
      { ...b, ...flowPatch(b, [c], [packet], w.id, undefined).patch },
    ],
  };
  const restored = parseCloudPayload(cloudPayload(w, []));
  assert.equal(
    restored.workspace.modules[1].data!.flow!.inputs[0].text,
    "PRIVATE_SYNTHETIC",
  );
  const exported = templateSchema.parse(safeTemplate(w));
  assert(!JSON.stringify(exported).includes("PRIVATE_SYNTHETIC"));
  const installed = fromTemplate(exported);
  assert.equal(
    installed.connections![0].source.moduleId,
    installed.modules[0].id,
  );
  assert.equal(
    installed.connections![0].target.moduleId,
    installed.modules[1].id,
  );
  assert(!installed.modules[1].data);
  const wrong = structuredClone(cloudPayload(w, []));
  wrong.workspace.modules[1].data!.flow!.inputs[0].connection!.taskId =
    "another-task";
  assert.throws(() => parseCloudPayload(wrong), /归属无效/);
});

test("任务切换保存各自连接输入，显式复用只复制内容并解除实时来源关系", async () => {
  const a = { ...mod("text", "a"), layout: { x: 0, y: 0, w: 6, h: 8 } },
    b = { ...mod("chat", "b"), layout: { x: 6, y: 0, w: 6, h: 8 } };
  let w = workspace([a, b]);
  const c = edge(a, b, "text", "context");
  w.connections = [c];
  const plan = {
    goal: "合成任务A",
    steps: [
      {
        title: "理解",
        description: "解释合成概念",
        moduleTypes: ["text" as const, "chat" as const],
      },
    ],
    layoutReason: "合成布局",
  };
  const first = taskFromPlan(plan, w.modules);
  w = addTask(w, first);
  w = updateModule(w, a.id, { data: { text: "TASK_A_ONLY" } }, first.id);
  const projected = projectWorkspace(w);
  const packet = await readConnection(c, context(projected));
  w = updateModule(
    w,
    b.id,
    flowPatch(projected.modules[1], [c], [packet], w.id, first.id).patch,
    first.id,
  );
  const second = taskFromPlan({ ...plan, goal: "合成任务B" }, w.modules);
  w = addTask(w, second);
  assert.equal(projectWorkspace(w).modules[1].data?.flow, undefined);
  const restored = parseCloudPayload(cloudPayload(w, [])).workspace;
  assert.equal(
    projectWorkspace(activateTask(restored, first.id)).modules[1].data!.flow!
      .inputs[0].text,
    "TASK_A_ONLY",
  );
  const reused = reuseTaskContent(w, [], first.id).workspace;
  assert.equal(
    projectWorkspace(reused).modules[1].data!.flow!.inputs[0].text,
    "TASK_A_ONLY",
  );
  assert.equal(
    projectWorkspace(reused).modules[1].data!.flow!.inputs[0].connection,
    undefined,
    "复制后不能当作本任务实时取用",
  );
  assert.doesNotThrow(() => parseCloudPayload(cloudPayload(reused, [])));
});
