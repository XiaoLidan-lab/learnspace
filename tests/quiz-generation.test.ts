import test from "node:test";
import assert from "node:assert/strict";
import { validateAIResult, quizSchema } from "../src/aiSchemas";
const question = {
  type: "choice",
  question: "合成材料中的维度是多少？",
  options: ["512", "688", "256"],
  answer: "512",
  explanation: "材料明确给出512。",
};
const validate = (q: unknown) =>
  validateAIResult("quiz", JSON.stringify({ questions: [q] }));
test("新测验只接受单选题，旧简答题不进入新生成结果", () => {
  assert.equal(quizSchema.parse(validate(question)).questions[0].type, "choice");
  assert.throws(() => validate({ ...question, type: "short" }));
  assert.throws(() => validate({ ...question, options: undefined }));
});
test("选择题必须有不同选项，答案必须完整匹配选项", () => {
  assert.throws(() => validate({ ...question, options: ["512", "512"] }));
  assert.throws(() => validate({ ...question, options: ["512", " 512 "] }));
  assert.throws(() => validate({ ...question, answer: "A" }));
  assert.throws(() => validate({ ...question, options: ["512"] }));
  assert.throws(() => validate({ ...question, options: [" ", "512"] }));
});
