import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createApp } from "../server/api";
import {
  AIServiceError,
  outputTokenLimits,
  reservationUnits,
  providerTokenOptions,
  supabaseQuota,
  type AIQuota,
} from "../server/aiQuota";
import { readAIResponse } from "../src/apiResponse";
import { createServer, type Server } from "node:http";

const migration = await readFile(
  new URL("../server/migrations/008_ai_quota.sql", import.meta.url),
  "utf8",
);
const user = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const hash = "a".repeat(64);
async function fixture() {
  const db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role; grant usage on schema public to anon,authenticated,service_role;",
  );
  await db.exec(migration);
  async function call(
    operation: string,
    request: string = crypto.randomUUID(),
    owner = user,
    units = 100,
    fingerprint = hash,
  ) {
    const result = await db.query<{
      result: { allowed: boolean; code?: string; retry_after?: number };
    }>(
      "select public.learnspace_ai_quota($1,$2::uuid,$3::uuid,$4,$5::bigint) as result",
      [operation, owner, request, fingerprint, units],
    );
    return result.rows[0].result;
  }
  const quota: AIQuota = {
    async apply(input) {
      const result = await call(
        input.operation,
        input.request,
        input.user,
        input.units || 0,
        input.hash || "",
      );
      if (!result.allowed)
        throw new AIServiceError(
          result.code === "DUPLICATE" || result.code === "EXPIRED" ? 409 : 429,
          result.code!,
          "配额拒绝",
          result.retry_after,
        );
    },
  };
  return { db, call, quota };
}
async function serve(
  quota: AIQuota,
  complete:
    | NonNullable<Parameters<typeof createApp>[0]>["complete"]
    | null = async () => "译文",
  timeoutMs?: number,
) {
  const app = createApp(
    {
      quota,
      authenticate: async () => user,
      complete: complete || undefined,
      timeoutMs,
    },
    { serveFrontend: false },
  );
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  return {
    post: (
      payload: unknown = {
        action: "translate",
        payload: { text: "hello", language: "简体中文" },
      },
      id?: string,
      signal?: AbortSignal,
    ) =>
      fetch(`http://127.0.0.1:${port}/api/ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer synthetic",
          ...(id ? { "Idempotency-Key": id } : {}),
        },
        body: JSON.stringify(payload),
        signal,
      }),
    raw: (body: string) =>
      fetch(`http://127.0.0.1:${port}/api/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

test("quota migration is repeatable; anonymous/authenticated cannot access tables or RPC; service_role can call RPC only", async () => {
  const { db } = await fixture();
  try {
    await db.exec(migration);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query("select * from public.ai_quota_policy"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select public.learnspace_ai_quota('finish',$1,$2,'',0)", [
          user,
          crypto.randomUUID(),
        ]),
        /permission denied/,
      );
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("update public.ai_quota_policy set enabled=false"),
      /permission denied/,
    );
    await db.query("select public.learnspace_ai_quota('finish',$1,$2,'',0)", [
      user,
      crypto.randomUUID(),
    ]);
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});

test("atomic reservation races enforce shared user/global concurrency and reject duplicate IDs", async () => {
  const { db, call } = await fixture();
  try {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.all(
      ids.map((id, i) => call("begin", id, user, 100, String(i).repeat(64))),
    );
    assert.equal(results.filter((x) => x.allowed).length, 1);
    assert.equal(results.find((x) => !x.allowed)?.code, "CONCURRENCY");
    const winner = ids[results.findIndex((x) => x.allowed)];
    assert.equal((await call("begin", winner)).code, "DUPLICATE");
    await call("finish", winner);
    assert.equal((await call("begin", winner)).code, "DUPLICATE");
    await db.exec("update public.ai_quota_policy set global_concurrency=1");
    assert.equal((await call("begin", crypto.randomUUID())).allowed, true);
    assert.equal(
      (await call("begin", crypto.randomUUID(), other)).code,
      "CONCURRENCY",
    );
  } finally {
    await db.close();
  }
});

test("two createApp instances and a fresh cold-start instance share the same database minute quota", async () => {
  const { db, quota } = await fixture();
  await db.exec("update public.ai_quota_policy set requests_per_minute=2");
  const a = await serve(quota),
    b = await serve(quota);
  let cold: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    assert.equal((await a.post()).status, 200);
    assert.equal((await b.post()).status, 200);
    cold = await serve(quota);
    const denied = await cold.post();
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).code, "RATE_LIMIT");
    assert(denied.headers.get("retry-after"));
  } finally {
    await a.close();
    await b.close();
    await cold?.close();
    await db.close();
  }
});

