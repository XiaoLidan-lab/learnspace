import test from "node:test";
import assert from "node:assert/strict";
import api from "../api/ai";
import health from "../api/health";
test("Vercel entry serves health and auth-protected AI without falling back to frontend HTML", async () => {
  assert.equal(health, api);
  const server = api.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await fetch(`${base}/api/health`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).ok, true);
    const denied = await fetch(`${base}/api/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "chat",
        payload: { messages: [{ role: "user", content: "test" }] },
      }),
    });
    assert.equal(denied.status, 401);
    const missing = await fetch(`${base}/api/missing`);
    assert.equal(missing.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
