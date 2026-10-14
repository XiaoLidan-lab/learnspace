import "dotenv/config";
import assert from "node:assert/strict";
import { guidance } from "../server/api";
import { validateLayoutPlan } from "../src/layoutPlan";
const cases = [
  {
    task: "下周组会我要分享一篇英文论文，现在对研究背景和结论还不太理解，希望最后能整理出讲解提纲。",
    required: ["pdf", "note"],
  },
  {
    task: "我想跟着视频学摄影，边看边记下拍摄方法，之后能反复练习和回顾。",
    required: ["video", "note"],
  },
  {
    task: "两周后考细胞生物学，我总是记不住概念，想根据课程资料复习并检查自己哪里没掌握。",
    required: [],
  },
];
await Promise.all(
  cases.map(async ({ task, required }, i) => {
    try {
      const response = await fetch(
        `${process.env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.AI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.AI_MODEL,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: guidance.layout },
              { role: "user", content: JSON.stringify({ prompt: task }) },
            ],
          }),
          signal: AbortSignal.timeout(55000),
        },
      );
      if (!response.ok) throw Error(`Model HTTP ${response.status}`);
      const body: any = await response.json();
      const result = validateLayoutPlan(
        JSON.parse(body.choices[0].message.content),
      );
      const types = result.modules.map((m) => m.type);
      assert(result.planning.steps.length >= 2);
      for (const type of required)
        assert(
          types.includes(type as any),
          `Missing suitable material/output tool: ${type}`,
        );
      if (i === 2) assert(types.includes("quiz") || types.includes("cards"));
      console.log(
        JSON.stringify({
          case: i + 1,
          passed: true,
          modules: types,
          steps: result.planning.steps.length,
        }),
      );
    } catch (e) {
      console.log(
        JSON.stringify({
          case: i + 1,
          passed: false,
          error: e instanceof Error ? e.message : "Failed",
        }),
      );
      process.exitCode = 1;
    }
  }),
);
