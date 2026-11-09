// Beta retest 13 (2026-11-09, home machine, 1.2.0-beta.13) failed one stop rule: three missed
// emergencies, all "no match": "my uncle is clutching his chest and sweating and can't talk", "a
// toddler wandered into the street and cars are swerving around him", "a man is holding a woman
// under the water at the public pool". And under a gas danger, "meter" picked Parking Meter
// Complaint as the follow-up article, rated strong. Fixed by class:
//   - medical_symptoms: emergency symptoms in a person (chest pain or pressure, can't breathe or
//     talk, slurred speech, face drooping, seizure, choking, severe bleeding, turning blue,
//     overdose signs, an allergic reaction with swelling); never an animal, a simile, or stress;
//   - child_hazard: a child, toddler, baby or kid with a hazard (traffic, the street, a car, water,
//     a ledge or window, fire), now;
//   - water_rescue covers pools, bathtubs and beaches, and someone held under water is also violence;
//   - under a detected danger, a follow-up article must share the danger's words, or is left out.
// Measured on 811 phrasings (rounds 6 to 14, with the report's 50, 60 new emergencies in plain
// words and 15 near misses): on beta.13, 30 missed emergencies, 3 ordinary complaints leading
// with 911 and 3 wrong answers rated strong; now none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";

const client = await stressClient();
const kinds = (d) => assessDanger(d).kinds.map((k) => k.id);

test("retest 13's three misses lead with 911", async () => {
  for (const d of ["my uncle is clutching his chest and sweating and can't talk", "a toddler wandered into the street and cars are swerving around him", "a man is holding a woman under the water at the public pool"]) {
    const out = await howToReport({ description: d }, client);
    assert.ok(out.emergency, `${d}: ${out.first_line}`);
  }
});

test("medical symptoms in a person, in plain words", () => {
  for (const d of [
    "my uncle is clutching his chest and sweating and can't talk",
    "my mom has crushing chest pressure and her arm is numb",
    "my dad's speech is slurred and one side of his face is drooping",
    "my son is having a seizure",
    "she is choking on food and can't cough",
    "he is struggling to breathe and wheezing",
    "my friend's throat is swelling up after eating peanuts",
    "my grandfather's lips are turning blue",
    "he's bleeding heavily from a cut on his leg",
    "my roommate's pupils are tiny and she won't respond",
  ]) assert.ok(kinds(d).length, d);
  for (const d of ["my chest is tight from stress about rent", "my dog is choking on a bone", "the traffic noise makes me feel like I can't breathe", "this heat makes it hard to breathe in my apartment with no ventilation"]) {
    assert.deepEqual(kinds(d), [], d);
  }
});

test("a child with a hazard, now", () => {
  for (const d of [
    "a toddler wandered into the street and cars are swerving around him",
    "a little kid is running in traffic on the avenue",
    "a baby is alone in a car in the sun",
    "a child is standing on the window ledge",
    "a kid fell into the pool and nobody is watching",
    "my baby is face down in the bathtub",
    "a little girl is alone near the fire in the lot",
  ]) assert.ok(kinds(d).length, d);
  for (const d of ["the baby is crying at the street fair", "kids play in the street every summer when the hydrant is open", "my kid wants a pool in the backyard"]) {
    assert.deepEqual(kinds(d), [], d);
  }
});

test("water in every setting, and someone held under water", () => {
  for (const d of ["a man is holding a woman under the water at the public pool", "someone is drowning at the beach", "a swimmer is struggling in the surf at coney island", "a kid went under in the pool and hasn't come up"]) {
    assert.ok(kinds(d).includes("water_rescue"), d);
  }
  assert.ok(kinds("a man is holding a woman under the water at the public pool").includes("crime"), "also violence");
  for (const d of ["the pool is too cold", "the beach is dirty with trash", "the bathtub drains slowly"]) assert.deepEqual(kinds(d), [], d);
});

test("under a danger, the follow-up article fits the danger or is left out", async () => {
  const out = await howToReport({ description: "the whole block smells like gas and there's a hissing sound from the meter" }, client);
  assert.ok(out.emergency);
  assert.ok(![out.best_match, ...out.alternatives].some((a) => a && /parking/i.test(a.title)), "a gas meter, not a parking meter");
});
