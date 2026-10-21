import { Buffer } from "buffer/index.js";
import processShim from "process/browser.js";
// Initialize before the legacy parser's stream dependencies evaluate.
// This module is bundled only in the dedicated Word worker.
const environment = globalThis as unknown as {
  Buffer?: unknown;
  process?: unknown;
};
environment.Buffer ??= Buffer;
environment.process ??= processShim;
