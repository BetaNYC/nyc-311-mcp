// A tool name that is not one of ours must get "Unknown tool", even when it is the
// name of an Object property ("constructor", "toString"): `name in shapes` is true for
// those, and used to run a tool body with arguments meant for nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callTool, TOOLS } from "../dist/tools.js";

test("names inherited from Object are unknown tools, not a tool run", async () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.ok(!TOOLS.some((t) => t.name === name));
    const out = await callTool(name, {});
    assert.equal(out.isError, true, name);
    assert.equal(out.content[0].text, `Unknown tool: ${name}`, name);
  }
});
