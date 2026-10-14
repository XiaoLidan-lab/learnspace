import "dotenv/config";
const local = "http://127.0.0.1:3001";
const results: Record<string, unknown>[] = [];
async function check(name: string, run: () => Promise<unknown>) {
  try {
    const details = await run();
    const row = { test: name, passed: true, details };
    results.push(row);
    console.log(JSON.stringify(row));
  } catch (e) {
    const row = {
      test: name,
      passed: false,
      error: e instanceof Error ? e.message : "Failure",
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }
}
await check("Local API loads configured services", async () => {
  const r = await fetch(`${local}/api/health`, {
    signal: AbortSignal.timeout(10000),
  });
  const b: any = await r.json();
  if (!r.ok || !b.ai || !b.auth)
    throw Error("Service configuration not loaded");
  return { status: r.status, ai: b.ai, auth: b.auth };
});
for (const token of [undefined, "invalid-test-token"])
  await check(
    token ? "Invalid token rejected" : "Anonymous AI request rejected",
    async () => {
      const r = await fetch(`${local}/api/ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: "translate",
          payload: { text: "Synthetic connection test", language: "简体中文" },
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.status !== 401) throw Error(`Expected 401, got ${r.status}`);
      return { status: r.status };
    },
  );
await check("Supabase RLS rejects anonymous publication", async () => {
  const key = process.env.SUPABASE_ANON_KEY!;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/templates`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      author_id: "00000000-0000-0000-0000-000000000000",
      author_name: "Synthetic test",
      title: "Connection test",
      category: "通用学习",
      publication_status: "pending",
      template_config: {
        version: 1,
        title: "Connection test",
        description: "",
        modules: [],
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const b: any = await r.json().catch(() => ({}));
  if (![401, 403].includes(r.status) || b.code !== "42501")
    throw Error(
      `RLS rejection not confirmed: HTTP ${r.status}, code ${b.code || "unknown"}`,
    );
  return { status: r.status, code: b.code, noTemplateCreated: true };
});
console.log(
  JSON.stringify({
    summary: {
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
    },
  }),
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
