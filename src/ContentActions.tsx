import { ActionMenu } from "./ActionMenu";
import type { ModuleProps } from "./moduleProps";
import type { Source } from "./model";
export function ContentActions({
  text,
  source,
  send,
  label = "使用这段内容…",
}: {
  text: string;
  source: Source;
  send: ModuleProps["send"];
  label?: string;
}) {
  if (!text.trim()) return null;
  return (
    <div className="content-actions">
      <ActionMenu label={label}>
        {(
          [
            ["translate", "翻译"],
            ["chat", "提问"],
            ["cards", "制作卡片"],
            ["quiz", "生成练习"],
            ["mindmap", "生成导图"],
          ] as const
        ).map(([type, title]) => (
          <button
            key={type}
            className="text-button"
            onClick={() => {
              send(type, text, source, source.contentKind);
            }}
          >
            {title}
          </button>
        ))}
      </ActionMenu>
    </div>
  );
}
