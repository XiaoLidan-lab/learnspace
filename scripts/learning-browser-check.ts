// Isolated browser verification: synthetic auth + local PostgreSQL, REAL configured model.
// Never mounted by server/index.ts or Vercel. No remote Supabase writes.
import "dotenv/config";
import express from "express";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createApp } from "../server/api";
import { parseCloudPayload, cloudPayload } from "../src/cloudData";
import { fromTemplate, type Template } from "../src/model";
import { taskFromPlan, addTask, updateModule } from "../src/tasks";
import { quizAttempt } from "../src/taskIntelligence";
if (!process.argv.includes("--synthetic") || !process.env.AI_API_KEY)
  throw Error("Requires --synthetic and existing AI configuration");
const db = new PGlite(),
  user = {
    id: "00000000-0000-4000-8000-000000000088",
    email: "learning-check@example.invalid",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: { provider: "email" },
    user_metadata: {},
  };
await db.exec(
  `create schema auth;create table auth.users(id uuid primary key);create role authenticated;create role anon;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;insert into auth.users values('${user.id}');`,
);
await db.exec(
  await readFile(
    new URL(
      "../server/migrations/005_learning_workspaces.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(`set role authenticated;set test.uid='${user.id}'`);
if (process.argv.includes("--coach-fixture")) {
  const types = ["text", "note", "quiz", "cards", "pdf"] as const;
  const template: Template = {
    version: 1,
    title: "第三阶段合成验收",
    description: "仅限本机的合成数据",
    modules: types.map((type, i) => ({
      type,
      title: ["学习材料", "学习笔记", "巩固测验", "知识卡片", "资料阅读"][i],
      layout: { x: (i % 2) * 6, y: Math.floor(i / 2) * 8, w: 6, h: 8 },
    })),
  };
  let w = fromTemplate(template);
  const plan = {
    goal: "第三阶段合成任务A：理解光合作用",
    steps: [
      {
        title: "理解能量转换",
        description: "阅读并解释光合作用",
        moduleTypes: ["text" as const, "note" as const, "pdf" as const],
      },
      {
        title: "巩固与自测",
        description: "检查自己能否解释过程",
        moduleTypes: ["quiz" as const, "cards" as const],
      },
    ],
    outcomes: ["保存一篇解释笔记"],
    layoutReason: "合成验收",
  };
  const a = taskFromPlan(plan, w.modules);
  w = addTask(w, a);
  w = updateModule(w, w.modules[0].id, {
    data: {
      text: "合成材料：光合作用将光能转化为化学能。植物利用水和二氧化碳合成糖类，并释放氧气。",
    },
  });
  w = updateModule(w, w.modules[2].id, {
    data: {
      quiz: [
        {
          id: "check-q",
          type: "choice",
          question: "光合作用主要将光能转化为什么？",
          options: ["化学能", "声能"],
          answer: "化学能",
          explanation: "能量储存在有机物中。",
        },
      ],
      answers: { "check-q": "声能" },
      submitted: true,
    },
  });
  const quizMod = { ...w.modules[2], ...a.moduleStates?.[w.modules[2].id] };
  const state = w.tasks![0].moduleStates![w.modules[2].id];
  w = updateModule(w, w.modules[2].id, {
    data: {
      ...state.data,
      quizAttempts: [quizAttempt({ ...quizMod, data: state.data })],
    },
  });
  w = updateModule(w, w.modules[3].id, {
    data: {
      cards: [
        {
          id: "check-card",
          front: "能量的转化方向？",
          back: "光能转化为化学能",
        },
      ],
    },
  });
  const note = {
    id: crypto.randomUUID(),
    workspaceId: w.id,
    taskId: a.id,
    moduleId: w.modules[1].id,
    content: "# 我的解释\n光合作用把光能存入有机物。尚不能解释氧气从哪里来。",
    contentKind: "user" as const,
    sources: [],
  };
  const b = taskFromPlan(
    { ...plan, goal: "第三阶段合成任务B：其他材料" },
    w.modules,
  );
  w = addTask(w, b);
  w = updateModule(w, w.modules[0].id, {
    data: { text: "任务B独有标记：紫色鲸鱼，只应在B出现。" },
  });
  w.activeTaskId = a.id;
  w.tasks = w.tasks!.map((t) => ({
    ...t,
    status: t.id === a.id ? "active" : "paused",
  }));
  await db.query("select public.save_learning_workspace($1,0,$2::jsonb)", [
    w.id,
    JSON.stringify(cloudPayload(w, [note])),
  ]);
  console.log("Synthetic coach fixture ready; no remote Supabase writes.");
}
const app = express();
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === "http://127.0.0.1:5188" || origin === "http://127.0.0.1:5189")
    res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,apikey,content-type,x-client-info,x-supabase-api-version,prefer",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return void res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "6mb" }));
app.post("/auth/v1/token", (req, res) => {
  if (
    req.body.email !== "learning-check@example.invalid" &&
    req.body.refresh_token !== "local-check-refresh"
  )
    return void res
      .status(401)
      .json({ msg: "Use synthetic check account only" });
  res.json({
    access_token: "local-check-token",
    refresh_token: "local-check-refresh",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  });
});
app.get("/auth/v1/user", (_, res) => res.json(user));
app.post("/auth/v1/logout", (_, res) => res.sendStatus(204));
app.get("/rest/v1/learning_workspaces", async (req, res) => {
  if (req.headers.authorization !== "Bearer local-check-token")
    return void res.sendStatus(401);
  const r = await db.query(
    "select workspace_id,revision,payload,updated_at from public.learning_workspaces order by updated_at desc limit 50",
  );
  res.json(r.rows.map((x: any) => ({ ...x, revision: Number(x.revision) })));
});
app.post("/rest/v1/rpc/save_learning_workspace", async (req, res) => {
  if (req.headers.authorization !== "Bearer local-check-token")
    return void res.sendStatus(401);
  try {
    const b = req.body;
    parseCloudPayload(b.p_payload);
    const r = await db.query<any>(
      "select public.save_learning_workspace($1,$2,$3::jsonb)",
      [b.p_workspace_id, b.p_expected_revision, JSON.stringify(b.p_payload)],
    );
    console.log(
      JSON.stringify({
        cloud: "saved to LOCAL test database",
        revision: Number(r.rows[0].save_learning_workspace),
      }),
    );
    res.json(Number(r.rows[0].save_learning_workspace));
  } catch (e: any) {
    res
      .status(409)
      .json({ code: e.code || "40001", message: "Local verification error" });
  }
});
let calls = 0;
let injectedFailure = false;
app.use("/api/ai", (req, res, next) => {
  if (++calls > 8)
    return void res
      .status(429)
      .json({ error: "Browser verification call budget reached" });
  const start = Date.now();
  res.on("finish", () =>
    console.log(
      JSON.stringify({
        realAI: req.body.action,
        status: res.statusCode,
        ms: Date.now() - start,
      }),
    ),
  );
  // Explicit local-only transport fixtures; successful requests still use the real model.
  if (process.argv.includes("--custom-fixture") && req.body.action === "custom") {
    const question = req.body.payload?.inputs?.question?.text || "";
    if (question.includes("FIXTURE_FAIL_ONCE") && !injectedFailure) {
      injectedFailure = true;
      return void res.status(503).json({ error: "合成验收：模拟一次网络服务失败，请按原快照重试。" });
    }
    if (question.includes("FIXTURE_DELAY")) {
      return void setTimeout(() => { if (!res.destroyed) next(); }, 20000);
    }
  }
  next();
});
app.use(
  createApp(
    {
      authenticate: async (token) =>
        token === "local-check-token" ? user.id : null,
    },
    { serveFrontend: false },
  ),
);
const api = app.listen(3018, "127.0.0.1");
const servers = [];
for (const port of [5188, 5189]) {
  const vite = await createServer({
    configFile: false,
    envFile: false,
    root: process.cwd(),
    plugins: [react()],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        `http://127.0.0.1:${port}`,
      ),
      "import.meta.env.VITE_SUPABASE_ANON_KEY":
        JSON.stringify("synthetic-anon"),
    },
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:3018",
        "/auth/v1": "http://127.0.0.1:3018",
        "/rest/v1": "http://127.0.0.1:3018",
      },
    },
  });
  await vite.listen();
  servers.push(vite);
}
console.log(
  "Synthetic verification pages: http://127.0.0.1:5188 and http://127.0.0.1:5189. Login: learning-check@example.invalid / local-check. Model requests use configured REAL provider. Cloud is LOCAL PGlite only.",
);
process.on("SIGINT", async () => {
  for (const s of servers) await s.close();
  api.close();
  await db.close();
  process.exit(0);
});
