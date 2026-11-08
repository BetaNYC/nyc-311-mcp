// QA round 1 on #23: the reviewer's 36 phrasings plus 10 more, over the recorded 311
// content (no network). Safety first: each row says whether the answer must lead with
// 911, and with which City article ("generic" = BetaNYC's own line, labeled so; null =
// no 911 lead, the standing safety line only). Then the article it should land on
// (best match, or the first alternative when that article was not recorded) and the
// articles for any other problems in the description.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { SAFETY_LINE, GENERIC_911 } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";

// [description, 911 lead, top article ("*": any, the point of the row is the lead), other problems' articles]
export const PHRASINGS = [
  ["there's a fire in my building", "KA-01543", "KA-01543", []],
  ["I smell gas in the hallway", "KA-02048", "KA-02048", []],
  ["my CO detector is going off", "KA-02608", "KA-02608", []],
  ["the carbon monoxide alarm is beeping", "KA-02608", "KA-02608", []],
  ["a power line is down on my street", "generic", "KA-01033", []],
  ["downed wire sparking in the road", "generic", "KA-01033", []],
  ["power line down after the storm", "generic", "KA-01033", []],
  ["someone is hurt on the sidewalk", "KA-01581", "KA-01581", []],
  ["a man is breaking into a car right now", "generic", "KA-01033", []],
  ["someone is getting robbed outside", "generic", "KA-01033", []],
  ["a child left alone in a hot car", "generic", "KA-01033", []],
  ["an elderly man collapsed on the subway stairs", "KA-01581", "KA-01581", []],
  ["my neighbors smoke cigarettes in the hallway", null, "KA-03662", []],
  ["my car was hit but no one was hurt", null, "KA-01220", []],
  ["the smoke detector in my apartment is broken", null, "KA-01074", []],
  ["I want to report a crime", null, "KA-02668", []],
  ["my landlord is harassing me", null, "KA-01042", []],
  ["ruido muy fuerte de los vecinos", null, "KA-01017", []],
  ["no hay calefaccion en mi apartamento", null, "KA-01036", []],
  ["pothoel on my stret", null, "KA-01093", []],
  ["loud musik next dor", null, "KA-01017", []],
  ["there are rats in the park and trash everywhere", null, "KA-01107", ["KA-02143"]],
  ["the street light is out and theres a pothole", null, "KA-02463", ["KA-01093"]],
  ["illegal fireworks every night", null, "KA-02249", []],
  ["dog barking all night next door", null, "KA-01087", []],
  ["my building has no hot water and the elevator is broken", null, "KA-01036", ["KA-02015"]],
  ["someone dumped a mattress on the sidewalk", null, "KA-02097", []],
  ["the garbage wasn't picked up", null, "KA-01788", []],
  ["a tree branch fell and is blocking the sidewalk", null, "KA-02138", []],
  ["a car alarm going off for hours", null, "KA-01089", []],
  ["fire escape is blocked by the landlord", null, "KA-02233", []],
  ["the burning smell from the restaurant exhaust", null, null, []],
  ["a bike lane is blocked by a delivery truck", null, "KA-01260", []],
  ["sidewalk is cracked and someone could trip", null, "KA-02235", []],
  ["a person sleeping on the subway", null, "KA-01037", []],
  ["I need a copy of my birth certificate", null, "KA-01012", []],
  ["the noise hurts my sleep", null, "*", []],
  ["not an emergency but there is smoke coming from a vent", null, null, []],
  ["I need help right now", "generic", null, []],
  ["my friend says he wants to kill himself", "KA-01635", "KA-01635", []],
  ["I was robbed last week", null, null, []],
  ["a man with a gun outside", "generic", "KA-01033", []],
  ["someone is stuck in the elevator", "generic", "KA-01033", []],
  ["the ceiling is collapsing", "generic", "KA-01033", []],
  ["water is leaking into the electrical outlet", "generic", "KA-01033", []],
  ["I want a gun permit", null, null, []],
];

const { client } = await fixtureContent();

for (const [description, lead, top, others] of PHRASINGS) {
  test(`phrasing: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.equal(out.safety_line, SAFETY_LINE, "every answer carries the standing safety line");
    if (lead === null) {
      assert.equal(out.emergency, null, `no 911 lead expected, got: ${out.first_line}`);
      assert.doesNotMatch(out.first_line, /call 911/i);
    } else if (lead === "generic") {
      assert.equal(out.first_line, GENERIC_911);
      assert.equal(out.emergency.ka_number, null);
      assert.match(out.emergency.source, /^BetaNYC wording/);
    } else {
      assert.equal(out.emergency.ka_number, lead, out.first_line);
      assert.match(out.first_line, /^Call 911 to report /);
    }
    if (top !== "*") assert.equal(out.best_match?.ka_number ?? out.alternatives[0]?.ka_number ?? null, top);
    assert.deepEqual((out.other_problems ?? []).map((x) => x.best_match?.ka_number ?? x.alternatives[0]?.ka_number), others);
  });
}
