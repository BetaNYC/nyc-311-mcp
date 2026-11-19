import { test } from "node:test";
import assert from "node:assert/strict";
import "./with-api-key.mjs";
import { TOOLS } from "../dist/tools.js";
import { assertEveryToolAnnotated } from "../dist/betanyc-tools.js";

const SHARED = new Set(["whats_changed", "about_betanyc", "about_data"]);

// #39: a client treats a tool with no readOnlyHint as one that may write. None of these tools
// writes anything, and none files or changes a 311 request.
test("every tool declares readOnlyHint and openWorldHint", () => {
  assertEveryToolAnnotated(TOOLS);
});

test("every tool is read-only and has a title", () => {
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.ok(t.annotations.title?.trim(), `${t.name} has no title`);
  }
});

test("every domain tool says it can reach the network (311 API, NYC Open Data or BoardStat)", () => {
  for (const t of TOOLS.filter((t) => !SHARED.has(t.name))) assert.equal(t.annotations.openWorldHint, true, t.name);
});

test("tools whose names read badly get a written title", () => {
  const title = (n) => TOOLS.find((t) => t.name === n).annotations.title;
  assert.equal(title("ll47_service_request_report"), "Local Law 47 service request report");
  assert.equal(title("boardstat_link"), "BoardStat link");
  assert.equal(title("get_calendar"), "Get calendar");
});
