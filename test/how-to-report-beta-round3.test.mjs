// Beta retest 2 (2026-11-09, home machine): five routing misses. Every route below is a City
// article from 311's own lists, read from the live 311 Public API on 2026-11-09 (read-only)
// and recorded in test/fixtures/content/GetContent/ with ZIP codes replaced:
//   KA-02278 Residential Pest Complaint: "mice, bed bugs, fleas, flies, or roaches in an
//     apartment or in a public area of a residential building" (rats in a building already
//     route here; "rodents" did not).
//   KA-01074 Apartment Maintenance Complaint: its "Public Area Maintenance Complaint" section
//     lists unsanitary conditions in a public area, and its building-wide section lists
//     "garbage and recycling storage". A lobby is inside the building, not the street.
//   KA-01405 No Water, Low Water Pressure, or Water Temperature Complaint: "Tenants can
//     report ... no water or no hot water in an entire building."
//   KA-01063 Street Sign Complaint: "parking, traffic, street name, bus stop, and
//     construction signs"; its "Fallen, Dangling, or Leaning" section covers a sign that fell.
//   KA-02222 Idling Vehicle: "a vehicle ... parked with its engine running for more than three
//     minutes". Noise from Vehicle stays the route for noise from an idling engine.
//   KA-01089 Noise from Alarm: "an alarm in progress or an alarm that goes off too often or
//     for too long"; a car alarm stays here, with Noise from Vehicle as an alternative.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";

const ROWS = [
  ["rodents in my building", "KA-02278"],
  ["there are rodents in the basement of my building", "KA-02278"],
  ["trash piling up in the lobby", "KA-01074"],
  ["garbage is piling up in the hallway of my building", "KA-01074"],
  ["no water in my building since this morning", "KA-01405"],
  ["there's no water in my apartment", "KA-01405"],
  ["the stop sign at the corner was knocked down", "KA-01063"],
  ["a street sign on my block is missing", "KA-01063"],
  ["a truck has been idling outside for an hour", "KA-02222"],
  ["a bus is parked with its engine running", "KA-02222"],
  ["a car alarm has been going off for hours", "KA-01089"],
];

const { client } = await fixtureContent();

for (const [description, ka] of ROWS) {
  test(`beta retest 2 phrasing: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.equal(out.safety_line, SAFETY_LINE);
    assert.equal(out.emergency, null, "none of these is an emergency");
    assert.equal(out.best_match?.ka_number, ka, `${description}: got ${out.best_match?.ka_number} ${out.best_match?.title}`);
  });
}

test("no water is never routed to Heat or Hot Water; rodents never to Heat or Hot Water; a lobby never to Dirty Gutter", async () => {
  for (const description of ["no water in my building since this morning", "rodents in my building"]) {
    const out = await howToReport({ description }, client);
    assert.doesNotMatch(out.best_match?.title ?? "", /Heat or Hot Water/);
  }
  const lobby = await howToReport({ description: "trash piling up in the lobby" }, client);
  assert.notEqual(lobby.best_match?.title, "Dirty Gutter");
});

test("a car alarm keeps Noise from Vehicle among the alternatives", async () => {
  const out = await howToReport({ description: "a car alarm has been going off for hours" }, client);
  assert.ok(JSON.stringify(out.alternatives ?? []).includes("Noise from Vehicle"), JSON.stringify(out.alternatives));
});

test("hot water still goes to Heat or Hot Water, and engine noise still to Noise from Vehicle", async () => {
  const hot = await howToReport({ description: "no hot water in my apartment" }, client);
  assert.equal(hot.best_match?.ka_number, "KA-01036");
  const noise = await howToReport({ description: "a car is blasting loud music" }, client);
  assert.equal(noise.best_match?.ka_number, "KA-01102");
});

// Every phrasing from the retest-2 routing table, word for word, with the article each must find.
const RETEST_2_TABLE = [
  ["no heat or hot water in my apartment", "KA-01036"],
  ["noise from a bar down the street every night", "KA-01085"],
  ["a delivery truck is blocking the bike lane", "KA-01260"],
  ["broken parking meter", "KA-01240"],
  ["broken traffic light at the intersection", "KA-01404"],
  ["street flooding after the rain", "KA-02198"],
  ["a sidewalk shed has been up for years", "KA-02291"],
  ["rodents in my building", "KA-02278"],
  ["bed bugs in my apartment", "KA-01236"],
  ["illegal fireworks every night", "KA-02249"],
  ["a homeless person on my block needs help", "KA-01037"],
  ["I got food poisoning at a restaurant", "KA-02051"],
  ["dirty sidewalk", "KA-01803"],
  ["water leak from the ceiling", "KA-01509"],
  ["trash piling up in the lobby", "KA-01074"],
  ["overflowing litter basket on the corner", "KA-02143"],
  ["a car alarm has been going off for hours", "KA-01089"],
  ["the stop sign at the corner was knocked down", "KA-01063"],
  ["no water in my building since this morning", "KA-01405"],
  ["the store didn't shovel the snow on the sidewalk", "KA-01397"],
  ["a truck has been idling outside for an hour", "KA-02222"],
  ["dead tree", "KA-02006"],
  ["missed recycling", "KA-01788"],
];

test("the retest-2 routing table, word for word", async () => {
  const wrong = [];
  for (const [description, ka] of RETEST_2_TABLE) {
    const out = await howToReport({ description }, client);
    if (out.best_match?.ka_number !== ka) wrong.push(`${description}: ${out.best_match?.ka_number} ${out.best_match?.title}`);
  }
  assert.deepEqual(wrong, []);
});
