import { materialEdges } from "./learningMaterials";
import type { Mod } from "./model";
import type { ReadContext } from "./connections";
import { prepareChatContext } from "./chatContext";
export async function prepareLearningInput(
  mod: Mod,
  ctx: ReadContext,
  signal?: AbortSignal,
  documentReader?: import("./documentProcessing").DocumentReader,
) {
  const connected = materialEdges(mod, ctx.workspace).some(
    (e) => e.target.moduleId === mod.id && e.target.field === "input",
  );
  const edited =
    mod.data?.flow?.materialMode === "manual" ||
    (mod.data?.flow?.materialMode !== "sources" &&
      !!mod.input?.trim() &&
      mod.input !== mod.data?.flow?.lastText);
  const prepared =
    connected && !edited
      ? await prepareChatContext(mod, ctx, signal, ["input"], documentReader)
      : undefined;
  const material = { ...mod, ...prepared?.patch };
  if (!material.input?.trim())
    throw Error("请先填写学习材料，或在学习材料中选择内容");
  if (material.input.length > 30000)
    throw Error("学习材料超过处理上限，请缩小范围");
  return {
    material,
    patch: prepared?.patch,
    assertCurrent: (now: ReadContext) => prepared?.assertCurrent(now),
  };
}
