import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuizFeedback } from "../src/QuizFeedback";
function render(type: "short" | "choice", answer: string, submitted = true) {
  return renderToStaticMarkup(
    createElement(QuizFeedback, {
      type,
      answer: "512",
      userAnswer: answer,
      explanation: "合成参考材料给出512。",
      submitted,
    }),
  );
}
test("简答题无论是否与参考相同都明确未判分，不能显示正确状态", () => {
  for (const answer of ["688", "512"]) {
    const html = render("short", answer);
    assert.match(html, /quiz-explanation ungraded/);
    assert.match(html, /简答题未自动判分/);
    assert.match(html.replace(/<[^>]+>/g, ""), /参考答案：512/);
    assert(!html.includes("回答正确"));
  }
});
test("选择题按实际结果展示正确与错误，文字不能仅依赖颜色", () => {
  assert.match(render("choice", "512"), /quiz-explanation correct/);
  assert.match(render("choice", "512"), /回答正确/);
  assert.match(render("choice", "688"), /quiz-explanation incorrect/);
  assert.match(render("choice", "688"), /回答有误/);
});
test("提交前不显示参考答案和判分反馈", () => {
  assert(!render("short", "688", false).includes("quiz-explanation"));
});
