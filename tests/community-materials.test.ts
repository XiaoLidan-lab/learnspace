import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  safeTemplate,
  fromTemplate,
  templateSchema,
  uid,
  type Workspace,
  type Note,
  type Resource,
} from "../src/model";
import {
  connectionError,
  inputPorts,
  outputPorts,
  privateConnectionSource,
} from "../src/connectionGraph";
import { types } from "../src/definitions";
import { defaultCustomConfig } from "../src/customAI";
import {
  attachMaterials,
  materialCandidates,
  validateMaterialBindings,
} from "../src/sharedMaterials";
import { uploadMaterials } from "../src/materialService";

const sql = (name: string) =>
  readFile(new URL(`../server/${name}`, import.meta.url), "utf8");
const author = "00000000-0000-4000-8000-000000000001";
function workspace(): Workspace {
  return {
    id: uid(),
    title: "Community learning",
    description: "",
    createdAt: 1,
    updatedAt: 1,
    modules: ["pdf", "note", "chat", "quiz", "mindmap"].map((type, i) => ({
      id: uid(),
      type: type as "pdf",
      title: type,
      layout: { x: (i % 2) * 6, y: Math.floor(i / 2) * 5, w: 6, h: 5 },
    })),
  };
}
test("current material presets publish only selected resources; installs keep independent IDs and safe binding", async () => {
  const w = workspace();
  const [pdf, note, chat, quiz, map] = w.modules;
  const resource: Resource = {
    id: uid(),
    name: "shared.pdf",
    version: uid(),
    createdAt: 1,
    file: new Blob(["synthetic PDF"], { type: "application/pdf" }),
  };
  pdf.resourceId = resource.id;
  chat.messages = [{ role: "assistant", content: "PRIVATE-ANSWER" }];
  const notes: Note[] = ["explicitly shared note", "PRIVATE-NOTE"].map(
    (content) => ({
      id: uid(),
      moduleId: note.id,
      workspaceId: w.id,
      content,
      sources: [{ text: "PRIVATE-CITATION" }] as any,
    }),
  );
  for (const target of [chat, quiz, map])
    target.data = {
      flow: {
        inputs: [],
        materials: [
          {
            id: uid(),
            source: { moduleId: pdf.id, port: "selection", range: "document" },
            target: {
              moduleId: target.id,
              field: target.type === "chat" ? "context" : "input",
            },
            trigger: "manual",
            mode: "replace",
          },
        ],
      },
    };
  w.connections = [
    {
      id: uid(),
      source: { moduleId: note.id, port: "note", noteId: notes[1].id },
      target: { moduleId: chat.id, field: "context" },
      trigger: "manual",
      mode: "replace",
    },
  ];
  // Both module-local material presets and legacy workspace connections must survive.
  chat.data!.flow!.materials!.push(w.connections[0]);
  chat.data!.flow!.materials!.push({
    ...w.connections[0],
    id: uid(),
    source: { ...w.connections[0].source, noteId: notes[0].id },
  });
  const t = templateSchema.parse(safeTemplate(w));
  assert.equal(t.connections!.length, 4);
  assert(!JSON.stringify(t).includes("PRIVATE"));
  const candidates = materialCandidates(w, [resource], notes);
  const uploaded: string[] = [];
  const client: any = {
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploaded.push(path);
          return { error: null };
        },
      }),
    },
  };
  const selected = candidates
    .filter((c) => c.kind === "file" || c.value === notes[0].content)
    .map((c) => c.id);
  const paths: string[] = [];
  const materials = await uploadMaterials(
    client,
    author,
    uid(),
    t,
    candidates,
    selected,
    paths,
  );
  assert.equal(uploaded.length, 1);
  assert.deepEqual(paths, uploaded);
  assert(!JSON.stringify(materials).includes("PRIVATE"));
  const a = await attachMaterials(
    fromTemplate(t),
    t,
    materials,
    async () => resource.file,
  );
  const b = await attachMaterials(
    fromTemplate(t),
    t,
    materials,
    async () => resource.file,
  );
  assert.notEqual(a.resources[0].id, b.resources[0].id);
  assert.notEqual(a.notes[0].id, b.notes[0].id);
  assert.equal(a.notes[0].content, notes[0].content);
  assert.deepEqual(a.notes[0].sources, []);
  assert.equal(
    connectionError(a.workspace.modules, a.workspace.connections!),
    undefined,
  );
  for (const e of a.workspace.connections!) {
    if (e.source.port === "note") {
      assert.equal(e.source.needsBinding, true);
      assert.equal(e.source.noteId, undefined);
    } else assert.equal(e.source.needsBinding, undefined);
  }
  const empty = await attachMaterials(fromTemplate(t), t, [], async () => {
    throw Error("must not download");
  });
  assert.equal(empty.resources.length, 0);
  assert(empty.workspace.connections!.every((e) => e.source.needsBinding));
  const noteOnly = await attachMaterials(
    fromTemplate(t),
    t,
    materials.filter((m) => m.kind === "note"),
    async () => {
      throw Error("must not download");
    },
  );
  assert(noteOnly.workspace.connections!.every((e) => e.source.needsBinding));
  assert.throws(() =>
    validateMaterialBindings(t, [{ ...materials[1], sources: ["private"] }]),
  );
  assert.throws(() =>
    validateMaterialBindings(t, [{ ...materials[0], moduleIndex: 2 }]),
  );
});

