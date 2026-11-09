// Beta retest 4 (2026-11-09, home machine): water outdoors went to the building-leak
// article, and round 4's confidence rule dropped clear one-word problems ("no heat",
// "fireworks") to "close call". The street articles are the City's own, from 311's
// Sidewalks and Streets & Highways lists:
//   KA-01234 Water Leak on Street or Sidewalk: "Report water leaking on a street or
//     sidewalk." Report option "Water Leak on Street or Sidewalk" (DEP). Recorded
//     read-only from the live 311 Public API on 2026-11-09 (no ZIP codes in it).
//   KA-01233 Water Main Break: "usually involves water flowing up onto the street from
//     below ground and low water pressure in nearby homes and businesses."
//   KA-01034 Fire Hydrant Complaint: "a fire hydrant that is leaking, running, ..."
//   KA-02198 Street Flooding: "Report street flooding or ponding."
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, parseQuery, strongEvidence } from "../dist/how-to-report.js";
import { fixtureContent } from "./content-fixture.mjs";

const { client } = await fixtureContent();
const STREET_WATER = ["KA-01234", "KA-01233"];

const OUTDOOR = [
  ["water leaking from the street", ["KA-01234"]],
  ["water is leaking from the street", ["KA-01234"]],
  ["water leaking from the sidewalk", ["KA-01234"]],
  ["there's a leak in the street outside my building", ["KA-01234"]],
  ["water coming up from the street", STREET_WATER],
  ["water bubbling up through the pavement", STREET_WATER],
  ["water main break", ["KA-01233"]],
  ["I think a water main broke, water is gushing down the block", ["KA-01233"]],
  ["hydrant leaking", ["KA-01034"]],
  ["the fire hydrant on my corner is leaking", ["KA-01034"]],
  ["water pooling in the road", ["KA-02198"]],
  ["water is pooling at the corner after every rain", ["KA-02198"]],
];

for (const [description, kas] of OUTDOOR) {
  test(`outdoor water goes to a street article: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.ok(kas.includes(out.best_match?.ka_number), `${description}: got ${out.best_match?.ka_number} ${out.best_match?.title}`);
    assert.notEqual(out.best_match.ka_number, "KA-01509");
  });
}

const INDOOR = [
  "water leaking from my ceiling",
  "water is leaking from my ceiling",
  "water coming through the ceiling from upstairs",
  "the pipe under my kitchen sink is leaking",
  "water leaking into my apartment from the street during rain",
  "leak in the hallway of my building",
];

for (const description of INDOOR) {
  test(`indoor water stays on the building article: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.notEqual(out.best_match?.ka_number, "KA-01234", `${description}: ${out.best_match?.title}`);
    assert.notEqual(out.best_match?.ka_number, "KA-01233", `${description}: ${out.best_match?.title}`);
  });
}

test("a street leak picks the street option and its agency", async () => {
  const out = await howToReport({ description: "water is leaking from the street" }, client);
  assert.equal(out.best_match.best_action?.name, "Water Leak on Street or Sidewalk");
  assert.equal(out.best_match.agency, "Department of Environmental Protection");
  assert.match(out.best_match.confidence, /^strong/);
});

test("a ceiling leak is still the building article", async () => {
  const out = await howToReport({ description: "water leaking from my ceiling" }, client);
  assert.equal(out.best_match.ka_number, "KA-01509");
});

test("clear one-concept phrases are strong again", async () => {
  for (const [description, ka] of [
    ["No heat in my apartment", "KA-01036"],
    ["my landlord hasn't turned on the heat and it's freezing", "KA-01036"],
    ["illegal fireworks every night", "KA-02249"],
    ["people setting off fireworks on my block", "KA-02249"],
  ]) {
    const out = await howToReport({ description }, client);
    assert.equal(out.best_match?.ka_number, ka, `${description}: ${out.best_match?.title}`);
    assert.match(out.best_match.confidence, /^strong/, `${description}: ${out.best_match.confidence}`);
  }
});

test("the construction case is still never strong", async () => {
  for (const description of ["construction", "something about construction at the site", "a sign", "construction site"]) {
    const out = await howToReport({ description }, client);
    if (out.best_match) assert.doesNotMatch(out.best_match.confidence, /^strong/, `${description}: ${out.best_match.title} ${out.best_match.confidence}`);
  }
});

test("strongEvidence: one word that names the article, by a clear margin over its rivals", () => {
  const art = (title, description = "") => ({ ka_number: title, title, description });
  const pool = [art("Fireworks Complaint", "Report illegal fireworks."), art("Fireworks Displays"), art("Fireworks Permit")];
  const q = parseQuery("illegal fireworks every night");
  const scores = new Map([["Fireworks Complaint", 11], ["Fireworks Displays", 7], ["Fireworks Permit", 7]]);
  assert.equal(strongEvidence(q, pool[0], pool, scores), true);
  // Same word, no margin: not strong.
  assert.equal(strongEvidence(q, pool[0], pool, new Map([["Fireworks Complaint", 9], ["Fireworks Displays", 8], ["Fireworks Permit", 7]])), false);
});

test("strongEvidence: the round-4 No Smoking Sign case stays not strong even with a margin", () => {
  // Retest 3: 6am jackhammering rated the Construction Site No Smoking Sign article strong
  // on the one word "construction". That title is about a sign, not about construction
  // noise, so most of its words are not the person's: never strong, whatever the margin.
  const art = (title, description = "") => ({ ka_number: title, title, description });
  const pool = [art("Construction Site No Smoking Sign Complaint"), art("Building Construction Complaint"), art("Construction Safety Complaint")];
  const q = parseQuery("construction starts at 6am every day");
  const scores = new Map([["Construction Site No Smoking Sign Complaint", 14], ["Building Construction Complaint", 8], ["Construction Safety Complaint", 7]]);
  assert.equal(strongEvidence(q, pool[0], pool, scores), false);
  // "construction site" shares two of the title's four words: half is not enough.
  const q2 = parseQuery("construction site");
  assert.equal(strongEvidence(q2, pool[0], pool, scores), false);
});

test("every round-4 routing and confidence case still holds", async () => {
  for (const [description, ka] of [
    ["a construction site starts jackhammering at 6am", "KA-01091"],
    ["the glass in the bus stop shelter is smashed", "KA-01071"],
    ["unlicensed street food seller", "KA-02152"],
    ["there's a dead rat on the sidewalk", "KA-02245"],
    ["a car is parked in front of the fire hydrant on my street", null],
    ["bed bugs in my apartment", "KA-01236"],
    ["the stop sign at the corner was knocked down", "KA-01063"],
  ]) {
    const out = await howToReport({ description }, client);
    if (ka) assert.equal(out.best_match?.ka_number, ka, `${description}: ${out.best_match?.title}`);
    assert.match(out.best_match.confidence, /^strong/, `${description}: ${out.best_match.confidence}`);
  }
});
