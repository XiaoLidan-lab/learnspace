import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
import {
  materialCandidates,
  attachMaterials,
  validateMaterialBindings,
  type SharedMaterial,
} from "../src/sharedMaterials";
import { uploadMaterials } from "../src/materialService";
import {
  safeTemplate,
  fromTemplate,
  uid,
  type Workspace,
  type Resource,
  type Note,
} from "../src/model";
import { store } from "../src/storage";
const workspace = (): Workspace => ({
  id: uid(),
  title: "Selective sharing",
  description: "",
  createdAt: 1,
  updatedAt: 1,
  modules: [
    {
      id: uid(),
      type: "pdf",
      title: "PDF",
      layout: { x: 0, y: 0, w: 6, h: 6 },
    },
    {
      id: uid(),
      type: "note",
      title: "Notes",
      layout: { x: 6, y: 0, w: 6, h: 6 },
    },
    {
      id: uid(),
      type: "chat",
      title: "Chat",
      layout: { x: 0, y: 6, w: 6, h: 6 },
      messages: [{ role: "user", content: "private-chat" }],
    },
    {
      id: uid(),
      type: "text",
      title: "Text",
      layout: { x: 6, y: 6, w: 6, h: 6 },
      data: { text: "shareable reading", transcript: "private-transcript" },
    },
  ],
});
test("Selective publication transfers only chosen files and one chosen note, installs independent copies atomically", async () => {
  const w = workspace();
  const r: Resource = {
    id: uid(),
    name: "reading.pdf",
    version: uid(),
    createdAt: 1,
    file: new Blob(["synthetic PDF"], { type: "application/pdf" }),
  };
  w.modules[0].resourceId = r.id;
  const notes: Note[] = ["shared-note", "private-note"].map((content) => ({
    id: uid(),
    workspaceId: w.id,
    moduleId: w.modules[1].id,
    content,
    sources: [
      {
        resourceId: "private-source",
        version: "1",
        page: 1,
        text: "private-excerpt",
      },
    ],
  }));
  const candidates = materialCandidates(w, [r], notes);
  assert.equal(candidates.length, 4);
  assert(!JSON.stringify(candidates).includes("private-chat"));
  assert(!JSON.stringify(candidates).includes("private-source"));
  let uploads = 0;
  const client: any = {
    storage: {
      from: () => ({
        upload: async () => {
          uploads++;
          return { error: null };
        },
      }),
    },
  };
  const template = safeTemplate(w);
  const paths: string[] = [];
  const selected = candidates
    .filter((c) => c.kind === "file" || c.value === "shared-note")
    .map((c) => c.id);
  const published = await uploadMaterials(
    client,
    uid(),
    uid(),
    template,
    candidates,
    selected,
    paths,
  );
  assert.equal(uploads, 1);
  assert.equal(published.length, 2);
  assert(!JSON.stringify(published).includes("private-"));
  assert(!JSON.stringify(published).includes("shareable reading"));
  const installed = await attachMaterials(
    fromTemplate(template),
    template,
    published,
    async () => r.file,
  );
  assert.notEqual(installed.workspace.modules[0].resourceId, r.id);
  assert.equal(installed.notes.length, 1);
  assert.equal(installed.notes[0].content, "shared-note");
  assert.deepEqual(installed.notes[0].sources, []);
  assert.notEqual(installed.notes[0].id, notes[0].id);
  assert.equal(installed.notes[0].moduleId, installed.workspace.modules[1].id);
  assert.equal(installed.workspace.modules[2].messages, undefined);
  assert.equal(installed.workspace.modules[3].data, undefined);
  await store.saveInstallation(
    installed.workspace,
    installed.notes,
    installed.resources,
  );
  assert(
    (await store.resources()).some((x) => x.id === installed.resources[0].id),
  );
  assert((await store.notes()).some((x) => x.id === installed.notes[0].id));
  assert(
    (await store.workspaces()).some((x) => x.id === installed.workspace.id),
  );
});
test("Empty selection never uploads, bindings reject private fields, unsafe links and mismatched modules", async () => {
  const w = workspace(),
    template = safeTemplate(w);
  let uploads = 0;
  const client: any = {
    storage: {
      from: () => ({
        upload: () => {
          uploads++;
          throw Error("must not upload");
        },
      }),
    },
  };
  assert.deepEqual(
    await uploadMaterials(
      client,
      uid(),
      uid(),
      template,
      materialCandidates(w, []),
      [],
      [],
    ),
    [],
  );
  assert.equal(uploads, 0);
  assert.throws(() =>
    validateMaterialBindings(template, [
      {
        moduleIndex: 2,
        kind: "note",
        name: "Chat",
        noteIndex: 0,
        text: "private-chat",
      },
    ]),
  );
  assert.throws(() =>
    validateMaterialBindings(template, [
      {
        moduleIndex: 3,
        kind: "text",
        name: "Text",
        text: "content",
        sources: ["private"],
      },
    ]),
  );
  assert.throws(() =>
    validateMaterialBindings(template, [
      { moduleIndex: 0, kind: "url", name: "URL", url: "javascript:alert(1)" },
    ]),
  );
  assert.throws(() =>
    validateMaterialBindings(template, [
      { moduleIndex: 3, kind: "text", name: "Text", text: "a" },
      { moduleIndex: 3, kind: "text", name: "Text", text: "b" },
    ]),
  );
});
test("Download failure creates no workspace or partial resources", async () => {
  const t = safeTemplate(workspace());
  const before = (await store.workspaces()).length;
  const materials: SharedMaterial[] = [
    {
      moduleIndex: 0,
      kind: "file",
      name: "file.pdf",
      path: `${uid()}/${uid()}/${uid()}`,
      mime: "application/pdf",
      size: 10,
    },
  ];
  await assert.rejects(
    attachMaterials(fromTemplate(t), t, materials, async () => {
      throw Error("unavailable");
    }),
    /unavailable/,
  );
  assert.equal((await store.workspaces()).length, before);
});

test("IndexedDB installation aborts all writes if a resource cannot be cloned", async () => {
  const w = workspace();
  const r: any = {
    id: uid(),
    name: "invalid",
    file: () => {},
    version: "1",
    createdAt: 1,
  };
  await assert.rejects(store.saveInstallation(w, [], [r]));
  assert(!(await store.workspaces()).some((x) => x.id === w.id));
  assert(!(await store.resources()).some((x) => x.id === r.id));
});
