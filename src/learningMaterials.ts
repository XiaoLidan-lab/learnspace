import { noteTitle } from "./noteContent.js";
import type { Mod, Workspace } from "./model.js";
import type { Connection, ReadContext } from "./connections.js";
import {
  connectionError,
  directConnection,
  inputPorts,
} from "./connectionGraph.js";

export { materialEdges, workspaceMaterials } from "./materialBindings.js";
import { materialEdges, workspaceMaterials } from "./materialBindings.js";
export function materialReadContext(
  mod: Mod,
  edge: Connection,
  ctx: ReadContext,
): ReadContext {
  if (
    !mod.data?.flow?.materials ||
    edge.source.port !== "selection" ||
    edge.source.range === "document" ||
    ctx.selections?.[edge.source.moduleId] ||
    ctx.selection?.moduleId === edge.source.moduleId
  )
    return ctx;
  const snapshot = mod.data.flow.inputs.find(
    (p) =>
      p.connection?.id === edge.id &&
      p.connection.workspaceId === ctx.workspace.id &&
      p.connection.taskId === ctx.workspace.activeTaskId,
  );
  const source = snapshot?.sources[0];
  const from = ctx.workspace.modules.find((m) => m.id === edge.source.moduleId);
  const file = ctx.resources.find((r) => r.id === from?.resourceId);
  if (
    !snapshot ||
    !source ||
    from?.type !== "pdf" ||
    source.resourceId !== file?.id ||
    source.version !== file?.version
  )
    return ctx;
  return {
    ...ctx,
    selections: {
      ...ctx.selections,
      [from.id]: {
        ...source,
        moduleId: from.id,
        text: snapshot.text,
        createdAt: source.createdAt || 0,
      },
    },
  };
}
export function materialField(mod: Mod) {
  return mod.type === "chat" ? "context" : "input";
}
export function materialModePatch(mod: Mod, mode: "sources" | "manual") {
  return {
    data: {
      ...mod.data,
      flow: {
        ...mod.data?.flow,
        inputs: mod.data?.flow?.inputs || [],
        materialMode: mode,
      },
    },
  };
}
export type LearningMaterial = {
  key: string;
  title: string;
  detail: string;
  source: Connection["source"];
  unavailable?: string;
  file?: boolean;
};
export function learningMaterials(
  target: Mod,
  ctx: ReadContext,
): LearningMaterial[] {
  const result: LearningMaterial[] = [];
  const field = inputPorts(target).find((f) => f.id === materialField(target));
  const add = (
    m: Mod,
    source: Connection["source"],
    title: string,
    detail: string,
    unavailable?: string,
    file?: boolean,
  ) => {
    if (!field?.accept.includes(source.port)) return;
    const peers = ctx.workspace.modules.filter((x) => x.title === m.title);
    const instance =
      peers.length > 1 ? peers.findIndex((x) => x.id === m.id) + 1 : 0;
    result.push({
      key: materialKey(source),
      title: instance && title === m.title ? `${title} · ${instance}` : title,
      detail: instance ? `${detail} · ${m.title} ${instance}` : detail,
      source,
      unavailable,
      file,
    });
  };
  for (const m of ctx.workspace.modules.filter((m) => m.id !== target.id)) {
    if (m.type === "pdf") {
      const r = ctx.resources.find((r) => r.id === m.resourceId);
      add(
        m,
        {
          moduleId: m.id,
          port: "selection",
          range: target.type === "mindmap" ? "document" : "selection",
        },
        r?.name || m.title,
        m.title,
        r ? undefined : "请先在文件阅读中上传或重新选择文件",
        true,
      );
    } else if (m.type === "note") {
      const notes = ctx.notes.filter(
        (n) =>
          n.moduleId === m.id &&
          n.workspaceId === ctx.workspace.id &&
          n.taskId === ctx.workspace.activeTaskId,
      );
      for (const n of notes)
        add(
          m,
          { moduleId: m.id, port: "note", noteId: n.id },
          noteTitle(n.content, "空白笔记"),
          m.title,
          n.content.trim() ? undefined : "笔记尚无正文",
        );
    } else if (m.type === "chat")
      add(
        m,
        { moduleId: m.id, port: "answer" },
        m.title,
        "最近一条 AI 回答",
        m.messages?.some((v) => v.role === "assistant" && v.content.trim())
          ? undefined
          : "尚无 AI 回答",
      );
    else if (["translate", "summary", "custom-ai"].includes(m.type))
      add(
        m,
        { moduleId: m.id, port: "output" },
        m.title,
        "最近生成的结果",
        m.output?.trim() ? undefined : "尚无生成结果",
      );
    else if (m.type === "mindmap")
      add(
        m,
        { moduleId: m.id, port: "outline" },
        m.title,
        "导图大纲",
        m.data?.nodes?.length ? undefined : "尚无导图节点",
      );
    else if (m.type === "cards")
      add(
        m,
        { moduleId: m.id, port: "cards" },
        m.title,
        "知识卡片",
        m.data?.cards?.length ? undefined : "尚无知识卡片",
      );
    else if (m.type === "video")
      add(
        m,
        { moduleId: m.id, port: "transcript" },
        m.title,
        "视频文字稿",
        m.data?.transcript?.trim() ? undefined : "请先提供视频文字稿",
      );
    else if (["web", "image", "text", "sticky"].includes(m.type))
      add(
        m,
        { moduleId: m.id, port: "text" },
        m.title,
        m.type === "web"
          ? "网页摘录"
          : m.type === "image"
            ? "图片说明"
            : "文字内容",
        m.data?.text?.trim() ? undefined : "尚无可使用的文字内容",
      );
    else if (m.type === "quiz" && m.data?.submitted)
      add(m, { moduleId: m.id, port: "results" }, m.title, "已提交的测验结果");
  }
  return result;
}
export function materialKey(source: Connection["source"]) {
  return `${source.moduleId}:${source.port}:${source.noteId || source.query || source.itemId || ""}`;
}
export function chooseMaterials(
  mod: Mod,
  ctx: ReadContext,
  selected: LearningMaterial[],
): Connection[] {
  if (selected.length > 12) throw Error("一次最多选择12项学习材料");
  const old = materialEdges(mod, ctx.workspace),
    field = materialField(mod);
  const preserved = old.filter((e) => e.target.field !== field);
  const others = workspaceMaterials(ctx.workspace).filter(
    (e) => e.target.moduleId !== mod.id,
  );
  const refs: Connection[] = [...preserved];
  for (const item of selected) {
    if (item.unavailable) throw Error(item.unavailable);
    if (item.file && item.source.range !== "document") {
      const s = ctx.selections?.[item.source.moduleId] || ctx.selection;
      const from = ctx.workspace.modules.find(
        (m) => m.id === item.source.moduleId,
      );
      const r = ctx.resources.find((r) => r.id === from?.resourceId);
      if (
        !s ||
        s.moduleId !== item.source.moduleId ||
        s.resourceId !== r?.id ||
        s.version !== r?.version ||
        !s.text.trim()
      )
        throw Error(`请先在“${item.title}”中选中内容，或改用整篇文档`);
    }
    const previous = old.find(
      (e) => e.target.field === field && materialKey(e.source) === item.key,
    );
    const edge = directConnection(
      ctx.workspace.modules,
      [],
      item.source.moduleId,
      item.source.port,
      mod.id,
      field,
      previous?.id || crypto.randomUUID(),
      item.source.noteId,
    );
    refs.push({ ...edge, source: { ...item.source } });
  }
  const issue = connectionError(ctx.workspace.modules, [...others, ...refs]);
  if (issue)
    throw Error(
      issue.includes("依赖环")
        ? "不能选择这项材料：工具之间会形成循环引用"
        : issue,
    );
  return refs;
}