test("duplicate clicks during execution never invoke a second provider, including across instances", async () => {
  const { db, quota } = await fixture();
  let done!: () => void,
    started!: () => void,
    calls = 0;
  const entered = new Promise<void>((r) => (started = r));
  const wait = new Promise<void>((r) => (done = r));
  const complete = async () => {
    calls++;
    started();
    await wait;
    return "译文";
  };
  const a = await serve(quota, complete),
    b = await serve(quota, complete);
  try {
    const id = crypto.randomUUID();
    const pending = a.post(undefined, id);
    await entered;
    assert.equal((await b.post(undefined, id)).status, 409);
    assert.equal((await b.post()).status, 409); // new ID, identical active payload
    done();
    assert.equal((await pending).status, 200);
    assert.equal((await b.post(undefined, id)).status, 409);
    assert.equal(calls, 1);
  } finally {
    done();
    await a.close();
    await b.close();
    await db.close();
  }
});

test("budget races cannot overspend; day rollover does not reset lifetime budget; failure never refunds", async () => {
  const { db, call } = await fixture();
  try {
    await db.exec(
      "update public.ai_quota_policy set global_total_units=150, global_daily_units=150,user_daily_units=150",
    );
    const requests = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.all([
      call("begin", requests[0], user, 100),
      call("begin", requests[1], other, 100),
    ]);
    assert.equal(results.filter((r) => r.allowed).length, 1);
    assert.equal(results.find((r) => !r.allowed)?.code, "BUDGET");
    await call("finish", requests[0]);
    await call("finish", requests[1], other);
    await db.exec(
      "delete from public.ai_quota_counters where bucket <> 'global:total'",
    );
    assert.equal(
      (await call("begin", crypto.randomUUID(), user, 51)).code,
      "BUDGET",
    );
    assert.equal(
      (
        await db.query<{ used: number }>(
          "select used::int from public.ai_quota_counters where bucket='global:total'",
        )
      ).rows[0].used,
      100,
    );
  } finally {
    await db.close();
  }
});

test("expired leases recover capacity but cannot reserve again, and charged units remain", async () => {
  const { db, call } = await fixture();
  try {
    const id = crypto.randomUUID();
    await call("begin", id);
    await db.exec(
      "update public.ai_quota_requests set expires_at=clock_timestamp()-interval '1 second'",
    );
    assert.equal((await call("reserve", id)).code, "EXPIRED");
    assert.equal((await call("begin", crypto.randomUUID())).allowed, true);
    assert.equal(
      (
        await db.query<{ used: number }>(
          "select used::int from public.ai_quota_counters where bucket='global:total'",
        )
      ).rows[0].used,
      200,
    );
  } finally {
    await db.close();
  }
});

test("quota failure is fail-closed; timeout keeps a protective lease and never refunds", async () => {
  let calls = 0;
  const down = await serve(
    {
      async apply() {
        throw new AIServiceError(503, "QUOTA_UNAVAILABLE", "配额不可用");
      },
    },
    async () => {
      calls++;
      return "unexpected";
    },
  );
  try {
    assert.equal((await down.post()).status, 503);
    assert.equal(calls, 0);
  } finally {
    await down.close();
  }
  const { db, quota } = await fixture();
  const hung = await serve(
    quota,
    async (_a, _p, _i, options) => {
      assert(options.signal);
      assert.equal(options.maxTokens, 8192);
      return new Promise<string>(() => {});
    },
    80,
  );
  try {
    const response = await hung.post();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "AI_TIMEOUT");
    // Upstream cancellation is uncertain: block immediate retry until the DB lease expires.
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.ai_quota_requests where not finished",
        )
      ).rows[0].n,
      1,
    );
    assert(
      (
        await db.query<{ used: number }>(
          "select used::int from public.ai_quota_counters where bucket='global:total'",
        )
      ).rows[0].used > 0,
    );
    assert.equal(
      (
        await hung.post({
          action: "documentDigest",
          payload: { text: "different input" },
        })
      ).status,
      429,
    );
    await db.exec(
      "update public.ai_quota_requests set expires_at=clock_timestamp()-interval '1 second'",
    );
  } finally {
    await hung.close();
    await db.close();
  }
});

