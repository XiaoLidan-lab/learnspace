import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { directConnection, connectionError } from "../src/connectionGraph";
import { readConnection, upstreamVersion } from "../src/connections";
import { ensurePdfIndex } from "../src/pdfIndex";
import { flowPatch } from "../src/flowData";
import {
  uid,
  safeTemplate,
  fromTemplate,
  type Mod,
  type Workspace,
  type Resource,
} from "../src/model";
import { cloudPayload, parseCloudPayload } from "../src/cloudData";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
async function fixture(texts = ["首段：注意力概念", "尾段：训练步骤"]) {
  const resource: Resource = {
    id: uid(),
    name: "独立合成资料.pdf",
    version: "v1",
    file: new Blob(["synthetic"]),
    createdAt: 0,
  };
  const source: Mod = {
    id: uid(),
    type: "pdf",
    title: "文件阅读",
    resourceId: resource.id,
    layout: { x: 0, y: 0, w: 6, h: 8 },
  };
  const target: Mod = {
    id: uid(),
    type: "mindmap",
    title: "思维导图",
    layout: { x: 6, y: 0, w: 6, h: 8 },
  };
  const edge = directConnection(
    [source, target],
    [],
    source.id,
    "selection",
    target.id,
    "input",
    uid(),
  );
  const workspace: Workspace = {
    id: uid(),
    title: "合成范围验收",
    description: "",
    createdAt: 0,
    updatedAt: 0,
    isolationVersion: 1,
    modules: [source, target],
    connections: [edge],
  };
  await ensurePdfIndex(resource, {
    load: () => ({
      promise: Promise.resolve({
        numPages: texts.length,
        getPage: async (page) => ({
          getTextContent: async () => ({ items: [{ str: texts[page - 1] }] }),
        }),
      }),
      destroy: async () => {},
    }),
  });
  return {
    source,
    target,
    edge,
    ctx: { workspace, notes: [], resources: [resource], selection: null },
    resource,
  };
}
test("新增翻译连接默认选中内容，导图默认整篇；旧连接不强制改变范围", async () => {
  const { source, target, edge, ctx } = await fixture();
  assert.equal(edge.source.range, "document");
  const translator = { ...target, type: "translate" as const };
  assert.equal(
    directConnection(
      [source, translator],
      [],
      source.id,
      "selection",
      translator.id,
      "input",
      uid(),
    ).source.range,
    "selection",
  );
  const old = structuredClone(edge);
  delete old.source.range;
  await assert.rejects(readConnection(old, ctx), /请先/);
  const invalid = {
    ...edge,
    source: {
      moduleId: target.id,
      port: "outline" as const,
      range: "document" as const,
    },
    target: { moduleId: source.id, field: "file" },
  };
  assert.match(connectionError(ctx.workspace.modules, [invalid])!, /数据范围/);
});
test("整篇读取所有页面，不需要选区；范围与版本进入快照，切换范围后实际取数改变", async () => {
  const { source, target, edge, ctx, resource } = await fixture();
  const packet = await readConnection(edge, ctx);
  assert.match(packet.text, /首段/);
  assert.match(packet.text, /尾段/);
  assert.equal(packet.connection?.range, "document");
  const patch = flowPatch(
    target,
    [edge],
    [packet],
    ctx.workspace.id,
    undefined,
  ).patch;
  assert.match(patch.input!, /尾段/);
  assert.equal(packet.sources[1].page, 2);
  const selected = {
    ...edge,
    source: { ...edge.source, range: "selection" as const },
  };
  const selection = {
    kind: "pdf" as const,
    moduleId: source.id,
    resourceId: resource.id,
    resourceName: resource.name,
    version: resource.version,
    page: 2,
    text: "尾段",
    createdAt: 0,
  };
  const part = await readConnection(selected, { ...ctx, selection });
  assert.equal(part.text, "尾段");
  assert.notEqual(
    upstreamVersion(edge, ctx),
    upstreamVersion(selected, { ...ctx, selection }),
  );
  assert.throws(
    () => flowPatch(target, [selected], [packet], ctx.workspace.id, undefined),
    /连接或任务/,
  );
});
test("超过原选区长度的整篇正文可读取；超上限、不可提取页、取消均明确失败", async () => {
  const f = await fixture(["合成正文".repeat(2300)]);
  const packet = await readConnection(f.edge, f.ctx);
  assert(packet.text.length > 8000);
  const updated = {
    ...f.target,
    ...flowPatch(f.target, [f.edge], [packet], f.ctx.workspace.id, undefined)
      .patch,
  };
  const restored = parseCloudPayload(
    cloudPayload({ ...f.ctx.workspace, modules: [f.source, updated] }, []),
  );
  assert.equal(
    restored.workspace.modules[1].data?.flow?.inputs[0].text,
    packet.text,
  );
  assert(
    flowPatch(f.target, [f.edge], [packet], f.ctx.workspace.id, undefined).patch
      .input!.length > 8000,
  );
  const tooLong = await fixture(["文".repeat(24000)]);
  await assert.rejects(readConnection(tooLong.edge, tooLong.ctx), /未截断/);
  const empty = await fixture([""]);
  await assert.rejects(readConnection(empty.edge, empty.ctx), /无法提取/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readConnection(f.edge, f.ctx, abort.signal), {
    name: "AbortError",
  });
});
test("云端数据与组合模板保留范围，模板移除私人文件并要求重新绑定", async () => {
  const { edge, ctx } = await fixture();
  assert.equal(
    parseCloudPayload(cloudPayload(ctx.workspace, [])).workspace.connections![0]
      .source.range,
    "document",
  );
  const template = safeTemplate(ctx.workspace);
  assert.equal(template.connections![0].source.range, "document");
  assert.equal(template.connections![0].source.needsBinding, true);
  const installed = fromTemplate(template);
  const next = installed.connections![0];
  assert.notEqual(next.source.moduleId, edge.source.moduleId);
  assert.equal(next.source.range, "document");
  await assert.rejects(
    readConnection(next, { ...ctx, workspace: installed }),
    /尚未绑定/,
  );
});
