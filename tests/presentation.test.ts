import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/MarkdownContent";
import { layoutResultSchema, validateLayoutPlan } from "../src/layoutPlan";
import { builtins, templateSchema } from "../src/model";
test("Markdown renders bold/list while rejecting HTML and unsafe URLs", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      children:
        "**重点**\n\n- 项目\n\n<script>alert(1)</script>\n\n[危险](javascript:alert)\n\n![图片](https://example.com/x.png)",
    }),
  );
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<li>项目<\/li>/);
  assert(!html.includes("<script"));
  assert(!html.includes("javascript:"));
  assert(!html.includes("<img"));
});
test("Chinese bold punctuation and model whitespace render without markers, code stays literal", () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownContent, {
      children: "以**水（H₂O） **和**二氧化碳（CO₂）**为原料。`**代码 **`",
    }),
  );
  assert.match(html, /<strong>水（H₂O）<\/strong>/);
  assert.match(html, /<strong>二氧化碳（CO₂）<\/strong>/);
  assert.match(html, /<code>\*\*代码 \*\*<\/code>/);
});
test("Task plan validates referenced modules and never becomes a public template field", () => {
  const { id, category, author, color, uses, ...template } = builtins[0];
  const planning = {
    goal: "准备组会分享",
    steps: [
      {
        title: "阅读",
        description: "理解关键观点",
        moduleTypes: [template.modules[0].type],
      },
    ],
    layoutReason: "资料在主区域，成果在侧边",
  };
  assert(layoutResultSchema.safeParse({ ...template, planning }).success);
  assert(
    !layoutResultSchema.safeParse({
      ...template,
      planning: {
        ...planning,
        steps: [{ ...planning.steps[0], moduleTypes: ["calendar"] }],
      },
    }).success,
  );
  assert(!templateSchema.safeParse({ ...template, planning }).success);
});
test("Invalid AI geometry is corrected without losing instances or accepting private fields", () => {
  const { id, category, author, color, uses, ...template } = builtins[0];
  const planning = {
    goal: "阅读论文",
    steps: [
      {
        title: "理解",
        description: "阅读并记录",
        moduleTypes: [template.modules[0].type],
      },
    ],
    layoutReason: "资料为主",
  };
  const modules = template.modules.map((m, i) => ({
    ...m,
    instanceId: `existing-${i}`,
    layout: { x: 0, y: 0, w: 2, h: 6 },
  }));
  const fixed = validateLayoutPlan({ ...template, modules, planning });
  assert(layoutResultSchema.safeParse(fixed).success);
  assert.deepEqual(
    fixed.modules.map((m) => m.instanceId),
    modules.map((m) => m.instanceId),
  );
  assert.match(fixed.planning.layoutReason, /自动校正/);
  assert.throws(() =>
    validateLayoutPlan({
      ...template,
      modules: [{ ...modules[0], data: { text: "private" } }],
      planning,
    }),
  );
});
