// draft_311_report fix from the 2026-11-08 stack review: danger in `details` or `when`
// must stop the draft just as danger in `description` does. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftReport } from "../dist/draft-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

async function setup() {
  const content = await fixtureContent();
  const sla = await fixtureSla();
  const { data } = await fixtureData();
  return (args) => draftReport(args, content.client, sla.soda, data);
}

test("danger in details or when: no draft, 911 first", async () => {
  const draft = await setup();
  const cases = [
    { description: "water leaking from the ceiling", details: "my neighbor collapsed and is not breathing" },
    { description: "pothole on my block", details: "a car hit a cyclist here, he is bleeding" },
    { description: "no heat in my apartment", when: "right now, I smell gas" },
  ];
  for (const a of cases) {
    const out = await draft(a);
    assert.equal(out.drafted, false, JSON.stringify(a));
    assert.deepEqual(out.reports, [], JSON.stringify(a));
    assert.ok(out.emergency, JSON.stringify(a));
    assert.match(out.first_line, /911/, JSON.stringify(a));
    assert.equal(out.safety_line, SAFETY_LINE);
  }
});

test("'not urgent' in details does not cancel danger in the description", async () => {
  const draft = await setup();
  const out = await draft({ description: "I smell gas in the hallway", details: "not urgent, it comes and goes" });
  assert.equal(out.drafted, false);
  assert.ok(out.emergency);
});

test("ordinary details still get a draft", async () => {
  const draft = await setup();
  const out = await draft({ description: "pothole on my block", details: "about a foot wide, near the bus stop", when: "since Monday" });
  assert.equal(out.drafted, true);
  assert.equal(out.emergency, null);
});
