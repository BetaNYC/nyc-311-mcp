// draft_311_report and the decision of 2026-11-08 on #23: "not an emergency" never quiets
// someone hurt, gas, carbon monoxide, fire or suicide, and "last night" never quiets a
// crime that is still going on. The draft is refused with 911 first, whether the danger is
// in description, details or when. Ambiguous signals with a disclaimer are still drafted.
// No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftReport } from "../dist/draft-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

const content = await fixtureContent();
const sla = await fixtureSla();
const { data } = await fixtureData();
const draft = (args) => draftReport(args, content.client, sla.soda, data);

const NOEL = [
  "Not an emergency, but my neighbor collapsed and is not breathing",
  "Not urgent, but I smell gas",
  "Broke in last night and he is still inside with a knife",
];

const REFUSED = [
  ...NOEL.map((d) => ({ description: d })),
  ...NOEL.map((d) => ({ description: "water leaking from the ceiling", details: d })),
  ...NOEL.map((d) => ({ description: "no heat in my apartment", when: d })),
  { description: "not urgent but there's carbon monoxide alarm going off" },
  { description: "not an emergency, small fire in the trash can" },
  { description: "a broken lock on the front door", details: "someone broke in last night and he is still here" },
];

for (const a of REFUSED) {
  test(`no draft: ${JSON.stringify(a)}`, async () => {
    const out = await draft(a);
    assert.equal(out.drafted, false);
    assert.deepEqual(out.reports, []);
    assert.ok(out.emergency);
    assert.match(out.first_line, /911/);
    assert.equal(out.safety_line, SAFETY_LINE);
  });
}

test("an ambiguous signal with a disclaimer is still drafted", async () => {
  const out = await draft({ description: "not urgent, water dripping near the light fixture in the hallway" });
  assert.equal(out.emergency, null);
  assert.equal(out.drafted, true);
  assert.equal(out.safety_line, SAFETY_LINE);
});
