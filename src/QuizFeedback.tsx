import { MathText } from "./MathText";
export function QuizFeedback({
  type,
  answer,
  userAnswer,
  explanation,
  submitted,
}: {
  type: "short" | "choice";
  answer: string;
  userAnswer?: string;
  explanation: string;
  submitted: boolean;
}) {
  if (!submitted) return null;
  const state =
    type === "short"
      ? "ungraded"
      : userAnswer === answer
        ? "correct"
        : "incorrect";
  return (
    <div className={`quiz-explanation ${state}`} role="status">
      <b>
        {state === "ungraded"
          ? "简答题未自动判分，请对照参考答案"
          : state === "correct"
            ? "回答正确"
            : "回答有误，请查看解析"}
      </b>
      <p>
        {type === "short" ? "参考答案" : "正确答案"}：
        <MathText>{answer}</MathText>
      </p>
      <p>
        <MathText>{explanation}</MathText>
      </p>
    </div>
  );
}