test("layout repair reserves a second attempt; budget denial prevents second model call", async () => {
  const { db, quota } = await fixture();
  let calls = 0;
  const app = await serve(quota, async () => {
    calls++;
    await db.exec(
      "update public.ai_quota_policy set global_total_units=(select used from public.ai_quota_counters where bucket='global:total' and period=0)",
    );
    return '{"modules":[]}';
  });
  try {
    // First attempt is allowed; reserve for correcting invalid output exceeds remaining budget.
    const response = await app.post({
      action: "layout",
      payload: { request: "合成学习" },
    });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, "BUDGET");
    assert.equal(calls, 1);
  } finally {
    await app.close();
    await db.close();
  }
});

test("400/413/500 and unknown API routes are JSON; front end tolerates HTML without exposing it", async () => {
  const { db, quota } = await fixture();
  const app = await serve(quota, async () => {
    throw Error("secret internal path /private/example");
  });
  try {
    for (const [raw, status, code] of [
      ["{", 400, "INVALID_JSON"],
      [JSON.stringify({ text: "x".repeat(110000) }), 413, "PAYLOAD_TOO_LARGE"],
    ] as const) {
      const r = await app.raw(raw);
      assert.equal(r.status, status);
      assert.match(r.headers.get("content-type")!, /application\/json/);
      assert.equal((await r.json()).code, code);
    }
    const broken = await app.post();
    assert.equal(broken.status, 500);
    assert.equal((await broken.json()).code, "INTERNAL_ERROR");
    await assert.rejects(
      readAIResponse(
        new Response("<html>private upstream stack</html>", { status: 413 }),
      ),
      /输入内容过大/,
    );
    await assert.rejects(
      readAIResponse(new Response("gateway", { status: 502 })),
      /暂时不可用/,
    );
    await assert.rejects(
      readAIResponse(new Response("not json", { status: 200 })),
      /格式异常/,
    );
    assert.equal(
      await readAIResponse(Response.json({ result: "valid" })),
      "valid",
    );
  } finally {
    await app.close();
    await db.close();
  }
});

test("all actions have finite output caps and byte-based input reservations include prompt overhead", () => {
  assert.equal(Object.keys(outputTokenLimits).length, 10);
  for (const value of Object.values(outputTokenLimits))
    assert(value > 0 && value <= 8192);
  assert(reservationUnits([{ role: "user", content: "中文" }], 2048) > 2054);
});

test("production Supabase RPC adapter uses server credential and actual SQL; missing migration fails closed", async () => {
  const { db, call } = await fixture();
  const previous = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  let broken = false,
    hang = false,
    authorized = false;
  const rpc = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.equal(req.url, "/rest/v1/rpc/learnspace_ai_quota");
    authorized =
      req.headers.apikey === "synthetic-service-key" &&
      req.headers.authorization === "Bearer synthetic-service-key";
    res.setHeader("content-type", "application/json");
    if (hang) return; // Real local HTTP timeout exercises the production RPC deadline.
    if (broken) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "private missing function detail" }));
      return;
    }
    const args = JSON.parse(Buffer.concat(chunks).toString());
    try {
      res.end(
        JSON.stringify(
          await call(
            args.p_operation,
            args.p_request,
            args.p_user,
            args.p_units,
            args.p_hash,
          ),
        ),
      );
    } catch {
      res.statusCode = 500;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => rpc.listen(0, "127.0.0.1", r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${(rpc.address() as { port: number }).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";
  let providerCalls = 0;
  const app = await serve(supabaseQuota(), async () => {
    providerCalls++;
    return "译文";
  });
  try {
    assert.equal((await app.post()).status, 200);
    assert(authorized);
    broken = true;
    const response = await app.post();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "QUOTA_UNAVAILABLE");
    assert(!JSON.stringify(body).includes("private"));
    assert.equal(providerCalls, 1);
    broken = false;
    hang = true;
    const timedOut = await app.post();
    assert.equal(timedOut.status, 503);
    assert.equal((await timedOut.json()).code, "QUOTA_UNAVAILABLE");
    assert.equal(providerCalls, 1);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await app.post()).status, 503);
    assert.equal(providerCalls, 1);
  } finally {
    await app.close();
    rpc.closeAllConnections();
    await new Promise<void>((r) => rpc.close(() => r()));
    await db.close();
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
});

