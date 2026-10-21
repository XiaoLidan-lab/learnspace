import { writeFile } from "node:fs/promises";
import { pdfFixture } from "../tests/pdfFixture";
const pages = Array.from(
  { length: 24 },
  (_, i) =>
    `LearnSpace synthetic acceptance material. Page ${i + 1}.\nThis introductory page discusses study habits and note-taking.\nThese statements are synthetic test data, not research findings.`,
);
pages[23] =
  "LearnSpace synthetic acceptance material. Page 24.\nZXQ-742 is a fictional repair protein for this test only.\nZXQ-742 operates only in alkaline water.\nThe control marker is AMBER-ORCHID-742.\nThere is no evidence here about dosage or real medical use.";
await writeFile("/tmp/learnspace-phase4.pdf", pdfFixture(pages));
await writeFile(
  "/tmp/learnspace-phase4-template.json",
  JSON.stringify(
    {
      version: 1,
      title: "第四阶段验收-全文检索与恢复",
      description: "独立测试账号与合成资料验收，勿用于真实学习结论。",
      modules: [
        { type: "pdf", title: "验收资料", layout: { x: 0, y: 0, w: 6, h: 12 } },
        { type: "note", title: "验收笔记", layout: { x: 6, y: 0, w: 6, h: 6 } },
        { type: "quiz", title: "验收测验", layout: { x: 6, y: 6, w: 6, h: 6 } },
        {
          type: "cards",
          title: "验收卡片",
          layout: { x: 0, y: 12, w: 6, h: 6 },
        },
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Synthetic fixtures: /tmp/learnspace-phase4.pdf and /tmp/learnspace-phase4-template.json",
);
