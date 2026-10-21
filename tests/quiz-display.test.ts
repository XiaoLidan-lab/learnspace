import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MathText } from "../src/MathText";
import { QuizFeedback } from "../src/QuizFeedback";
import { DocumentStatus } from "../src/DocumentStatus";
const mod = {
  id: "quiz",
  type: "quiz" as const,
  title: "合成测验",
  layout: { x: 0, y: 0, w: 6, h: 8 },
};
test("测验文本和答案解析将 LaTeX 渲染为可读公式与 MathML", () => {
  const text = "缩放因子 $1/\\sqrt{d_k}$ 的作用？";
  const html = renderToStaticMarkup(
    createElement(MathText, { children: text }),
  );
  assert.match(html, /class="katex"/);
  assert.match(html, /<math/);
  assert.match(html, /缩放因子/);
  const feedback = renderToStaticMarkup(
    createElement(QuizFeedback, {
      type: "choice",
      answer: "$d_k$",
      userAnswer: "$d_k$",
      explanation: "使用 $\\sqrt{d_k}$ 缩放。",
      submitted: true,
    }),
  );
  assert.match(feedback, /回答正确/);
  assert.equal((feedback.match(/class="katex"/g) || []).length, 2);
});
test("错误公式不阻断整题，HTML 和公式命令不执行", () => {
  for (const text of [
    "$\\unknowncommand{x}$",
    "<script>alert(1)</script>",
    "$\\href{javascript:alert(1)}{x}$",
  ]) {
    const html = renderToStaticMarkup(
      createElement(MathText, { children: text }),
    );
    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes('href="javascript:'));
  }
});
function status(progress: string) {
  return renderToStaticMarkup(
    createElement(DocumentStatus, {
      mod,
      busy: true,
      progress,
      cancel: () => {},
    }),
  );
}
test("文档进度区分已解析页数与正在分析分段，不虚报生成进度", () => {
  assert.match(status("正在解析 合成.pdf 8/15"), /53%/);
  const analyzing = status("正在分析 合成.pdf 8/15，已完成分段会保留以便重试");
  assert.match(analyzing, /max="15" value="7"/);
  assert.ok(!analyzing.includes("8/15"));
  assert.match(analyzing, /46%/);
  assert.match(analyzing, /取消/);
  const generating = status("正在生成结果…");
  assert.match(generating, /document-status-compact/);
  assert.ok(!generating.includes("<progress"));
  assert.ok(!generating.includes("value="));
  assert.ok(!generating.includes("100%"));
});
