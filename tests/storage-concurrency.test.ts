import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalStore, LocalConflictError } from "../src/storage";
import { createDraftJournal } from "../src/localDrafts";
import { builtins, fromTemplate, type Note } from "../src/model";

async function fixture() {
  const name = `rr001-${crypto.randomUUID()}`;
  const a = createLocalStore(name),
    b = createLocalStore(name);
  const w = fromTemplate(builtins[0]);
  const n: Note = {
    id: crypto.randomUUID(),
    workspaceId: w.id,
    moduleId: w.modules[0].id,
    content: "baseline",
    sources: [],
  };
  await a.saveInstallation(w, [n], []);
  await Promise.all([b.workspaces(), b.notes()]);
  return { name, a, b, w, n };
}

test("RR-001: stale workspace write rejects and preserves committed data", async () => {
  const { a, b, w } = await fixture();
  await a.save({ ...w, description: "tab A saved" });
  await assert.rejects(
    b.save({ ...w, title: "tab B draft" }),
    LocalConflictError,
  );
  assert.equal((await a.workspaces())[0].description, "tab A saved");
});

test("RR-001: unmodified stale records in full autosave do not overwrite other tabs", async () => {
  const { a, b, w, n } = await fixture();
  await a.save({ ...w, description: "new description" });
  await b.saveSnapshot([w], [{ ...n, content: "B note" }]);
  assert.equal((await a.workspaces())[0].description, "new description");
  assert.equal((await a.notes())[0].content, "B note");
});

