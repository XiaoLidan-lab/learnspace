import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const setup = await readFile(
  new URL("../server/supabase.sql", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL("../server/migrations/002_module_system.sql", import.meta.url),
  "utf8",
);
async function database() {
  const db = new PGlite();
  await db.exec(
    `create schema auth; create table auth.users(id uuid primary key); create role authenticated; create function auth.uid() returns uuid language sql stable as 'select null::uuid'; insert into auth.users values ('00000000-0000-4000-8000-000000000001');`,
  );
  await db.exec(
    `create role anon; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb); alter table storage.objects enable row level security; grant usage on schema public,storage to authenticated,anon; grant select,insert,delete on storage.objects to authenticated; grant select on storage.objects to anon;`,
  );
  return db;
}
const template = (modules: unknown[]) => ({
  version: 1,
  title: "SQL test",
  description: "",
  modules,
});
const module = (settings?: unknown) => ({
  type: "pomodoro",
  title: "Focus",
  layout: { x: 0, y: 0, w: 4, h: 5 },
  ...(settings ? { settings } : {}),
});
async function insert(db: PGlite, config: unknown) {
  return db.query(
    `insert into public.templates(author_id,author_name,title,category,template_config) values ('00000000-0000-4000-8000-000000000001','Tester','SQL test','通用学习',$1::jsonb) returning id`,
    [JSON.stringify(config)],
  );
}
test("完整 SQL 与升级脚本可以执行和重复执行，触发器实际工作", async () => {
  const db = await database();
  try {
    await db.exec(setup);
    await db.exec(setup);
    await db.exec(migration);
    await db.exec(migration);
    await insert(
      db,
      template([module({ focusMinutes: 120, breakMinutes: 60 })]),
    );
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from public.templates",
        )
      ).rows[0].count,
      1,
    );
    await assert.rejects(
      insert(db, template([module({ focusMinutes: 121 })])),
      /Invalid timer/,
    );
    await assert.rejects(
      insert(db, template([module({ breakMinutes: 61 })])),
      /Invalid timer/,
    );
    await assert.rejects(
      insert(db, template([module({ focusMinutes: 0 })])),
      /Invalid timer/,
    );
    await assert.rejects(
      insert(db, template([module({ focusMinutes: 1.5 })])),
      /Invalid timer/,
    );
    await assert.rejects(
      insert(db, template([{ ...module(), data: { text: "private" } }])),
      /Private or unsupported module data/,
    );
    await assert.rejects(
      insert(db, template([module({ apiKey: "private" })])),
      /Private or unsupported settings/,
    );
    await assert.rejects(
      insert(db, template([module(), module()])),
      /Duplicate overlapping modules/,
    );
    const grouped = { ...module(), group: "tabs" };
    await insert(db, template([grouped, grouped]));
    await assert.rejects(
      insert(
        db,
        template([grouped, { ...grouped, layout: { x: 4, y: 0, w: 4, h: 5 } }]),
      ),
      /Grouped modules require identical layouts/,
    );
    await assert.rejects(
      insert(
        db,
        template([{ ...module(), layout: { x: 10, y: 0, w: 4, h: 5 } }]),
      ),
      /Invalid layout bounds/,
    );
  } finally {
    await db.close();
  }
});
test("升级脚本保留既有模板并补建缺失的触发器", async () => {
  const db = await database();
  try {
    await db.exec(setup);
    await insert(db, template([module({ focusMinutes: 25 })]));
    await db.exec("drop trigger template_privacy on public.templates");
    await db.exec(migration);
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from public.templates",
        )
      ).rows[0].count,
      1,
    );
    await assert.rejects(
      insert(db, template([module({ focusMinutes: 200 })])),
      /Invalid timer/,
    );
  } finally {
    await db.close();
  }
});

