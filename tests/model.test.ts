import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
import {
  builtins,
  fromTemplate,
  safeTemplate,
  templateSchema,
} from "../src/model";
test("所有内置模板满足网格约束且不重叠", () => {
  for (const b of builtins) {
    assert.equal(
      templateSchema.safeParse(safeTemplate(fromTemplate(b))).success,
      true,
    );
  }
});
test("模板导出严格过滤 PDF、聊天、笔记、来源和凭证", () => {
  const w = fromTemplate(builtins[0]);
  w.modules[0] = {
    ...w.modules[0],
    resourceId: "private-file",
    input: "private-text",
    source: { resourceId: "secret", version: "v1", page: 2, text: "secret" },
    messages: [{ role: "user", content: "private-chat" }],
  };
  const text = JSON.stringify(safeTemplate(w));
  assert(!text.includes("private-"));
  assert(!text.includes("secret"));
  assert.equal(templateSchema.parse(JSON.parse(text)).version, 1);
});
test("非法类型、额外字段、越界、重叠与超过上限模块均被拒绝", () => {
  const base = safeTemplate(fromTemplate(builtins[0]));
  for (const invalid of [
    { ...base, apiKey: "secret" },
    { ...base, version: 2 },
    { ...base, modules: [{ ...base.modules[0], type: "script" }] },
    {
      ...base,
      modules: [{ ...base.modules[0], layout: { x: 10, y: 0, w: 6, h: 4 } }],
    },
    { ...base, modules: Array(25).fill(base.modules[0]) },
    { ...base, modules: [base.modules[0], base.modules[0]] },
  ])
    assert.equal(templateSchema.safeParse(invalid).success, false);
});
test("安装模板使用独立实例，不复制私有绑定", () => {
  const a = fromTemplate(builtins[0]),
    b = fromTemplate(builtins[0]);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.modules[0].id, b.modules[0].id);
  a.modules[0].layout.w = 3;
  assert.equal(b.modules[0].layout.w, 6);
  assert.equal(b.modules[0].resourceId, undefined);
});