test("RR-001: two concurrent transactions cannot both overwrite the same baseline", async () => {
  const { a, b, w } = await fixture();
  const results = await Promise.allSettled([
    a.save({ ...w, title: "A" }),
    b.save({ ...w, title: "B" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    results.filter(
      (r) => r.status === "rejected" && r.reason instanceof LocalConflictError,
    ).length,
    1,
  );
});

test("RR-001: different workspaces can be edited concurrently without rewriting untouched rows", async () => {
  const { a, b, w } = await fixture();
  const second = fromTemplate(builtins[0]);
  await a.save(second);
  await b.workspaces();
  await Promise.all([
    a.saveSnapshot([{ ...w, title: "A" }, second], []),
    b.saveSnapshot([w, { ...second, title: "B" }], []),
  ]);
  const result = await a.workspaces();
  assert.equal(result.find((x) => x.id === w.id)?.title, "A");
  assert.equal(result.find((x) => x.id === second.id)?.title, "B");
});

test("RR-001: stale note and workspace snapshot aborts as a unit", async () => {
  const { a, b, w, n } = await fixture();
  await a.saveNote({ ...n, content: "A note" });
  await assert.rejects(
    b.saveSnapshot([{ ...w, title: "B" }], [{ ...n, content: "B note" }]),
    LocalConflictError,
  );
  assert.equal((await a.workspaces())[0].title, w.title);
  assert.equal((await a.notes())[0].content, "A note");
  // A failed transaction must not advance B's workspace baseline.
  await b.save({ ...w, title: "B title only" });
  assert.equal((await a.workspaces())[0].title, "B title only");
});

test("RR-001: delete rejects a concurrently edited record", async () => {
  const { a, b, w, n } = await fixture();
  await a.save({ ...w, title: "A saved" });
  await a.saveNote({ ...n, content: "A saved" });
  await assert.rejects(b.remove(w.id), LocalConflictError);
  await assert.rejects(b.removeNote(n.id), LocalConflictError);
  assert.equal((await a.workspaces()).length, 1);
  assert.equal((await a.notes()).length, 1);
});

test("RR-001: autosave cannot resurrect deleted workspaces or notes", async () => {
  const { a, b, w, n } = await fixture();
  await a.removeNote(n.id);
  await assert.rejects(
    b.saveNote({ ...n, content: "late edit" }),
    LocalConflictError,
  );
  await a.remove(w.id);
  // Even an untouched old full snapshot must not reinsert deleted rows.
  await b.saveSnapshot([w], [n]);
  assert.equal((await a.workspaces()).length, 0);
  assert.equal((await a.notes()).length, 0);
  await assert.rejects(
    b.save({ ...w, title: "late edit" }),
    LocalConflictError,
  );
  await assert.rejects(a.save(w), LocalConflictError);
});

test("RR-001: note edits cannot save into a workspace deleted in another tab", async () => {
  const { a, b, w, n } = await fixture();
  await a.remove(w.id);
  await assert.rejects(
    b.saveNote({ ...n, content: "unsaved draft" }),
    LocalConflictError,
  );
  assert.equal((await a.notes())[0].content, n.content);
});

test("RR-001: rereading for collision checks does not silently rebase stale UI", async () => {
  const { a, b, w } = await fixture();
  await a.save({ ...w, title: "A" });
  await b.workspaces();
  await assert.rejects(b.save({ ...w, title: "B" }), LocalConflictError);
});

test("RR-001: reload creates a fresh baseline and sequential saves remain usable", async () => {
  const { name, a, b, w } = await fixture();
  await a.save({ ...w, title: "A" });
  await assert.rejects(b.save({ ...w, title: "B" }), LocalConflictError);
  const refreshed = createLocalStore(name);
  const latest = (await refreshed.workspaces())[0];
  await refreshed.save({ ...latest, title: "after refresh" });
  await refreshed.save({ ...latest, title: "second save" });
  assert.equal((await a.workspaces())[0].title, "second save");
});

test("RR-001: template installation cannot overwrite an existing workspace", async () => {
  const { a, b, w, n } = await fixture();
  await assert.rejects(
    b.saveInstallation({ ...w, title: "overwrite" }, [n], []),
    LocalConflictError,
  );
  assert.equal((await a.workspaces())[0].title, w.title);
});

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("RR-001: conflict drafts survive refresh, remain independent and never auto-apply", async () => {
  const { a, b, w, n } = await fixture();
  const storage = new MemoryStorage();
  const journal = createDraftJournal(storage, "tab-B");
  const draft = { ...n, content: "B unsaved" };
  journal.retain([w], [draft]);
  await a.saveNote({ ...n, content: "A committed" });
  await assert.rejects(b.saveSnapshot([w], [draft]), LocalConflictError);
  const refreshed = createDraftJournal(storage, "new-page");
  assert.equal(refreshed.drafts()[0].notes[0].content, "B unsaved");
  assert.equal((await a.notes())[0].content, "A committed");
  refreshed.retain([w], [{ ...n, content: "separate new draft" }]);
  assert.equal(journal.drafts().length, 2);
});

test("RR-001: late autosave/pagehide completion cannot discard a newer draft", () => {
  const storage = new MemoryStorage();
  const journal = createDraftJournal(storage, "page");
  const first = journal.retain([], []);
  const w = fromTemplate(builtins[0]);
  const latest = journal.retain([w], []);
  journal.acknowledge(first);
  assert.equal(journal.drafts().length, 1);
  journal.acknowledge(latest);
  assert.equal(journal.drafts().length, 0);
});

test("RR-001: unavailable draft storage throws instead of claiming backup succeeded", () => {
  const storage = new MemoryStorage();
  storage.setItem = () => {
    throw new DOMException("full", "QuotaExceededError");
  };
  assert.throws(
    () => createDraftJournal(storage, "page").retain([], []),
    /full/,
  );
});

test("RR-001: blocked localStorage access is deferred so the app can show backup failure", () => {
  const journal = createDraftJournal(() => {
    throw new DOMException("blocked", "SecurityError");
  }, "page");
  assert.throws(() => journal.retain([], []), /blocked/);
});

test("资料删除仅移除指定文件，刷新和自动保存不会复活文件或删除笔记", async () => {
  const {name, a, w, n} = await fixture();
  const first = { id: crypto.randomUUID(), version: "v1", name: "delete.pdf", file: new Blob(["synthetic file"], {type: "application/pdf"}), createdAt: Date.now() };
  const second = {...first, id: crypto.randomUUID(), name: "keep.pdf"};
  await a.saveResource(first);
  await a.saveResource(second);
  await a.removeResource(first.id);
  await a.saveSnapshot([w], [n]);
  const reopened = createLocalStore(name);
  assert.deepEqual((await reopened.resources()).map(r => r.id), [second.id]);
  assert.deepEqual(await reopened.notes(), [n]);
  assert.deepEqual(await reopened.workspaces(), [w]);
});

test("资料列表删除笔记后，另一个标签页的旧笔记修改被拒绝而不会复活", async () => {
  const {name, a, b, w, n} = await fixture();
  await a.removeNote(n.id);
  await a.saveSnapshot([w], []);
  await assert.rejects(b.saveNote({...n, content: "stale edit"}), LocalConflictError);
  const reopened = createLocalStore(name);
  assert.deepEqual(await reopened.notes(), []);
  assert.deepEqual(await reopened.workspaces(), [w]);
});
