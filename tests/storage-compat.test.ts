import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { openDB } from "idb";
import { builtins, fromTemplate } from "../src/model";
test("打开既有较高版本本地库时保留工作台、笔记和文件，不触发降级失败", async () => {
  const db = await openDB("learnspace-v1", 2, {
    upgrade(d) {
      for (const name of ["workspaces", "notes", "resources"])
        d.createObjectStore(name, { keyPath: "id" });
    },
  });
  const workspace = fromTemplate(builtins[0]);
  await db.put("workspaces", workspace);
  await db.put("notes", {
    id: "note",
    workspaceId: workspace.id,
    content: "synthetic",
    sources: [],
  });
  await db.put("resources", {
    id: "file",
    version: "v1",
    name: "test.pdf",
    file: new Blob(["synthetic"]),
    createdAt: 1,
  });
  db.close();
  const { store } = await import("../src/storage");
  assert.equal((await store.workspaces())[0].id, workspace.id);
  assert.equal((await store.notes())[0].content, "synthetic");
  assert.equal(await (await store.resources())[0].file.text(), "synthetic");
});