test("real provider HTTP path sends max_tokens, charges every digest chunk, and rejects truncated output", async () => {
  const { db, quota } = await fixture();
  const previous = {
    base: process.env.AI_BASE_URL,
    key: process.env.AI_API_KEY,
  };
  const received: any[] = [];
  let mode: "normal" | "length" | "error" = "normal";
  const provider = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader("content-type", "application/json");
    if (mode === "error") {
      res.statusCode = 500;
      res.end('{"error":"private supplier detail"}');
      return;
    }
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: mode === "length" ? "length" : "stop",
            message: { content: "合成译文与要点" },
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  process.env.AI_BASE_URL = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  process.env.AI_API_KEY = "synthetic-model-key";
  const app = await serve(quota, null);
  try {
    for (let i = 0; i < 3; i++)
      assert.equal(
        (
          await app.post({
            action: "documentDigest",
            payload: { text: `合成片段${i}` },
          })
        ).status,
        200,
      );
    assert(received.every((body) => body.max_tokens === 2048));
    const units = (
      await db.query<{ used: number }>(
        "select used::int from public.ai_quota_counters where bucket='global:total'",
      )
    ).rows[0].used;
    assert.equal(
      units,
      received.reduce(
        (sum, body) => sum + reservationUnits(body.messages, body.max_tokens),
        0,
      ),
    );
    mode = "length";
    const limited = await app.post();
    assert.equal(limited.status, 502);
    assert.equal((await limited.json()).code, "OUTPUT_LIMIT");
    assert.equal(received.at(-1).max_tokens, 8192);
    mode = "error";
    const failed = await app.post();
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).code, "PROVIDER_ERROR");
  } finally {
    await app.close();
    provider.closeAllConnections();
    await new Promise<void>((r) => provider.close(() => r()));
    await db.close();
    if (previous.base === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previous.base;
    if (previous.key === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous.key;
  }
});

test("Qwen on Alibaba disables unbounded thinking alongside max_tokens", () => {
  assert.deepEqual(
    providerTokenOptions(
      "https://synthetic.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      "qwen-plus",
      2048,
    ),
    { max_tokens: 2048, enable_thinking: false },
  );
  assert.deepEqual(
    providerTokenOptions("https://example.invalid/v1", "generic", 2048),
    { max_tokens: 2048 },
  );
});

test("user daily and global daily budgets independently reject before creating a request row", async () => {
  const { db, call } = await fixture();
  try {
    await db.exec(
      "update public.ai_quota_policy set user_daily_units=100, global_daily_units=150,global_total_units=10000",
    );
    const first = crypto.randomUUID();
    assert((await call("begin", first, user, 100)).allowed);
    await call("finish", first);
    assert.equal(
      (await call("begin", crypto.randomUUID(), user, 1)).code,
      "BUDGET",
    );
    assert.equal(
      (await call("begin", crypto.randomUUID(), other, 51)).code,
      "BUDGET",
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.ai_quota_requests",
        )
      ).rows[0].n,
      1,
    );
    assert((await call("begin", crypto.randomUUID(), other, 50)).allowed);
    assert.equal(
      (
        await db.query<{ used: number }>(
          "select used::int from public.ai_quota_counters where bucket='global:day'",
        )
      ).rows[0].used,
      150,
    );
  } finally {
    await db.close();
  }
});

