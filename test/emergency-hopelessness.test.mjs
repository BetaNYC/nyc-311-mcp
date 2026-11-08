// Phase 4 follow-up (QA round 1 on #24): hopelessness phrasings lead with 911 and the
// City's 988 text; ordinary uses of the same words do not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessDanger } from "../dist/emergency.js";
import { howToReport } from "../dist/how-to-report.js";
import { fixtureContent } from "./content-fixture.mjs";

const { client } = await fixtureContent();

const HOPELESS = [
  "nobody would care if I disappeared", "what if I just disappeared", "there's no reason to live", "they'd be better off without me",
  "nobody would miss me", "no one would even miss me", "I can't go on", "I can't go on like this", "i cannot go on anymore",
];
const LOOK_ALIKES = ["the package disappeared", "my bike disappeared", "my car disappeared from where I parked it", "the bus can't go on this street", "trucks can't go on the bridge", "the store is better off without the sign"];

for (const d of HOPELESS) {
  test(`hopelessness leads with 911 and the City's 988 text: ${d}`, async () => {
    assert.deepEqual(assessDanger(d).kinds.map((k) => k.id), ["suicide"]);
    const out = await howToReport({ description: d }, client);
    assert.match(out.first_line, /call 911/i);
    assert.equal(out.emergency.also_988?.ka_number, "KA-01635");
  });
}
for (const d of LOOK_ALIKES) {
  test(`not hopelessness: ${d}`, () => {
    assert.deepEqual(assessDanger(d).kinds.map((k) => k.id), []);
  });
}
