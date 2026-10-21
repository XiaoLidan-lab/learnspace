import type { CustomConfig } from "./customAI";
export function CustomConfigFields({
  draft,
  setDraft,
}: {
  draft: CustomConfig;
  setDraft: (config: CustomConfig) => void;
}) {
  return (
    <div className="custom-fields-form">
      <label>
        模块名称
        <input
          aria-label="自定义模块名称"
          value={draft.name}
          maxLength={80}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label>
        用途
        <textarea
          aria-label="自定义模块用途"
          value={draft.purpose}
          rows={3}
          maxLength={500}
          onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
        />
      </label>
      <p>命名文本输入（最多 8 项）</p>
      {draft.fields.map((f, i) => (
        <fieldset key={i}>
          <legend>输入字段 {i + 1}</legend>
          <label>
            显示名称
            <input
              aria-label={`字段 ${i + 1} 名称`}
              value={f.label}
              maxLength={80}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  fields: draft.fields.map((v, j) =>
                    j === i ? { ...v, label: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            变量名
            <input
              aria-label={`字段 ${i + 1} 变量名`}
              value={f.id}
              maxLength={32}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  fields: draft.fields.map((v, j) =>
                    j === i ? { ...v, id: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  fields: draft.fields.map((v, j) =>
                    j === i ? { ...v, required: e.target.checked } : v,
                  ),
                })
              }
            />
            必填
          </label>
          <button
            className="text-button"
            disabled={draft.fields.length === 1}
            onClick={() =>
              setDraft({
                ...draft,
                fields: draft.fields.filter((_, j) => j !== i),
              })
            }
          >
            删除字段 {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        className="btn mini"
        disabled={draft.fields.length >= 8}
        onClick={() => {
          let n = draft.fields.length + 1;
          while (draft.fields.some((f) => f.id === `input${n}`)) n++;
          setDraft({
            ...draft,
            fields: [
              ...draft.fields,
              { id: `input${n}`, label: "补充输入", required: false },
            ],
          });
        }}
      >
        添加输入字段
      </button>
      <label className="custom-prompt-field">
        提示词
        <textarea
          aria-label="自定义 Prompt"
          value={draft.prompt}
          rows={6}
          maxLength={4000}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
        />
      </label>
      <p className="small">
        可引用：{draft.fields.map((f) => `{{${f.id}}}`).join("、")}
        。仅替换已声明变量，不执行代码。
      </p>
      <label>
        展示方式
        <select
          aria-label="自定义结果展示方式"
          value={draft.display}
          onChange={(e) =>
            setDraft({
              ...draft,
              display: e.target.value as CustomConfig["display"],
            })
          }
        >
          <option value="markdown">Markdown</option>
          <option value="text">纯文本</option>
        </select>
      </label>
    </div>
  );
}
