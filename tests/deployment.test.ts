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

test("Compiled Vercel functions load in native Node ESM without tsx resolution", async () => {
  const { mkdtemp, writeFile, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const root = process.cwd();
  const output = await mkdtemp(join(tmpdir(), "learnspace-esm-"));
  try {
    await run(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "api/ai.ts",
        "api/health.ts",
        "--target",
        "ES2022",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "--esModuleInterop",
        "--skipLibCheck",
        "--strict",
        "--types",
        "node",
        "--rootDir",
        root,
        "--outDir",
        output,
      ],
      { cwd: root, timeout: 30000 },
    );
    await writeFile(join(output, "package.json"), '{"type":"module"}');
    await symlink(
      join(root, "node_modules"),
      join(output, "node_modules"),
      "dir",
    );
    const script = `import api from './api/ai.js'; import health from './api/health.js'; if(api!==health)throw Error('Entry mismatch'); const server=api.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/health');if(res.status!==200||(await res.json()).ok!==true)throw Error('Health failed');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}console.log('Native ESM passed');`;
    await writeFile(join(output, "smoke.mjs"), script);
    const result = await run(process.execPath, [join(output, "smoke.mjs")], {
      cwd: output,
      timeout: 10000,
    });
    assert.match(result.stdout, /Native ESM passed/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
