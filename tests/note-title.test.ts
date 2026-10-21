import test from "node:test";
import assert from "node:assert/strict";
import { appendNote, noteDisplayContent, noteTitle } from "../src/noteContent.js";

test("截图中的介绍句提炼为主题标题，列表和新笔记正文标题一致", () => {
  const text = "这段内容介绍了Transformer模型的提出背景、核心思想与主要优势：\n\n正文不变。";
  const title = "Transformer模型：背景、核心思想与优势";
  assert.equal(noteTitle(text), title);
  const note = appendNote(undefined, "w", "m", text, undefined, "ai");
  assert.equal(noteTitle(note.content), title);
  assert.ok(note.content.startsWith(`### ${title}\n`));
  assert.ok(note.content.includes(text));
});

test("旧的自动截断标题只在预览中纠正，保留原始正文及手动标题", () => {
  const text = "这段内容介绍了Transformer模型的提出背景、核心思想与主要优势：\n\n正文";
  const old = `### 这段内容介绍了Transformer模型的提出背景、核心思想与主…\n\n*AI 生成*\n\n${text}`;
  const title = "Transformer模型：背景、核心思想与优势";
  assert.equal(noteTitle(old), title);
  assert.ok(noteDisplayContent(old).startsWith(`### ${title}\n`));
  assert.ok(noteDisplayContent(old).endsWith(text));
  assert.ok(old.includes("与主…"));
  const manual = "# 我的学习：注意力机制\n\n用户正文";
  assert.equal(noteTitle(manual), "我的学习：注意力机制");
  assert.equal(noteDisplayContent(manual), manual);
  assert.equal(noteTitle("# 本文介绍了我的研究方向\n\n用户手动标题"), "本文介绍了我的研究方向");
});

test("旧 AI 笔记跳过通用标题和引导语，从正文提取主题而不修改正文", () => {
  const content = "### AI 生成\n\n这段的核心内容是：\n\n> **Transformer 的远距离依赖：注意力缩短交互路径。**";
  assert.equal(noteTitle(content), "Transformer 的远距离依赖");
  assert.ok(content.startsWith("### AI 生成"));
});

test("各类添加笔记入口使用内容标题，同时保留来源、原文与类型", () => {
  for (const kind of ["ai", "original", "user", "mixed"] as const) {
    const source = { resourceId: "r", page: 2, version: "v", text: "source" };
    const text = "多头注意力：缓解加权平均带来的信息混合。";
    const note = appendNote(undefined, "w", "m", text, source, kind);
    assert.equal(noteTitle(note.content), "多头注意力");
    assert.ok(note.content.startsWith("### 多头注意力"));
    assert.ok(note.content.includes(text));
    assert.equal(note.contentKind, kind);
    assert.deepEqual(note.sources, [source]);
  }
});

test("追加内容保留已有标题和正文，明确的 Markdown 标题保持原样", () => {
  const old = appendNote(undefined, "w", "m", "# 我的阅读记录\n\n已有正文", undefined, "user");
  const added = appendNote(old, "w", "m", "新的 AI 结论", undefined, "ai");
  assert.equal(noteTitle(added.content), "我的阅读记录");
  assert.ok(added.content.startsWith(old.content));
  assert.ok(added.content.includes("新的 AI 结论"));
});

test("标题清理 Markdown、忽略代码与来源行，并安全截断长文本", () => {
  assert.equal(noteTitle("\n### 原文摘录\n\n> 1. **[注意力](https://example.com)** 的作用。说明"), "注意力 的作用");
  assert.equal(noteTitle("```js\nconst x = 1;\n```\n\n## 有意义的标题"), "有意义的标题");
  assert.equal(noteTitle("### AI 生成\n\n参考材料（不代表逐项证据）：文件"), "未命名笔记");
  assert.equal(Array.from(noteTitle("📚".repeat(40))).length, 33);
  assert.equal(noteTitle(""), "未命名笔记");
});
