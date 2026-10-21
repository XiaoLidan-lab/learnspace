import { connectionError } from "./connectionGraph";
import {
  materialEdges,
  materialReadContext,
  workspaceMaterials,
} from "./learningMaterials";
import {
  readConnection,
  upstreamVersion,
  type ReadContext,
  type ConnectedInput,
} from "./connections";
import { flowPatch } from "./flowData";
import type { Mod } from "./model";

// Reading is explicit: only submitting a question consumes connected sources.
// Never fall back to another module's selection or a previous task's snapshot.
export async function prepareChatContext(
  mod: Mod,
  ctx: ReadContext,
  signal?: AbortSignal,
  fields?: string[],
  documentReader?: import("./documentProcessing").DocumentReader,
) {
  const edges = materialEdges(mod, ctx.workspace).filter(
    (e) =>
      e.target.moduleId === mod.id &&
      (!fields || fields.includes(e.target.field)),
  );
  if (ctx.workspace.modules.some((m) => m.data?.flow?.materials)) {
    const issue = connectionError(
      ctx.workspace.modules,
      workspaceMaterials(ctx.workspace),
    );
    if (issue) throw Error(issue);
  }
  const packets: ConnectedInput[] = [];
  // Sequential document processing bounds AI concurrency and makes progress legible.
  for (const edge of edges)
    packets.push(
      await readConnection(
        edge,
        materialReadContext(mod, edge, ctx),
        signal,
        documentReader,
      ),
    );
  const patch = edges.length
    ? flowPatch(
        mod,
        edges,
        packets,
        ctx.workspace.id,
        ctx.workspace.activeTaskId,
      ).patch
    : {};
  const directSource = mod.data?.flow?.inputs.some((p) =>
    p.sources.some((s) => JSON.stringify(s) === JSON.stringify(mod.source)),
  )
    ? undefined
    : mod.source;
  const sources = edges.length
    ? packets.flatMap((p) => p.sources)
    : directSource
      ? [directSource]
      : [];
  const context = edges.length
    ? packets
        .map(
          (p, i) =>
            `[资料${i + 1} · ${p.sources[0]?.resourceName || "来源"} · ${p.kind}${p.sources[0]?.page ? ` · 定位 ${p.sources[0].page}` : ""}]\n${p.text}`,
        )
        .join("\n\n")
    : directSource?.text;
  if (context && context.length > 30000)
    throw Error("连接资料超过问答长度限制，请缩小选区后重试");
  return {
    context,
    sources,
    patch: { ...patch, source: sources[0] },
    assertCurrent(now: ReadContext) {
      if (
        now.workspace.id !== ctx.workspace.id ||
        now.workspace.activeTaskId !== ctx.workspace.activeTaskId ||
        JSON.stringify(
          materialEdges(
            now.workspace.modules.find((m) => m.id === mod.id) || mod,
            now.workspace,
          ).filter(
            (e) =>
              e.target.moduleId === mod.id &&
              (!fields || fields.includes(e.target.field)),
          ) || [],
        ) !== JSON.stringify(edges)
      )
        throw Error("任务或连接已变化，请重新发送问题");
      edges.forEach((e, i) => {
        if (
          upstreamVersion(
            e,
            materialReadContext(
              now.workspace.modules.find((m) => m.id === mod.id) || mod,
              e,
              now,
            ),
          ) !== packets[i].connection?.version
        )
          throw Error("来源内容已变化，请重新发送问题");
      });
    },
  };
}