test("直接发布升级保留隐私校验，公开旧提交，RLS 只允许发布本人模板", async () => {
  const db = await database();
  try {
    await db.exec(setup);
    await db.query(
      `insert into public.templates(author_id,author_name,title,category,template_config,publication_status) values ('00000000-0000-4000-8000-000000000001','Tester','Old','通用学习',$1,'pending')`,
      [JSON.stringify(template([module()]))],
    );
    const direct = await readFile(
      new URL(
        "../server/migrations/003_direct_publication.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(direct);
    await db.exec(direct);
    assert.equal(
      (
        await db.query<{ publication_status: string }>(
          "select publication_status from public.templates",
        )
      ).rows[0].publication_status,
      "published",
    );
    await db.exec(
      `create or replace function auth.uid() returns uuid language sql stable as 'select ''00000000-0000-4000-8000-000000000001''::uuid'; grant select,insert on public.templates to authenticated; set role authenticated;`,
    );
    await insert(db, template([module()]));
    await assert.rejects(
      db.query(
        `insert into public.templates(author_id,author_name,title,category,template_config) values ('00000000-0000-4000-8000-000000000002','Other','Other','通用学习',$1)`,
        [JSON.stringify(template([module()]))],
      ),
      /row-level security/,
    );
    await assert.rejects(
      insert(db, template([{ ...module(), data: { text: "private" } }])),
      /Private or unsupported module data/,
    );
  } finally {
    await db.close();
  }
});

test("共享资料迁移可重复执行，按篇笔记与文件校验，未发布文件不可公开下载", async () => {
  const db = await database();
  try {
    await db.exec(setup);
    const migration = await readFile(
      new URL("../server/migrations/004_shared_materials.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    const author = "00000000-0000-4000-8000-000000000001";
    const templateId = "00000000-0000-4000-8000-000000000011";
    const path = `${author}/${templateId}/00000000-0000-4000-8000-000000000021`;
    const config = template([
      { type: "pdf", title: "PDF", layout: { x: 0, y: 0, w: 6, h: 6 } },
      { type: "note", title: "Notes", layout: { x: 6, y: 0, w: 6, h: 6 } },
    ]);
    const file = {
      kind: "file",
      moduleIndex: 0,
      name: "test.pdf",
      path,
      mime: "application/pdf",
      size: 12,
    };
    const note = {
      kind: "note",
      moduleIndex: 1,
      name: "Selected",
      noteIndex: 0,
      text: "share this note",
    };
    await db.query(
      `insert into storage.objects(bucket_id,name,metadata) values ('learnspace-materials',$1,'{"size":12,"mimetype":"application/pdf"}')`,
      [path],
    );
    await db.exec("grant select on public.templates to anon");
    await db.exec("set role anon");
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await db.exec("reset role");
    const publish = (items: unknown[]) =>
      db.query(
        `insert into public.templates(id,author_id,author_name,title,category,template_config,shared_materials) values ($1,$2,'Tester','Shared','通用学习',$3,$4)`,
        [templateId, author, JSON.stringify(config), JSON.stringify(items)],
      );
    await assert.rejects(
      publish([{ ...note, sources: [{ text: "private source" }] }]),
      /Unsupported shared material field/,
    );
    await assert.rejects(
      publish([{ ...note, moduleIndex: 0 }]),
      /Invalid shared text/,
    );
    await assert.rejects(
      publish([
        {
          ...file,
          path: `00000000-0000-4000-8000-000000000002/${templateId}/00000000-0000-4000-8000-000000000021`,
        },
      ]),
      /Invalid shared file ownership/,
    );
    await assert.rejects(
      publish([{ ...file, size: 100 }]),
      /metadata mismatch/,
    );
    await publish([file, note]);
    await db.exec("set role anon");
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    );
    await db.exec("reset role");
    await db.query(
      `update public.templates set publication_status='pending' where id=$1`,
      [templateId],
    );
    await db.exec("set role anon");
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await db.exec("reset role");
    const bucket = await db.query<{ public: boolean }>(
      "select public from storage.buckets",
    );
    assert.equal(bucket.rows[0].public, false);
  } finally {
    await db.close();
  }
});
