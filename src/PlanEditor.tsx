import { labels, types } from "./definitions";
import { layoutResultSchema, type LayoutPlanning } from "./layoutPlan";
import type { Template } from "./model";

export function PlanFields({
  plan,
  availableTypes,
  change,
}: {
  plan: LayoutPlanning;
  availableTypes: readonly (typeof types)[number][];
  change: (plan: LayoutPlanning) => void;
}) {
  return (
    <div className="plan-fields">
      <label className="form-label">
        学习目标
        <textarea
          aria-label="学习目标"
          maxLength={300}
          value={plan.goal}
          onChange={(e) => change({ ...plan, goal: e.target.value })}
        />
      </label>
      <div className="section-heading">
        <b>学习步骤</b>
        <button
          className="btn mini"
          type="button"
          disabled={plan.steps.length >= 6}
          onClick={() =>
            change({
              ...plan,
              steps: [
                ...plan.steps,
                {
                  title: "新步骤",
                  description: "说明要完成的行动",
                  moduleTypes: availableTypes.slice(0, 1),
                },
              ],
            })
          }
        >
          添加步骤
        </button>
      </div>
      {plan.steps.map((step, i) => {
        const patch = (p: Partial<typeof step>) =>
          change({
            ...plan,
            steps: plan.steps.map((s, j) => (j === i ? { ...s, ...p } : s)),
          });
        return (
          <fieldset className="plan-step-editor" key={i}>
            <legend>步骤 {i + 1}</legend>
            <label className="form-label">
              步骤名称
              <input
                maxLength={80}
                value={step.title}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </label>
            <label className="form-label">
              行动说明
              <textarea
                maxLength={300}
                value={step.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <div
              className="task-module-options"
              role="group"
              aria-label={`步骤 ${i + 1} 关联工具`}
            >
              {availableTypes.map((type) => (
                <label key={type}>
                  <input
                    type="checkbox"
                    checked={step.moduleTypes.includes(type)}
                    onChange={(e) =>
                      patch({
                        moduleTypes: e.target.checked
                          ? [...step.moduleTypes, type]
                          : step.moduleTypes.filter((t) => t !== type),
                      })
                    }
                  />
                  {labels[type]}
                </label>
              ))}
              {!availableTypes.length && (
                <small>尚无模块，可在工作台中添加后关联。</small>
              )}
            </div>
            <div className="task-actions">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => {
                  const steps = [...plan.steps];
                  [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
                  change({ ...plan, steps });
                }}
              >
                上移
              </button>
              <button
                type="button"
                disabled={i === plan.steps.length - 1}
                onClick={() => {
                  const steps = [...plan.steps];
                  [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
                  change({ ...plan, steps });
                }}
              >
                下移
              </button>
              <button
                type="button"
                disabled={plan.steps.length <= 1}
                onClick={() =>
                  change({
                    ...plan,
                    steps: plan.steps.filter((_, j) => j !== i),
                  })
                }
              >
                删除步骤
              </button>
            </div>
          </fieldset>
        );
      })}
      <label className="form-label">
        成果要求（每行一项，最多 10 项）
        <textarea
          aria-label="成果要求"
          value={(plan.outcomes || []).join("\n")}
          onChange={(e) =>
            change({ ...plan, outcomes: e.target.value.split("\n") })
          }
          onBlur={() =>
            change({
              ...plan,
              outcomes: plan.outcomes?.map((s) => s.trim()).filter(Boolean),
            })
          }
        />
      </label>
      {!!plan.assumptions?.length && (
        <details>
          <summary>AI 采用的假设</summary>
          {plan.assumptions.map((a, i) => (
            <p key={i}>{a}</p>
          ))}
        </details>
      )}
    </div>
  );
}
export function PlanEditor({
  template,
  plan,
}: {
  template: Template;
  plan: LayoutPlanning;
}) {
  const valid = layoutResultSchema.safeParse({ ...template, planning: plan });
  return (
    <section
      className="plan-overview recommended-learning-route"
      aria-label="推荐学习路线"
    >
      <h3>推荐学习路线</h3>
      <p>{plan.goal}</p>
      <ol className="plan-roadmap">
        {plan.steps.map((step, i) => (
          <li key={i}>
            <span className="plan-step-number">{i + 1}</span>
            <div>
              <b>{step.title}</b>
              <p>{step.description}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="small">路线供你参考，可以按自己的节奏和需要学习。</p>
      {!valid.success && (
        <p className="inline-error" role="alert">
          方案配置不完整，请重新生成后再创建工作台。
        </p>
      )}
    </section>
  );
}
