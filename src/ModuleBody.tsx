import { LearningMaterials } from "./MaterialSelector";
import { Suspense } from "react";
import { registry } from "./registry";
import type { ModuleProps } from "./moduleProps";
export function ModuleBody(props: ModuleProps) {
  const Component = registry[props.mod.type].component;
  const hasMaterials = [
    "translate",
    "summary",
    "mindmap",
    "cards",
    "quiz",
  ].includes(props.mod.type);
  return (
    <Suspense
      fallback={
        <div className="module-empty" role="status">
          正在加载模块…
        </div>
      }
    >
      {props.mod.type !== "custom-ai" ? (
        <div className="module-flow-layout">
          <div
            className={`module-flow-content module-content-${props.mod.type}${hasMaterials ? " with-materials" : ""}`}
          >
            {hasMaterials && <LearningMaterials {...props} />}
            <Component {...props} />
          </div>
        </div>
      ) : (
        <Component {...props} />
      )}
    </Suspense>
  );
}
