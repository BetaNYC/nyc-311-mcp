// Beta retest 14 (2026-11-09, home machine, 1.2.0-beta.14) FAILED: three missed emergencies and
// five small wrong answers. Fixed by class:
//   - weapons: any blade, gun or blunt weapon being swung, waved or brandished, anywhere;
//   - heights: a worker dangling, hanging, stuck or swinging off a building or scaffold is in
//     danger; only a worker simply working is not;
//   - a person fallen into or trapped in a hole, manhole, trench, shaft, sinkhole or collapse;
//     under that danger the hazard's repair complaint is never the answer (fitsDanger);
//   - "drowning in" anything that is not water is a figure of speech;
//   - an animal in the trash is the animal path; a kid's (yellow) bus is the school bus; a
//     non-residential place never gets a residential housing article; "a car parked outside"
//     is where noise comes from, not a parking problem;
//   - shorthand and typos a worried person types ("kid in strt", "baby not breathng") are read.
// Measured on 921 phrasings (rounds 6 to 15, with the report's 50 and 60 new): on beta.14, 20
// missed emergencies, 6 ordinary complaints leading with 911 and 14 wrong answers rated strong;
// now none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";

const client = await stressClient();
const kinds = (d) => assessDanger(d).kinds.map((k) => k.id);
const top = async (d) => {
  const out = await howToReport({ description: d }, client);
  return { out, a: out.best_match ?? out.alternatives[0] ?? null };
};

test("weapons, any kind, anywhere", () => {
  for (const d of ["theres a guy swinging a machete on the platform at 14th st", "a man is waving an axe outside the deli", "someone is swinging a baseball bat at people in the park", "a guy is brandishing a pipe on the bus", "a woman is chasing kids with a hammer", "a man has a box cutter and is threatening the cashier", "guy with a gun in the lobby"]) {
    assert.ok(kinds(d).includes("crime"), d);
  }
  for (const d of ["the hardware store sells hammers and axes", "kids play baseball with a bat in the park every evening", "the knife sharpening truck is loud", "the pipe under my sink leaks"]) assert.deepEqual(kinds(d), [], d);
});

test("a worker dangling or stuck off a building is in danger; a worker working is not", () => {
  for (const d of ["a window washer's rig snapped and he's dangling off the building", "a worker is stuck hanging from the scaffolding", "a painter is swinging off the side of the building after the rope broke"]) assert.ok(kinds(d).includes("height"), d);
  assert.deepEqual(kinds("window washers are hanging off the building next door all morning"), []);
});

test("a person in a hole, a shaft, a trench or a collapse; the repair complaint is not the answer", async () => {
  for (const d of ["a worker fell into a manhole and isn't answering", "a man fell into the elevator shaft", "two workers are trapped in a collapsed trench", "a kid fell into a sinkhole in the street", "someone is trapped under the rubble"]) {
    assert.ok(kinds(d).length, d);
  }
  for (const d of ["my phone fell into the sewer grate", "my keys fell into a manhole", "the manhole cover is missing"]) assert.deepEqual(kinds(d), [], d);
  const { out, a } = await top("a worker fell into a manhole and isn't answering");
  assert.ok(out.emergency);
  assert.notEqual(a?.ka_number, "KA-01669", "not Manhole Cover Complaint");
});

test("drowning in something that is not water is a figure of speech", () => {
  for (const d of ["I'm drowning in garbage bags on my block, nobody picks them up", "we are drowning in paperwork from the landlord", "the block is drowning in leaves"]) assert.deepEqual(kinds(d), [], d);
  assert.ok(kinds("a man is drowning in the river").length);
});

test("small wrong answers: animal in trash, school bus, non-residential place, parked car as a place", async () => {
  assert.equal((await top("a raccoon is living in the trash cans behind my building")).a?.ka_number, "KA-01790");
  assert.equal((await top("my kid's yellow bus never shows up on time")).a?.ka_number, "KA-01491");
  const rec = (await top("the girls' locker room at the rec center has no hot water")).a;
  assert.ok(!/residential|apartment/i.test(rec?.title ?? ""), rec?.title);
  assert.equal((await top("loud music from a car parked outside at 2am")).a?.ka_number, "KA-01102");
});

test("shorthand and typos a worried person types", () => {
  for (const d of ["kid in strt", "baby not breathng", "guy w gun lobby", "lady passd out on train not breathing", "old man fell cant get up", "woman drownin at beach", "fire in bldg smoke everywhere"]) assert.ok(kinds(d).length, d);
  assert.deepEqual(kinds("the baby is crying at the street fair"), []);
});
