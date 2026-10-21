import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UtilityDock } from "../src/UtilityDock";
import { WorkspaceEditor } from "../src/WorkspaceEditor";
import { WorkspaceBus } from "../src/events";
import { isUtilityTool, timerLabel, timerRemaining } from "../src/utilityTools";
import { arrange, parkUtilityModules, overlaps } from "../src/layout";
import {
  fromTemplate,
  uid,
  safeTemplate,
  templateSchema,
  type Mod,
  type Workspace,
} from "../src/model";
import type { ModuleProps } from "../src/moduleProps";
import { store } from "../src/storage";
import {
  addTask,
  taskFromPlan,
  updateModule,
  projectWorkspace,
  changeStructure,
} from "../src/tasks";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
const module = (type: Mod["type"], id = uid()): Mod => ({
  id,
  type,
  title: type,
  layout: { x: 0, y: 0, w: 6, h: 8 },
});
function props(modules: Mod[]) {
  const workspace = {
    id: uid(),
    modules,
    title: "合成角落工具",
    description: "",
    createdAt: 0,
    updatedAt: 0,
  } as Workspace;
  const bus = new WorkspaceBus(workspace.id);
  const moduleProps = (mod: Mod) =>
    ({
      mod,
      workspace,
      bus,
      workspaceId: workspace.id,
      resources: [],
      notes: [],
      notify: () => {},
      update: () => {},
    }) as unknown as ModuleProps;
  return {
    modules,
    bus,
    moduleProps,
    edit: false,
    remove: () => {},
    notify: () => {},
    workspace,
  };
}
test("dock is absent unless a utility was selected; only selected types produce icons, duplicate instances share one icon", () => {
  assert.equal(
    renderToStaticMarkup(createElement(UtilityDock, props([module("pdf")]))),
    "",
  );
  const html = renderToStaticMarkup(
    createElement(UtilityDock, props([module("todo"), module("todo")])),
  );
  assert.equal((html.match(/aria-label="打开待办清单"/g) || []).length, 1);
  assert(!html.includes('aria-label="打开日历"'));
  assert(!html.includes('aria-label="打开番茄钟"'));
  assert.match(html, /辅助工具面板.*hidden/);
});
test("selected utilities stay out of the canvas and main modules remain in place", () => {
  const modules = [
    module("note"),
    module("todo"),
    module("calendar"),
    module("pomodoro"),
  ];
  const p = props(modules);
  const html = renderToStaticMarkup(
    createElement(WorkspaceEditor, {
      workspace: p.workspace,
      edit: false,
      add: () => {},
      change: () => {},
      duplicate: () => {},
      moduleProps: p.moduleProps,
      notify: () => {},
      ai: () => {},
      openModuleLibrary: () => {},
    }),
  );
  assert(html.includes(`data-module-id="${modules[0].id}"`));
  for (const m of modules.slice(1))
    assert(!html.includes(`data-module-id="${m.id}"`));
  assert(html.includes('aria-label="打开日历"'));
});
test("timer summary derives from persisted end time and supports paused values", () => {
  const timer = module("pomodoro");
  timer.data = { timer: { mode: "focus", endsAt: 61000, remaining: 100 } };
  assert.equal(timerRemaining(timer, 1000), 60);
  assert.equal(timerLabel(timer, 1000), "01:00");
  assert.equal(timerRemaining(timer, 62000), 0);
  timer.data.timer!.endsAt = undefined;
  assert.equal(timerLabel(timer, 999999), "01:40");
  assert(isUtilityTool("todo"));
  assert(!isUtilityTool("note"));
});
test("layouts do not reserve learning columns for utilities; state, task isolation, templates and refresh remain compatible", async () => {
  const pdf = module("pdf"),
    todo = module("todo"),
    calendar = module("calendar"),
    timer = module("pomodoro");
  todo.data = { tasks: [{ id: uid(), text: "自由模式待办", done: false }] };
  calendar.data = {
    events: [
      { id: uid(), date: "2026-10-19", time: "10:00", title: "合成日程" },
    ],
  };
  timer.data = {
    timer: { mode: "focus", endsAt: Date.now() + 90000, remaining: 90 },
  };
  const modules = arrange([pdf, todo, calendar, timer], "按用途");
  assert.equal(modules[0].layout.w, 12);
  for (const m of modules.filter((m) => isUtilityTool(m.type))) {
    assert.equal(m.layout.w, 3);
    assert.equal(m.layout.h, 3);
  }
  for (let i = 0; i < modules.length; i++)
    for (let j = i + 1; j < modules.length; j++)
      assert(!overlaps(modules[i].layout, modules[j].layout));
  assert.equal(modules[1].data, todo.data);
  let w = {
    id: uid(),
    title: "工具合成验证",
    description: "",
    modules,
    createdAt: 0,
    updatedAt: 0,
  } as Workspace;
  const plan = {
    goal: "完成合成事项",
    steps: [
      {
        title: "练习",
        description: "记录结果",
        moduleTypes: ["todo" as const],
      },
    ],
    layoutReason: "角落工具",
  };
  const a = taskFromPlan(plan, w.modules),
    b = taskFromPlan(plan, w.modules);
  w = addTask(w, a);
  w = updateModule(w, todo.id, {
    data: { tasks: [{ id: uid(), text: "任务A", done: false }] },
  });
  w = addTask(w, b);
  w = updateModule(w, todo.id, {
    data: { tasks: [{ id: uid(), text: "任务B", done: true }] },
  });
  w = changeStructure(w, parkUtilityModules(projectWorkspace(w).modules));
  await store.save(w);
  const restored = (await store.workspaces()).find((x) => x.id === w.id)!;
  const text = (task: string) =>
    projectWorkspace({ ...restored, activeTaskId: task }).modules.find(
      (m) => m.id === todo.id,
    )?.data?.tasks?.[0].text;
  assert.equal(text(a.id), "任务A");
  assert.equal(text(b.id), "任务B");
  assert.equal(
    restored.modules.find((m) => m.id === todo.id)?.data?.tasks?.[0].text,
    "自由模式待办",
  );
  const template = safeTemplate(restored);
  assert(templateSchema.safeParse(template).success);
  const installed = fromTemplate(template);
  assert.equal(
    installed.modules.filter((m) => isUtilityTool(m.type)).length,
    3,
  );
});
