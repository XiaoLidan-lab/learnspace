import { quizSchema } from "./aiSchemas";

// Preview only fully received and individually valid question objects.
// JSON strings may contain braces, escaped quotes, brackets or LaTeX.
export function quizPreview(text: string) {
  const questions: ReturnType<typeof quizSchema.parse>["questions"] = [];
  if (text.length > 100000) return questions;
  const prefix = /^\s*\{\s*"questions"\s*:\s*\[/.exec(text);
  if (!prefix) return questions;
  let depth = 0,
    quoted = false,
    escaped = false,
    start = -1;
  for (let i = prefix[0].length; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      if (depth === 0) break;
      quoted = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      if (depth === 0) break;
      depth--;
      if (depth === 0) {
        try {
          const parsed = quizSchema.safeParse({
            questions: [JSON.parse(text.slice(start, i + 1))],
          });
          if (!parsed.success) break;
          questions.push(parsed.data.questions[0]);
          if (questions.length >= 10) break;
        } catch {
          break;
        }
      }
    } else if (depth === 0 && char !== "," && !/\s/.test(char)) break;
  }
  return questions;
}
