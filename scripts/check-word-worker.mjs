import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import assert from "node:assert/strict";
const root = process.cwd();
const file = (await readdir(root + "/dist/assets")).find((name) =>
  name.startsWith("wordReader.worker-"),
);
const code = await readFile(root + "/dist/assets/" + file, "utf8");
for (const ext of ["doc", "docx"]) {
  let network = 0;
  let resolveMessage;
  const message = new Promise((resolve) => (resolveMessage = resolve));
  const sandbox = {
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    console,
    fetch: () => {
      network++;
      throw Error("offline");
    },
    postMessage: resolveMessage,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { timeout: 2000 });
  } catch (e) {
    console.log("worker boot:", e.message);
    process.exit(1);
  }
  const bytes = Uint8Array.from(
    await readFile(root + "/tests/fixtures/file-reading/sample." + ext),
  );
  const timer = setTimeout(() => {
    throw Error("worker timeout");
  }, 10000);
  try {
    await sandbox.onmessage({ data: bytes.buffer });
    const result = await message;
    assert.equal(result.error, undefined, result.error);
    assert.match(result.text, /Attention uses query, key and value/);
    assert.equal(network, 0);
    console.log(
      ext +
        ": production worker passed without Buffer/process/Node globals or network",
    );
  } finally {
    clearTimeout(timer);
  }
}
