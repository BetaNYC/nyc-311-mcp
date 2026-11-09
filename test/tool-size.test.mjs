import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "../dist/tools.js";
import { SERVER_INSTRUCTIONS } from "../dist/instructions.js";

// Every tool definition is sent to the model on every turn, so its size is a cost.
// Shared explanations live once in the server instructions (src/instructions.ts), not
// in each schema. Measured 2026-11-08 at 31,995 characters (tools/list JSON plus the
// instructions, about 8,000 tokens); the budget is that plus about 10%. If a new tool
// needs more, raise it on purpose, and put any text several tools share in the
// instructions rather than repeating it.
const BUDGET_CHARS = 35_200;

test("tool definitions plus server instructions stay within the size budget", () => {
  const size = JSON.stringify(TOOLS).length + SERVER_INSTRUCTIONS.length;
  assert.ok(size <= BUDGET_CHARS, `tools/list JSON + instructions is ${size} characters, over the ${BUDGET_CHARS} budget`);
});

test("no single tool definition is over 3,000 characters", () => {
  for (const t of TOOLS) {
    const n = JSON.stringify(t).length;
    assert.ok(n <= 3000, `${t.name} is ${n} characters`);
  }
});