test("011 SQL matches current port compatibility, accepts opt-in materials, preserves privacy validation and old rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role authenticated; create role anon;
      create function auth.uid() returns uuid language sql stable as 'select null::uuid';
      insert into auth.users values ('${author}');
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
      alter table storage.objects enable row level security; grant usage on schema public,storage to authenticated,anon;`);
    await db.exec(await sql("supabase.sql"));
    await db.exec(await sql("migrations/004_shared_materials.sql"));
    await db.exec(await sql("migrations/007_combination_templates.sql"));
    const insert = (config: unknown, materials: unknown[] = [], id = uid()) =>
      db.query(
        "insert into public.templates(id,author_id,author_name,title,category,template_config,shared_materials) values($1,$2,'Synthetic','Test','通用学习',$3,$4)",
        [id, author, JSON.stringify(config), JSON.stringify(materials)],
      );
    const old = safeTemplate(workspace());
    const oldId = uid();
    await insert(old, [], oldId);
    const snapshot = await db.query("select * from templates where id=$1", [
      oldId,
    ]);
    const policies = await db.query(
      "select * from pg_policies where schemaname in ('public','storage') order by tablename,policyname",
    );
    const update = await sql("migrations/011_community_learning_materials.sql");
    await db.exec(update);
    await db.exec(update);
    assert.deepEqual(
      await db.query("select * from templates where id=$1", [oldId]),
      snapshot,
    );
    assert.deepEqual(
      await db.query(
        "select * from pg_policies where schemaname in ('public','storage') order by tablename,policyname",
      ),
      policies,
    );

    // Exercise every current output against each input, including multiple sources.
    for (const sourceType of types) {
      for (const port of outputPorts(sourceType)) {
        for (const targetType of types) {
          const config =
            targetType === "custom-ai" ? defaultCustomConfig() : undefined;
          for (const field of inputPorts({
            type: targetType,
            customConfig: config,
          })) {
            const w = workspace();
            w.modules = w.modules.slice(0, 2);
            w.modules[0].type = sourceType;
            w.modules[1].type = targetType;
            if (sourceType === "custom-ai")
              w.modules[0].customConfig = defaultCustomConfig();
            if (config) w.modules[1].customConfig = config;
            const e = {
              id: "c1",
              source: {
                moduleId: "m1",
                port,
                ...(privateConnectionSource(sourceType, port)
                  ? { needsBinding: true as const }
                  : {}),
              },
              target: { moduleId: "m2", field: field.id },
              trigger: "manual" as const,
              mode: "replace" as const,
            };
            const t = {
              ...safeTemplate(w),
              version: 2 as const,
              modules: safeTemplate(w).modules.map((m, i) => ({
                ...m,
                instanceId: `m${i + 1}`,
              })),
              connections: [e],
            };
            const valid = field.accept.includes(port);
            assert.equal(
              templateSchema.safeParse(t).success,
              valid,
              `${sourceType}:${port}->${targetType}:${field.id}`,
            );
            if (valid) await insert(t);
            else await assert.rejects(insert(t));
          }
        }
      }
    }
    const w = workspace();
    w.connections = [1, 2].map((i) => ({
      id: uid(),
      source: {
        moduleId: w.modules[i - 1].id,
        port: i === 1 ? ("selection" as const) : ("note" as const),
        needsBinding: true as const,
        ...(i === 1 ? { range: "document" as const } : {}),
      },
      target: { moduleId: w.modules[2].id, field: "context" },
      trigger: "manual" as const,
      mode: "replace" as const,
    }));
    const t = templateSchema.parse(safeTemplate(w));
    const id = uid();
    const path = `${author}/${id}/${uid()}`;
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('learnspace-materials',$1,$2)",
      [path, JSON.stringify({ size: 12, mimetype: "application/pdf" })],
    );
    const file = {
      moduleIndex: 0,
      kind: "file",
      name: "test.pdf",
      path,
      mime: "application/pdf",
      size: 12,
    };
    const note = {
      moduleIndex: 1,
      kind: "note",
      name: "Selected",
      noteIndex: 0,
      text: "public note",
    };
    await insert(t, [file, note], id);
    await insert(t, [note]);
    await assert.rejects(
      insert(t, [{ ...note, sources: [{ text: "private" }] }]),
    );
    await assert.rejects(
      insert(t, [{ ...file, path: `${uid()}/${id}/${uid()}` }]),
    );
    await assert.rejects(insert(t, [{ ...note, moduleIndex: 0 }]));
    await assert.rejects(insert(t, [note, note]));
    for (const patch of [
      { source: { ...t.connections![0].source, noteId: "PRIVATE" } },
      { source: { moduleId: "m1", port: "selection", needsBinding: false } },
      { target: { moduleId: "m3", field: "missing" } },
    ])
      await assert.rejects(
        insert({ ...t, connections: [{ ...t.connections![0], ...patch }] }),
      );
    await assert.rejects(
      insert({
        ...t,
        connections: [t.connections![0], { ...t.connections![0], id: "c3" }],
      }),
    );
    const cycle = {
      ...t,
      modules: t.modules.map((m, i) => (i < 2 ? { ...m, type: "chat" } : m)),
      connections: [
        {
          id: "c1",
          source: { moduleId: "m1", port: "answer" },
          target: { moduleId: "m2", field: "context" },
          trigger: "manual",
          mode: "replace",
        },
        {
          id: "c2",
          source: { moduleId: "m2", port: "answer" },
          target: { moduleId: "m1", field: "context" },
          trigger: "manual",
          mode: "replace",
        },
      ],
    };
    await assert.rejects(insert(cycle), /cycle/);
  } finally {
    await db.close();
  }
});
