import { materialEdges } from "./learningMaterials";
import { useRef, useState, useSyncExternalStore } from "react";
import { ai } from "./services";
import {
  createDocumentReader,
  type DocumentReport,
} from "./documentProcessing";
import { useAI } from "./useAI";
import { prepareLearningInput } from "./materialInput";
import type { ModuleProps } from "./moduleProps";
import type { Mod } from "./model";
const emptyGeneration = { busy: false, error: "", progress: "", partial: "" };
const noSubscription = () => () => {};
const generationFingerprint = (mod: Mod, workspace: ModuleProps["workspace"]) =>
  JSON.stringify([mod.type, mod.input, mod.source, mod.data, materialEdges(mod, workspace)]);

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
  const background = ["mindmap", "quiz"].includes(p.mod.type) ? p.generation : undefined;
  const jobKey = JSON.stringify([background?.owner, p.workspaceId, p.taskId, p.mod.id]);
  const backgroundState = useSyncExternalStore(
    background?.tasks.subscribe || noSubscription,
    () => background?.tasks.snapshot(jobKey) || emptyGeneration,
    () => emptyGeneration,
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
    ...(background ? {
      busy: backgroundState.busy,
      error: backgroundState.error,
      partial: backgroundState.partial,
      cancel: () => background.tasks.cancel(jobKey),
      clearPartial: () => background.tasks.clearPartial(jobKey),
    } : {}),
    progress: background ? backgroundState.progress : progress,
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
      // A disposed workspace bus clears its selection. Retain this request's
      // selection snapshot while reading current modules/resources from App.
      const selection = p.bus.selection;
      const selections = { ...p.bus.selections };
      const fingerprint = generationFingerprint(p.mod, p.workspace);
      const current = () => {
        if (!background) return { mod: latest.current.mod, ctx: context(latest.current) };
        const now = background.read();
        return now ? { ...now, ctx: { ...now.ctx, selection, selections } } : undefined;
      };
      const assertCurrent = () => {
        const now = current();
        if (!now || (background && generationFingerprint(now.mod, now.ctx.workspace) !== fingerprint))
          throw Error("工作台、模块或学习材料已变化，请重新生成");
        prepared?.assertCurrent(now.ctx);
      };
      const valid = () => { try { assertCurrent(); return true; } catch { return false; } };
      let reportProgress: (value: string) => void = setProgress;
      const prepare = async (signal: AbortSignal) => {
          const ctx = { ...context(p), selection, selections };
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
                progress: reportProgress,
                reports,
              })
            : undefined;
          prepared = await prepareLearningInput(
            p.mod,
            ctx,
            signal,
            documentReader,
          );
          assertCurrent();
          material = prepared.material;
          material = {
            ...material,
            data: {
              ...material.data,
              flow: { inputs: [], ...material.data?.flow, documents: reports },
            },
          };
          reportProgress("正在生成结果…");
          return { ...payload, text: material.input };
      };
      const finish = (result: any, signal?: AbortSignal) => {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          assertCurrent();
          const patch = apply(result, material);
          const resultPatch = {
            ...prepared?.patch,
            ...patch,
            data: { ...material.data, ...patch.data },
          };
          if (background) p.mutate(mod => {
            const now = current();
            return now && generationFingerprint(mod, now.ctx.workspace) === fingerprint ? resultPatch : {};
          });
          else p.update(resultPatch);
      };
      if (background) {
        await background.tasks.run(jobKey, valid, async (signal, report) => {
          reportProgress = value => report({ progress: value });
          reportProgress("正在读取学习材料…");
          const input = await prepare(signal);
          assertCurrent();
          const result = await ai(action, input, signal,
            action === "quiz" ? text => report({ partial: text }) : undefined);
          return () => finish(result, signal);
        });
        return;
      }
      setProgress("正在读取学习材料…");
      await state.run(action, prepare, finish);
      setProgress("");
    },
  };
}
