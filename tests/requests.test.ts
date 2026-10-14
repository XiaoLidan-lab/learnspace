import test from "node:test";
import assert from "node:assert/strict";
import { RequestGate } from "../src/requestGate";
test("选区变化或新请求会使旧 AI 响应失效", () => {
  const gate = new RequestGate();
  gate.invalidate("first selection");
  const a = gate.begin();
  assert(gate.isCurrent(a));
  gate.invalidate("second selection");
  assert(!gate.isCurrent(a));
  const b = gate.begin();
  const c = gate.begin();
  assert(!gate.isCurrent(b));
  assert(gate.isCurrent(c));
  gate.cancel();
  assert(!gate.isCurrent(c));
});
