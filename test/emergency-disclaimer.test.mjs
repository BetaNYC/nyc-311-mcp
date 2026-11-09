// Decision of 2026-11-08 on #23: a "not an emergency" or "not urgent" disclaimer quiets
// only ambiguous signals (smoke, a crash, water near electricity, a shaking structure).
// It never quiets someone hurt or not breathing, gas, carbon monoxide, fire, or suicide
// and self-harm. A past-time word ("last night") does not quiet a crime when the words
// also say the danger is present ("still inside", "right now") or name a weapon.
// No network: the 311 content API is served from recorded responses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { assessDanger, SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";

const { client } = await fixtureContent();

// [description, a danger kind that must be found]
const STILL_EMERGENCIES = [
  ["Not an emergency, but my neighbor collapsed and is not breathing", "hurt"],
  ["Not urgent, but I smell gas", "gas"],
  ["Broke in last night and he is still inside with a knife", "crime"],
  ["not urgent but there's carbon monoxide alarm going off", "carbon_monoxide"],
  ["not an emergency, small fire in the trash can", "fire"],
  ["it's not an emergency but my friend says he wants to kill himself", "suicide"],
  ["non-emergency: a man is unconscious on the sidewalk", "hurt"],
  ["someone broke into my apartment last night and he is still inside", "crime"],
  ["they robbed the store yesterday and the guy with the gun is still here", "crime"],
  ["somebody broke in last night, he has a knife", "crime"],
  ["a man broke in yesterday and he is in the apartment right now", "crime"],
];

for (const [description, kind] of STILL_EMERGENCIES) {
  test(`still an emergency: ${description}`, async () => {
    const a = assessDanger(description);
    assert.ok(a.kinds.some((k) => k.id === kind), `${kind} not found: ${a.kinds.map((k) => k.id)}`);
    const out = await howToReport({ description }, client);
    assert.ok(out.emergency, `no 911 lead: ${out.first_line}`);
    assert.match(out.first_line, /call 911/i);
    assert.equal(out.safety_line, SAFETY_LINE);
  });
}

// Ambiguous signals the disclaimer still quiets, and past crimes with no present danger.
const QUIETED = [
  "not an emergency but there is smoke coming from a vent",
  "not urgent, smoke coming out of the vent next door",
  "not an emergency, just some smoke from a neighbor's grill",
  "not an emergency, my bike was hit by a car while parked",
  "not urgent, water dripping near the light fixture in the hallway",
  "not an emergency, the sidewalk shed is shaking in the wind",
  "I was robbed last week",
  "someone broke into my car last night",
];

for (const description of QUIETED) {
  test(`not an emergency: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.equal(out.emergency, null, out.first_line);
    assert.equal(out.safety_line, SAFETY_LINE);
  });
}

test("a disclaimer still quiets the ambiguous kind next to a high-severity one", () => {
  const a = assessDanger("not an emergency, smoke coming out of the vent and I smell gas");
  assert.deepEqual(a.kinds.map((k) => k.id), ["gas"]);
  assert.equal(a.not_emergency, true);
  assert.equal(a.urgent, false);
});

test("look-alikes stay quiet with a past-time word", () => {
  for (const d of ["I bought a toy gun yesterday for my son", "my gun permit expired last month", "the pipe broke in the basement last night"]) {
    assert.deepEqual(assessDanger(d).kinds.map((k) => k.id), [], d);
  }
});

test("Gun Hill Road is a street, not a weapon; a gun on it still is", () => {
  assert.deepEqual(assessDanger("pothole on Gun Hill Road").kinds.map((k) => k.id), []);
  const past = assessDanger("someone broke into my car last night on Gun Hill Road");
  assert.deepEqual(past.kinds.map((k) => k.id), []);
  assert.equal(past.past_crime, true);
  assert.deepEqual(assessDanger("a man with a gun on Gun Hill Road").kinds.map((k) => k.id), ["crime"]);
});
