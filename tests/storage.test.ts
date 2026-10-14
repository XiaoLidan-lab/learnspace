import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
import { store } from "../src/storage";
import { types, definitions } from "../src/definitions";
import {
  uid,
  safeTemplate,
  fromTemplate,
  type Mod,
  type Workspace,
} from "../src/model";
import { arrange } from "../src/layout";
test("IndexedDB 集成：16 种模块、内容、分组、笔记和 Blob 保存恢复", async () => {
  const modules: Mod[] = types.map((type) => ({
    id: uid(),
    type,
    title: definitions[type].name,
    layout: { x: 0, y: 0, w: 6, h: 6 },
    data: {
      text: `private-${type}`,
      timer: { mode: "focus", remaining: 60, endsAt: Date.now() + 60000 },
      tasks: [{ id: uid(), text: "read", done: true }],
    },
  }));
  const id = uid();
  let workspace: Workspace = {
    id,
    title: "恢复测试",
    description: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    modules: arrange(modules, "三栏"),
  };
  const resource = {
    id: uid(),
    name: "sample.pdf",
    version: uid(),
    file: new Blob(["%PDF- test"], { type: "application/pdf" }),
    createdAt: Date.now(),
  };
  const note = {
    id: uid(),
    workspaceId: id,
    moduleId: modules[8].id,
    content: "private note",
    sources: [
      {
        resourceId: resource.id,
        version: resource.version,
        page: 1,
        text: "quote",
      },
    ],
  };
  await store.save(workspace);
  await store.saveResource(resource);
  await store.saveNote(note);
  const restored = (await store.workspaces()).find((w) => w.id === id)!;
  assert.equal(restored.modules.length, 16);
  assert.deepEqual(
    restored.modules.map((m) => m.data),
    workspace.modules.map((m) => m.data),
  );
  workspace = { ...workspace, modules: arrange(restored.modules, "四宫格") };
  await store.save(workspace);
  assert.deepEqual(
    (await store.workspaces()).find((w) => w.id === id)!.modules[0].data,
    modules[0].data,
  );
  const installed = fromTemplate(safeTemplate(workspace));
  assert.equal(installed.modules[0].data, undefined);
  await store.remove(id);
  assert((await store.resources()).some((r) => r.id === resource.id));
  assert((await store.notes()).some((n) => n.id === note.id));
  assert.equal(
    (await store.resources()).find((r) => r.id === resource.id)!.file.size,
    resource.file.size,
  );
});
