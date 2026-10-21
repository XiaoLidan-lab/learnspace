import { materialEdges } from "./learningMaterials";
import { useRef, useState } from "react";
import { ai } from "./services";
import {
  createDocumentReader,
  type DocumentReport,
} from "./documentProcessing";
import { useAI } from "./useAI";
import { prepareLearningInput } from "./materialInput";
import type { ModuleProps } from "./moduleProps";
import type { Mod } from "./model";

export function useMaterialAI(p: ModuleProps, inputKey: string) {
  const [progress, setProgress] = useState("");
  const latest = useRef(p);
  latest.current = p;
  const state = useAI(
    inputKey +
      JSON.stringify([
        p.workspaceId,
        p.taskId,
        p.mod.id,
        p.mod.data?.flow?.materials,
        p.mod.data?.flow?.materialMode,
        p.workspace.connections,
      ]),
  );
  const connected = materialEdges(p.mod, p.workspace).some(
    (e) => e.target.moduleId === p.mod.id && e.target.field === "input",
  );
  const context = (value: ModuleProps) => ({
    workspace: value.workspace,
    notes: value.notes,
    resources: value.resources,
    selection: value.bus.selection,
    selections: value.bus.selections,
  });
  return {
    ...state,
    progress,
    connected,
    async run(
      action: string,
      payload: Record<string, unknown>,
      apply: (result: any, material: Mod) => Partial<Mod>,
    ) {
      let prepared:
        | Awaited<ReturnType<typeof prepareLearningInput>>
        | undefined;
      let material = p.mod;
      const reports: DocumentReport[] = [];
      setProgress("正在读取学习材料…");
      await state.run(
        action,
        async (signal: AbortSignal) => {
          const ctx = context(p);
          const documentReader = [
            "summary",
            "cards",
            "quiz",
            "mindmap",
          ].includes(p.mod.type)
            ? createDocumentReader({
                ctx,
                targetId: p.mod.id,
                budget: Math.floor(
                  20000 / Math.max(1, materialEdges(p.mod, p.workspace).length),
                ),
                call: ai,
                signal,
                progress: setProgress,
                reports,
              })
            : undefined;
          prepared = await prepareLearningInput(
            p.mod,
            ctx,
            signal,
            documentReader,
          );
          prepared.assertCurrent(context(latest.current));
          material = prepared.material;
          material = {
            ...material,
            data: {
              ...material.data,
              flow: { inputs: [], ...material.data?.flow, documents: reports },
            },
          };
          setProgress("正在生成结果…");
          return { ...payload, text: material.input };
        },
        (result) => {
          prepared?.assertCurrent(context(latest.current));
          const patch = apply(result, material);
          p.update({
            ...prepared?.patch,
            ...patch,
            data: { ...material.data, ...patch.data },
          });
        },
      );
      setProgress("");
    },
  };
}
