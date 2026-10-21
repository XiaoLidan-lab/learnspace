import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
import { definitions, types, categories } from "../src/definitions";
import { WorkspaceBus } from "../src/events";
import {
  fromTemplate,
  builtins,
  safeTemplate,
  templateSchema,
  type Mod,
} from "../src/model";
import {
  arrange,
  stackModules,
  unstack,
  restoreStructure,
  applyPlan,
  splitModules,
} from "../src/layout";
test("既有 16 种模块与新增自定义 AI 模块注册", () => {
  assert.equal(types.length, 17);
  for (const c of categories)
    assert(types.some((t) => definitions[t].category === c));
  assert.equal(definitions.cards.category, "练习巩固");
  assert.equal(definitions.note.category, "理解与整理");
  assert.equal(definitions.pdf.category, "内容来源");
  assert.equal(definitions.pomodoro.category, "辅助工具");
});
test("事件仅限工作台，去重并阻止递归事件循环", () => {
  const a = new WorkspaceBus("a"),
    b = new WorkspaceBus("b");
  let count = 0;
  a.on("selection.changed", (s) => {
    count++;
    a.emit("selection.changed", s);
  });
  const s = {
    moduleId: "m",
    text: "hello",
    resourceId: "r",
    version: "v",
    page: 1,
    createdAt: 1,
  };
  a.emit("selection.changed", s);
  a.emit("selection.changed", s);
  assert.equal(count, 1);
  assert.equal(b.selection, null);
  a.emit("selection.changed", { ...s, start: 5, end: 10 });
  assert.equal(count, 2);
  a.emit("selection.cleared", {});
  assert.equal(a.selection, null);
});
test("所有布局预设保持内容，网格合法", () => {
  const w = fromTemplate(builtins[0]);
  w.modules[0].data = {
    text: "private",
    timer: { mode: "focus", remaining: 60, endsAt: 123 },
  };
  for (const preset of ["双栏", "三栏", "四宫格", "主次", "自适应"] as const) {
    const modules = arrange(w.modules, preset);
    assert.equal(modules[0].data, w.modules[0].data);
    assert.equal(
      templateSchema.safeParse(safeTemplate({ ...w, modules })).success,
      true,
    );
  }
});
test("堆叠、拆分和布局恢复不会撤销模块内容", () => {
  const w = fromTemplate(builtins[0]);
  let modules = stackModules(w.modules, w.modules[0].id, w.modules[1].id);
  assert.equal(modules[0].group, modules[1].group);
  assert.equal(
    templateSchema.safeParse(safeTemplate({ ...w, modules })).success,
    true,
  );
  modules = unstack(modules, modules[0].id);
  assert.equal(
    templateSchema.safeParse(safeTemplate({ ...w, modules })).success,
    true,
  );
  const cache = new Map([
    [w.modules[0].id, { ...w.modules[0], data: { text: "new content" } }],
  ]);
  assert.equal(restoreStructure(w.modules, cache)[0].data?.text, "new content");
});
test("AI 用实例 ID 保留多个同类型模块的内容", () => {
  const base = fromTemplate(builtins[3]);
  base.modules[0].data = { text: "A" };
  base.modules[1].data = { text: "B" };
  const t = safeTemplate(base);
  t.modules[0].instanceId = base.modules[1].id;
  t.modules[1].instanceId = base.modules[0].id;
  const result = applyPlan(base.modules, t);
  assert.equal(result[0].data?.text, "B");
  assert.equal(result[1].data?.text, "A");
});
test("AI 草案新增同类型实例不会继承被移除模块的私人内容", () => {
  const base = fromTemplate(builtins[3]);
  base.modules[0].data = { text: "private A" };
  base.modules[1].data = { text: "private B" };
  const t = safeTemplate(base);
  t.modules[0].instanceId = base.modules[0].id;
  const result = applyPlan(base.modules, t);
  assert.equal(result[0].data?.text, "private A");
  assert.equal(result[1].data, undefined);
  assert.notEqual(result[1].id, base.modules[1].id);
});
test("分屏布局没有重叠", () => {
  const base = fromTemplate(builtins[0]);
  const modules = splitModules(
    base.modules,
    base.modules[2].id,
    base.modules[0].id,
    "右",
  );
  assert(templateSchema.safeParse(safeTemplate({ ...base, modules })).success);
});
