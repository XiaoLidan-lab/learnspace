import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  safeTemplate,
  fromTemplate,
  templateSchema,
  builtins,
  uid,
} from "../src/model";
import { defaultCustomConfig } from "../src/customAI";
import { readConnection, connectionError } from "../src/connections";
import {
  validateMaterialBindings,
  attachMaterials,
} from "../src/sharedMaterials";
import { store } from "../src/storage";
import { cloudPayload, parseCloudPayload } from "../src/cloudData";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
function fixture() {
  const w = fromTemplate(builtins[0]);
  w.modules = w.modules.slice(0, 3);
  const [pdf, note, ai] = w.modules;
  pdf.type = "pdf";
  note.type = "note";
  ai.type = "custom-ai";
  ai.customConfig = defaultCustomConfig();
  pdf.resourceId = "PRIVATE-FILE";
  note.activeNoteId = "PRIVATE-NOTE";
  ai.input = "PRIVATE-INPUT";
  ai.output = "PRIVATE-OUTPUT";
  pdf.data = { text: "PRIVATE-BODY" };
  w.connections = [
    {
      id: uid(),
      source: { moduleId: pdf.id, port: "retrieval", query: "PRIVATE-QUERY" },
      target: { moduleId: ai.id, field: "paper" },
      trigger: "manual",
      mode: "replace",
    },
    {
      id: uid(),
      source: { moduleId: note.id, port: "note", noteId: "PRIVATE-NOTE" },
      target: { moduleId: ai.id, field: "question" },
      trigger: "manual",
      mode: "replace",
    },
  ];
  return { w, t: safeTemplate(w) };
}
test("V2 仅保存白名单配置，重新映射实例和连接；多次安装互不影响", async () => {
  const { w, t } = fixture();
  assert.equal(t.version, 2);
  assert(!JSON.stringify(t).includes("PRIVATE"));
  for (const m of w.modules) assert(!JSON.stringify(t).includes(m.id));
  const a = fromTemplate(t),
    b = fromTemplate(t);
  assert.notEqual(a.id, b.id);
  assert(
    a.modules.every(
      (m, i) =>
        m.id !== b.modules[i].id &&
        !m.data &&
        !m.resourceId &&
        !m.activeNoteId &&
        !m.output,
    ),
  );
  assert.equal(connectionError(a.modules, a.connections!), undefined);
  assert.equal(a.connections![0].source.moduleId, a.modules[0].id);
  assert.equal(a.connections![0].target.moduleId, a.modules[2].id);
  assert(
    a.connections!.every(
      (e) => e.source.needsBinding && !e.source.noteId && !e.source.query,
    ),
  );
  await assert.rejects(
    readConnection(a.connections![0], {
      workspace: a,
      notes: [],
      resources: [],
      selection: null,
    }),
    /重新绑定/,
  );
  a.modules[2].customConfig!.fields[0].label = "changed";
  assert.notEqual(b.modules[2].customConfig!.fields[0].label, "changed");
  assert.notEqual(t.modules[2].customConfig!.fields[0].label, "changed");
  await store.saveInstallation(a, [], []);
  const restored = (await store.workspaces()).find((w) => w.id === a.id)!;
  assert.deepEqual(restored.connections, a.connections);
  assert.deepEqual(
    parseCloudPayload(cloudPayload(a, [])).workspace.connections,
    a.connections,
  );
});
test("V1 继续安装；V2 拒绝私人字段、未知版本、无效端点、占位符和依赖环", async () => {
  for (const t of builtins) assert(fromTemplate(t).modules.length);
  const { t } = fixture();
  const invalid = [
    { ...t, version: 3 },
    { ...t, notes: [] },
    {
      ...t,
      modules: t.modules.map((m, i) =>
        i === 0 ? { ...m, data: { text: "secret" } } : m,
      ),
    },
    {
      ...t,
      connections: [
        {
          ...t.connections![0],
          source: { ...t.connections![0].source, noteId: "private" },
        },
      ],
    },
    {
      ...t,
      connections: [
        {
          ...t.connections![0],
          target: { moduleId: "missing", field: "paper" },
        },
      ],
    },
    {
      ...t,
      modules: t.modules.map((m, i) =>
        i === 2
          ? {
              ...m,
              customConfig: { ...m.customConfig!, prompt: "{{unknown}}" },
            }
          : m,
      ),
    },
  ];
  for (const x of invalid) {
    assert(!templateSchema.safeParse(x).success);
    assert.throws(() => fromTemplate(x as any));
  }
  const cyclic = structuredClone(t);
  cyclic.modules[0].type = "custom-ai";
  cyclic.modules[0].customConfig = defaultCustomConfig();
  cyclic.connections = [
    {
      id: "c1",
      source: { moduleId: "m1", port: "output" },
      target: { moduleId: "m3", field: "paper" },
      trigger: "manual",
      mode: "replace",
    },
    {
      id: "c2",
      source: { moduleId: "m3", port: "output" },
      target: { moduleId: "m1", field: "paper" },
      trigger: "manual",
      mode: "replace",
    },
  ];
  assert(!templateSchema.safeParse(cyclic).success);
  const selectedNote = {
    moduleIndex: 1,
    kind: "note" as const,
    name: "Explicitly selected note",
    text: "shared note",
    noteIndex: 0,
  };
  assert.deepEqual(validateMaterialBindings(t, [selectedNote]), [selectedNote]);
  let calls = 0;
  const installed = await attachMaterials(
    fromTemplate(t),
    t,
    [selectedNote],
    async () => {
      calls++;
      return new Blob();
    },
  );
  assert.equal(installed.notes.length, 1);
  assert.equal(installed.notes[0].content, "shared note");
  assert.equal(installed.workspace.connections![1].source.needsBinding, true);
  assert.equal(calls, 0);
});
test("社区 V2 SQL 可重跑，兼容 V1，拒绝私人内容和非法图结构", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create table public.templates(id uuid primary key,template_config jsonb not null,shared_materials jsonb default '[]',check(template_config->>'version'='1'));",
    );
    const v1 = safeTemplate(fromTemplate(builtins[0]));
    await db.query("insert into templates(id,template_config) values($1,$2)", [
      uid(),
      v1,
    ]);
    const sql = await readFile(
      new URL(
        "../server/migrations/007_combination_templates.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(sql);
    await db.exec(sql);
    const { t } = fixture();
    await db.query("insert into templates(id,template_config) values($1,$2)", [
      uid(),
      t,
    ]);
    await db.query("insert into templates(id,template_config) values($1,$2)", [
      uid(),
      v1,
    ]);
    const ranged = structuredClone(t);
    ranged.connections![0].source = {
      moduleId: "m1",
      port: "selection",
      range: "document",
      needsBinding: true,
    };
    await db.query("insert into templates(id,template_config) values($1,$2)", [
      uid(),
      ranged,
    ]);
    for (const range of ["invalid", null, 7]) {
      const invalid = structuredClone(ranged) as any;
      invalid.connections[0].source.range = range;
      await assert.rejects(
        db.query("insert into templates(id,template_config) values($1,$2)", [
          uid(),
          invalid,
        ]),
      );
    }
    const cycle = structuredClone(t);
    cycle.modules[0].type = "custom-ai";
    cycle.modules[0].customConfig = defaultCustomConfig();
    cycle.connections = [
      {
        id: "c1",
        source: { moduleId: "m1", port: "output" },
        target: { moduleId: "m3", field: "paper" },
        trigger: "manual",
        mode: "replace",
      },
      {
        id: "c2",
        source: { moduleId: "m3", port: "output" },
        target: { moduleId: "m1", field: "paper" },
        trigger: "manual",
        mode: "replace",
      },
    ];
    const secret = { ...t, description: "sk-" + "a".repeat(30) };
    assert(!templateSchema.safeParse(secret).success);
    assert.deepEqual(templateSchema.parse(JSON.parse(JSON.stringify(t))), t);
    const bad = [
      cycle,
      secret,
      {
        ...t,
        connections: [
          {
            ...t.connections![0],
            source: { moduleId: "m1", port: null, needsBinding: true },
          },
        ],
      },
      { ...t, apiKey: "secret" },
      {
        ...t,
        modules: t.modules.map((m, i) =>
          i === 0 ? { ...m, resourceId: "private" } : m,
        ),
      },
      {
        ...t,
        modules: t.modules.map((m, i) =>
          i === 2
            ? { ...m, customConfig: { ...m.customConfig!, apiKey: "secret" } }
            : m,
        ),
      },
      {
        ...t,
        modules: t.modules.map((m, i) =>
          i === 2
            ? {
                ...m,
                customConfig: { ...m.customConfig!, prompt: "{{missing}}" },
              }
            : m,
        ),
      },
      {
        ...t,
        connections: [
          {
            ...t.connections![0],
            source: { ...t.connections![0].source, noteId: "private" },
          },
        ],
      },
      {
        ...t,
        connections: [
          { ...t.connections![0], target: { moduleId: "m90", field: "paper" } },
        ],
      },
      { ...t, connections: [t.connections![0], t.connections![0]] },
    ];
    for (const x of bad)
      await assert.rejects(
        db.query("insert into templates(id,template_config) values($1,$2)", [
          uid(),
          x,
        ]),
      );
    await assert.rejects(
      db.query(
        "insert into templates(id,template_config,shared_materials) values($1,$2,$3)",
        [uid(), t, [{ text: "private" }]],
      ),
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from templates",
        )
      ).rows[0].count,
      4,
    );
  } finally {
    await db.close();
  }
});
