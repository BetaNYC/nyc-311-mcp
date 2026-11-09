// Beta round 17 (Noel's decision, 2026-11-09): the closing safety sentence on every response is
// what the server relies on (test/safety-line.test.mjs); danger spotting stays a best effort.
// From home retest 16: five missed emergencies, fixed as small additions to existing classes, and
// "Foster Care Agency Complaint" offered as an alternative for trash outside a daycare (now guarded
// everywhere in an answer; see the round-10 audit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";

const client = await stressClient();

test("retest 16's five misses lead with 911", () => {
  for (const d of ["co alarm beepin everyone dizzy", "strong gas oder in bsmt", "a sinkhole just opened and a dog walker fell in", "the crane on the construction site is tipping over onto the street", "the train doors closed on a woman's arm and it's dragging her"]) {
    assert.ok(assessDanger(d).kinds.length, d);
  }
  assert.deepEqual(assessDanger("my dog fell into a hole").kinds, []);
});

test("no foster care article for trash outside a daycare, as best match or alternative", async () => {
  const out = await howToReport({ description: "my son's daycare has trash piled up by the entrance" }, client);
  assert.ok(![out.best_match, ...out.alternatives].some((a) => a && /foster/i.test(a.title)));
});