test("personal budget policy removes the extra daily ceiling without resetting usage or global protection", async () => {
  const { db, call } = await fixture();
  try {
    const first = crypto.randomUUID();
    assert((await call("begin", first, user, 490000)).allowed);
    await call("finish", first);
    const adjustment = await readFile(
      new URL("../server/migrations/010_ai_personal_budget.sql", import.meta.url),
      "utf8",
    );
    await db.exec(adjustment);
    await db.exec(adjustment);
    const next = crypto.randomUUID();
    assert((await call("begin", next, user, 1510000)).allowed);
    await call("finish", next);
    assert.equal((await call("begin", crypto.randomUUID(), other, 1)).code, "BUDGET");
    const { rows } = await db.query<{ used: number }>(
      "select used::int from public.ai_quota_counters where bucket='global:total' and period=0",
    );
    assert.equal(rows[0].used, 2000000);
    const policy = await db.query<{ global_total_units: string; user_concurrency: number; requests_per_minute: number }>(
      "select global_total_units::text, user_concurrency, requests_per_minute from public.ai_quota_policy",
    );
    assert.equal(policy.rows[0].global_total_units, "20000000");
    assert.equal(policy.rows[0].user_concurrency, 1);
    assert.equal(policy.rows[0].requests_per_minute, 15);
  } finally {
    await db.close();
  }
});

test("client disconnect aborts the provider signal and preserves protective quota lease", async () => {
  const { db, quota } = await fixture();
  let entered!: () => void, stopped!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    observed = new Promise<void>((r) => (stopped = r));
  const app = await serve(quota, async (_a, _p, _i, { signal }) => {
    entered();
    signal.addEventListener("abort", () => stopped(), { once: true });
    return new Promise<string>(() => {});
  });
  try {
    const abort = new AbortController();
    const pending = app.post(undefined, undefined, abort.signal);
    await started;
    abort.abort();
    await assert.rejects(pending);
    await observed;
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.ai_quota_requests where not finished",
        )
      ).rows[0].n,
      1,
    );
    assert(
      (
        await db.query<{ used: number }>(
          "select used::int from public.ai_quota_counters where bucket='global:total'",
        )
      ).rows[0].used > 0,
    );
  } finally {
    await app.close();
    await db.close();
  }
});

test("009 allows exactly three concurrent requests per user without resetting budgets or weakening deduplication", async () => {
  const {db,call} = await fixture();
  try {
    const policyBefore = (await db.query<Record<string,unknown>>("select * from public.ai_quota_policy")).rows[0];
    const migration009 = await readFile(new URL("../server/migrations/009_ai_user_concurrency.sql",import.meta.url),"utf8");
    await db.exec(migration009);
    await db.exec(migration009);
    const policyAfter = (await db.query<Record<string,unknown>>("select * from public.ai_quota_policy")).rows[0];
    assert.deepEqual(policyAfter,{...policyBefore,user_concurrency:3});
    const ids=Array.from({length:4},()=>crypto.randomUUID());
    const hashes=ids.map((_,i)=>String(i).repeat(64));
    const results=await Promise.all(ids.map((id,i)=>call("begin",id,user,100,hashes[i])));
    assert.equal(results.filter(r=>r.allowed).length,3);
    assert.equal(results.filter(r=>r.code==="CONCURRENCY").length,1);
    const winner=results.findIndex(r=>r.allowed);
    assert.equal((await call("begin",ids[winner],user,100,hashes[winner])).code,"DUPLICATE");
    assert.equal((await call("begin",crypto.randomUUID(),user,100,hashes[winner])).code,"DUPLICATE");
    await call("finish",ids[winner],user);
    assert.equal((await call("begin",crypto.randomUUID(),user,100,"f".repeat(64))).allowed,true);
    const requests=(await db.query("select * from public.ai_quota_requests")).rows;
    const counters=(await db.query("select * from public.ai_quota_counters")).rows;
    await db.exec(migration009);
    assert.deepEqual((await db.query("select * from public.ai_quota_requests")).rows,requests);
    assert.deepEqual((await db.query("select * from public.ai_quota_counters")).rows,counters);
  } finally {await db.close();}
});
