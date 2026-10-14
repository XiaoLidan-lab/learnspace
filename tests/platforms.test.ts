import test from "node:test";
import assert from "node:assert/strict";
import { safeUrl, videoAdapter, webAdapter } from "../src/platforms";
import { validateAIResult } from "../src/aiSchemas";
test("YouTube 与 Bilibili URL 适配和能力区分", () => {
  const yt = videoAdapter("https://youtu.be/M7lc1UVf-VE", 65);
  assert(yt.embedUrl?.includes("start=65"));
  assert.equal(yt.capabilities.subtitles, false);
  const bi = videoAdapter("https://www.bilibili.com/video/BV1B7411m7LV/?p=2");
  assert(bi.embedUrl?.includes("bvid=BV1B7411m7LV"));
  assert.equal(bi.capabilities.seek, false);
  assert.equal(
    videoAdapter("https://b23.tv/unknown").capabilities.embed,
    false,
  );
  assert.equal(
    videoAdapter("https://youtube.com.evil.test/watch?v=M7lc1UVf-VE")
      .capabilities.embed,
    false,
  );
});
test("网页能力不假定跨域文本可读取，拒绝可执行或带凭证 URL", () => {
  assert.equal(
    webAdapter("https://example.com", "http://localhost:5173").capabilities
      .selection,
    false,
  );
  assert.equal(
    webAdapter("http://localhost:5173/test", "http://localhost:5173")
      .capabilities.selection,
    true,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///tmp/file",
    "https://user:password@example.com",
  ])
    assert.throws(() => safeUrl(url));
});
test("AI 卡片、测验和导图必须经过结构校验", () => {
  assert.throws(() =>
    validateAIResult(
      "cards",
      JSON.stringify({ cards: [{ front: "a", back: "b", apiKey: "secret" }] }),
    ),
  );
  assert.throws(() =>
    validateAIResult(
      "quiz",
      JSON.stringify({
        questions: [
          {
            type: "choice",
            question: "q",
            options: ["A", "B"],
            answer: "C",
            explanation: "",
          },
        ],
      }),
    ),
  );
  assert.throws(() =>
    validateAIResult(
      "mindmap",
      JSON.stringify({
        nodes: [
          { id: "a", parentId: "b", text: "a", x: 0, y: 0 },
          { id: "b", parentId: "a", text: "b", x: 0, y: 0 },
        ],
      }),
    ),
  );
  assert.deepEqual(
    (
      validateAIResult("cards", '{"cards":[{"front":"Q","back":"A"}]}') as {
        cards: { front: string; back: string }[];
      }
    ).cards[0],
    { front: "Q", back: "A" },
  );
});
