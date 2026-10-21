import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardsModule, QuizModule } from "../src/LearningModules";
import { LegacyBody } from "../src/LegacyBody";
import { LearningInput } from "../src/LearningInput";
import { LearningMaterials } from "../src/MaterialSelector";
import { SourceReferences } from "../src/SourceReferences";
import { hasEditedDraft, uniqueSources } from "../src/learningPresentation";
import { WorkspaceBus } from "../src/events";
import type { Mod } from "../src/model";
import type { ModuleProps } from "../src/moduleProps";
function props(type: Mod["type"]): ModuleProps {
  const mod: Mod = {
    id: "test-tool",
    title: "测试工具",
    type,
    layout: { x: 0, y: 0, w: 6, h: 8 },
  };
  return {
    mod,
    workspace: {
      id: "w",
      title: "合成工作台",
      description: "",
      modules: [mod],
      createdAt: 0,
      updatedAt: 0,
    },
    workspaceId: "w",
    notes: [],
    resources: [],
    bus: new WorkspaceBus("w"),
    noteTargets: [],
    update: () => {},
    mutate: () => {},
    send: () => {},
    jump: () => {},
    notify: () => {},
    configure: () => {},
    setConnections: () => {},
    upload: async () => {},
    saveResource: async () => "",
    saveNote: async () => true,
    deleteNote: () => {},
    saveCustomNote: async () => {},
  };
}
const source = {
  kind: "pdf" as const,
  resourceId: "r",
  version: "v1",
  page: 3,
  text: "历史证据",
  resourceName: "历史文件.pdf",
};
test("覆盖保护区分接收原文与用户改写，不把问答问题当作材料草稿", () => {
  const p = props("translate");
  p.mod.input = "原始片段";
  p.mod.data = {
    flow: { inputs: [], materialMode: "manual", lastText: "原始片段" },
  };
  assert.equal(hasEditedDraft(p.mod), false);
  assert.equal(
    hasEditedDraft({
      ...p.mod,
      source: { ...source, text: "原始片段" },
      data: { flow: { inputs: [] } },
    }),
    false,
  );
  p.mod.input = "我改写的片段";
  assert.equal(hasEditedDraft(p.mod), true);
  assert.equal(hasEditedDraft({ ...p.mod, type: "chat" }), false);
});
test("单来源只展示一处紧凑摘要，多来源面板沿用兼容范围", () => {
  const p = props("quiz");
  p.mod.source = source;
  const html = renderToStaticMarkup(createElement(LearningMaterials, p));
  assert.match(html, /历史文件.pdf/);
  assert.equal(html.split("历史文件.pdf").length - 1, 1);
  assert.ok(!html.includes("已接收"));
  assert.ok(!html.includes("使用编辑内容"));
});
test("已选材料模式不再渲染重复正文框，手动输入仍可使用", () => {
  const p = props("quiz");
  p.mod.data = {
    flow: {
      inputs: [],
      materialMode: "sources",
      materials: [
        {
          mode: "replace",
          trigger: "manual",
          id: "e",
          source: { moduleId: "source", port: "note", noteId: "n" },
          target: { moduleId: p.mod.id, field: "input" },
        },
      ],
    },
  };
  assert.equal(renderToStaticMarkup(createElement(LearningInput, { p })), "");
  p.mod.data!.flow!.materialMode = "manual";
  assert.match(
    renderToStaticMarkup(createElement(LearningInput, { p })),
    /textarea/,
  );
});
test("卡片默认呈现一张复习卡和翻面导航，保留集合与新增入口", () => {
  const p = props("cards");
  p.mod.data = {
    cards: [
      { id: "1", front: "首张问题", back: "首张答案" },
      { id: "2", front: "第二张问题", back: "第二张答案" },
    ],
  };
  const html = renderToStaticMarkup(createElement(CardsModule, p));
  assert.match(html, /首张问题/);
  assert.ok(!html.includes("第二张问题"));
  assert.match(html, /查看卡片答案/);
  assert.match(html, /下一张卡片/);
  assert.match(html, /卡片集/);
  assert.ok(!html.includes('aria-label="卡片正面"'));
});
test("测验答题中不展示出题材料框，提交后可查看错题与制作卡片", () => {
  const p = props("quiz");
  p.mod.data = {
    quiz: [
      {
        id: "q",
        question: "识别码？",
        type: "choice",
        options: ["A", "B"],
        answer: "A",
        explanation: "合成说明",
      },
    ],
    answers: { q: "B" },
  };
  const before = renderToStaticMarkup(createElement(QuizModule, p));
  assert.match(before, /识别码/);
  assert.ok(!before.includes("textarea"));
  assert.match(before, /重新出题/);
  assert.match(before, /提交并查看解析/);
  p.mod.data.submitted = true;
  const after = renderToStaticMarkup(createElement(QuizModule, p));
  assert.match(after, /只看错题/);
  assert.match(after, /错题制作卡片/);
  assert.match(after, /将这道错题制作成卡片/);
  assert.match(after, /回答有误/);
});
test("历史回答引用历史来源，当前材料更换不改变历史定位", () => {
  const p = props("chat");
  p.mod.source = { ...source, resourceName: "当前文件.pdf", page: 7 };
  p.mod.messages = [
    { role: "assistant", content: "历史回答", sources: [source, source] },
  ];
  const html = renderToStaticMarkup(createElement(LegacyBody, p));
  assert.equal(html.split("历史文件.pdf").length - 1, 1);
  assert.match(html, /当前文件.pdf/);
  assert.ok(!html.includes("不代表逐项引用"));
  assert.ok(html.indexOf("历史回答") < html.indexOf("学习材料："));
});
test("引用默认折叠并按定位去重，不改写笔记正文", () => {
  assert.equal(
    uniqueSources([source, source, { ...source, page: 4 }]).length,
    2,
  );
  const html = renderToStaticMarkup(
    createElement(SourceReferences, {
      sources: [source, source],
      jump: () => {},
    }),
  );
  assert.ok(html.startsWith('<details class="source-references">'));
  assert.ok(!html.includes(" open"));
  const p = props("note");
  const content = "## 原有标题\n\n原有正文与用户修改";
  p.notes = [
    {
      id: "n",
      workspaceId: "w",
      moduleId: p.mod.id,
      content,
      sources: [source, source],
      contentKind: "mixed",
    },
  ];
  const note = renderToStaticMarkup(createElement(LegacyBody, p));
  assert.match(note, /原有正文与用户修改/);
  assert.equal(p.notes[0].content, content);
  assert.ok(!note.includes("下方来源为关联材料"));
});
test("测验题干和选项渲染公式，选择值与正确答案保持原样", () => {
  const p = props("quiz");
  p.mod.data = {
    quiz: [
      {
        id: "math-q",
        type: "choice",
        question: "缩放 $1/\\sqrt{d_k}$？",
        options: ["$1/8$", "$1/4$"],
        answer: "$1/8$",
        explanation: "$d_k=64$",
      },
    ],
    answers: { "math-q": "$1/8$" },
    submitted: true,
  };
  const html = renderToStaticMarkup(createElement(QuizModule, p));
  assert.equal((html.match(/class="katex"/g) || []).length, 5);
  assert.match(html, /回答正确/);
  assert.match(html, /checked=""/);
  assert.ok(html.indexOf("提交并查看解析") === -1);
  assert.ok(html.indexOf("重新作答") > html.indexOf("回答正确"));
});
