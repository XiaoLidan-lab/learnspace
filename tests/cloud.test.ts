import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fromTemplate, builtins } from "../src/model";
import { addTask, taskFromPlan } from "../src/tasks";
import {
  cloudPayload,
  parseCloudPayload,
  cloudCopy,
  payloadHash,
} from "../src/cloudData";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });
test("云端快照包括完整计划、隔离会话、步骤和成果；不包含本地云端凭证或文件", async () => {
  let w = fromTemplate(builtins[0]);
  const plan = {
    goal: "云端合成学习",
    steps: [
      {
        title: "理解",
        description: "理解资料",
        moduleTypes: ["note" as const],
      },
    ],
    outcomes: ["笔记"],
    layoutReason: "并排",
  };
  w = addTask(w, taskFromPlan(plan, w.modules));
  const n = {
    id: crypto.randomUUID(),
    workspaceId: w.id,
    moduleId: w.modules[0].id,
    taskId: w.activeTaskId,
    content: "private synthetic",
    sources: [],
  };
  w.cloud = { ownerId: "owner", revision: 1, syncedHash: "x", syncedAt: 1 };
  const p = cloudPayload(w, [n]);
  assert.equal(p.workspace.tasks![0].plan!.goal, plan.goal);
  assert(!JSON.stringify(p).includes("syncedHash"));
  assert.equal(await payloadHash(p), await payloadHash(parseCloudPayload(p)));
  const copy = cloudCopy(p);
  assert.notEqual(copy.workspace.id, w.id);
  assert.notEqual(copy.notes[0].id, n.id);
  assert.equal(copy.notes[0].workspaceId, copy.workspace.id);
  assert.throws(() =>
    parseCloudPayload({ ...p, notes: [{ ...n, workspaceId: "other" }] }),
  );
  assert.throws(() =>
    parseCloudPayload({
      ...p,
      workspace: { ...p.workspace, activeTaskId: "missing" },
    }),
  );
  assert.throws(
    () =>
      parseCloudPayload({
        ...p,
        notes: [{ ...n, content: "x".repeat(6 * 1024 * 1024) }],
      }),
    /5 MB/,
  );
});
test("Supabase 迁移可重跑：本人读取、匿名及他人不可读，CAS 冲突不能覆盖，账号隔离", async () => {
  const db = new PGlite();
  const alice = "00000000-0000-4000-8000-000000000001",
    bob = "00000000-0000-4000-8000-000000000002";
  await db.exec(
    `create schema auth; create table auth.users(id uuid primary key); create role authenticated; create role anon; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$; grant usage on schema auth,public to authenticated,anon; insert into auth.users values ('${alice}'),('${bob}');`,
  );
  const migration = await readFile(
    new URL(
      "../server/migrations/005_learning_workspaces.sql",
      import.meta.url,
    ),
    "utf8",
  );
  try {
    await db.exec(migration);
    await db.exec(migration);
    // Upgrade an already-installed 005 (old 40001 business conflict) without data loss.
    await db.exec(migration.replace("errcode='PT409'", "errcode='40001'"));
    const fix = await readFile(
      new URL(
        "../server/migrations/006_learning_conflict_code.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(fix);
    await db.exec(fix);
    const w = fromTemplate(builtins[0]),
      p = cloudPayload(w, []);
    await db.exec(`set role authenticated; set test.uid='${alice}'`);
    const save = async (rev: number) =>
      db.query<{ save_learning_workspace: number }>(
        "select public.save_learning_workspace($1,$2,$3::jsonb)",
        [w.id, rev, JSON.stringify(p)],
      );
    assert.equal((await save(0)).rows[0].save_learning_workspace, 1);
    assert.equal((await save(1)).rows[0].save_learning_workspace, 2);
    const beforePatch = await db.query(
      "select workspace_id, revision, payload from public.learning_workspaces",
    );
    await db.exec("reset role");
    await db.exec(fix);
    await db.exec(`set role authenticated; set test.uid='${alice}'`);
    assert.deepEqual(
      (
        await db.query(
          "select workspace_id, revision, payload from public.learning_workspaces",
        )
      ).rows,
      beforePatch.rows,
    );
    await assert.rejects(
      save(1),
      (e: any) => e.code === "PT409" && /conflict/.test(e.message),
    );
    assert.equal(
      (await db.query("select * from public.learning_workspaces")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("update public.learning_workspaces set revision=99"),
      /permission denied/,
    );
    await db.exec(`set test.uid='${bob}'`);
    assert.equal(
      (await db.query("select * from public.learning_workspaces")).rows.length,
      0,
    );
    await assert.rejects(save(2), /conflict/);
    assert.equal((await save(0)).rows[0].save_learning_workspace, 1);
    await db.exec("reset role;set role anon;set test.uid=''");
    await assert.rejects(
      db.query("select * from public.learning_workspaces"),
      /permission denied/,
    );
    await assert.rejects(save(0), /permission denied/);
    await db.exec(`reset role;set role authenticated;set test.uid='${alice}'`);
    await assert.rejects(
      db.query("select public.save_learning_workspace($1,2,$2::jsonb)", [
        w.id,
        JSON.stringify({ ...p, notes: [{ workspaceId: bob }] }),
      ]),
      /Invalid learning payload/,
    );
  } finally {
    await db.close();
  }
});

test("云端保存整个请求有超时边界，调用方取消不等待底层网络，CAS 冲突有明确说明", async (t) => {
  const { saveCloud } = await import("../src/cloudService");
  const w = { ...fromTemplate(builtins[0]), isolationVersion: 1 as const };
  const payload = cloudPayload(w, []);
  let aborted = false;
  const never = {
    rpc: () => ({
      abortSignal: (signal: AbortSignal) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
    }),
  } as any;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timed = assert.rejects(
    saveCloud(never, w.id, 0, payload),
    /超时.*尚未确认/,
  );
  t.mock.timers.tick(20000);
  await timed;
  assert(aborted);
  t.mock.timers.reset();
  const abort = new AbortController();
  const cancelled = assert.rejects(
    saveCloud(never, w.id, 0, payload, abort.signal),
    { name: "AbortError" },
  );
  abort.abort();
  await cancelled;
  const conflict = {
    rpc: () => ({
      abortSignal: () =>
        Promise.resolve({ data: null, error: { code: "PT409" } }),
    }),
  } as any;
  await assert.rejects(
    saveCloud(conflict, w.id, 1, payload),
    /云端版本已改变.*另存副本/,
  );
});
