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
  // QA round 2 on #24 (its sui.mjs): these had only the generic no-match lead, with no 988.
  "I just want to sleep forever", "what's the point of living", "I've been thinking about ending it", "I want to disappear forever",
  "I have a bottle of pills and I'm done", "I wrote goodbye letters to my family", "I cut myself again", "there's no reason to keep going",
  "I wish I wouldn't wake up",
];
const LOOK_ALIKES = [
  // QA round 2's look-alikes. "I'm so tired I could sleep forever" stays generic on purpose.
  "I'm so tired I could sleep forever", "the bus disappeared from the schedule", "nobody would miss this old bench", "the streetlight is dead",
  "this pothole is killing my car", "the M15 just vanished from the app", "I'm done with this broken elevator", "there's no point calling the landlord anymore",
  "the park bench is falling apart", "I can't go on waiting for the garbage pickup",
  "the package disappeared", "my bike disappeared", "my car disappeared from where I parked it", "the bus can't go on this street", "trucks can't go on the bridge", "the store is better off without the sign"];

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
