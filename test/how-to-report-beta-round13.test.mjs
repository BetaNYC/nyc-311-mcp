// Beta retest 12 (2026-11-09, home machine, 1.2.0-beta.12) FAILED, closer: four missed
// emergencies, one ordinary complaint with the medical 911 line, one wrong strong answer, and a
// regression for potholes on Eastern and Ocean Parkway. Fixed by class:
//   - violence between people in the present tense (any of beating, hitting, punching, choking,
//     stabbing, attacking, dragging ... a person), domestic violence with any relationship word,
//     and never a building-repair article for violence;
//   - someone at a height who may jump or fall (bridge railing, roof edge, ledge, window), the
//     general danger article, and 988 only from the City's Suicide article, when the person's
//     words are about suicide;
//   - water rising where people are; a vehicle out of control now;
//   - medical danger words apply to people: not to an animal (the animal path) and not to a
//     figure of speech ("yowls like it's being hurt", "killing me");
//   - a TV or a stereo is noise only with a sound word; left on the sidewalk it is dumping;
//   - "Parkway" alone is a city street: only named expressway-type parkways are highways (the
//     round-12 highway rule had matched every parkway).
// Measured on 687 phrasings (rounds 6 to 13): on beta.12, 16 missed emergencies, 3 ordinary
// complaints leading with 911 and 6 wrong answers rated strong; now none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, HIGHWAY } from "../dist/how-to-report.js";
import { draftReport } from "../dist/draft-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

const client = await stressClient();
const kinds = (d) => assessDanger(d).kinds.map((k) => k.id);

test("violence between people, now: 911, domestic violence when the words say so, never a building repair", async () => {
  for (const d of ["a man is beating a woman in the stairwell of my building", "a guy is choking a woman in the parking lot", "someone is stabbing a man on the train", "a man is dragging a woman into a car", "a group of teens is attacking a homeless man on the corner"]) {
    assert.ok(kinds(d).includes("crime"), d);
  }
  assert.ok(kinds("my neighbor is beating his girlfriend in the hallway").includes("domestic_violence"));
  const out = await howToReport({ description: "a man is beating a woman in the stairwell of my building" }, client);
  assert.ok(out.emergency);
  assert.ok(![out.best_match, ...out.alternatives].some((a) => a && /heat|hot water|maintenance/i.test(a.title)), "no housing article");
  for (const d of ["my neighbors argue every night but nobody gets hurt", "kids play fight on my stoop every afternoon"]) assert.deepEqual(kinds(d), [], d);
});

test("someone at a height: 911 with the general article; 988 only for words about suicide", () => {
  for (const d of ["a person is standing on the outside of the bridge railing", "a man is sitting on the edge of the roof of my building", "a toddler is hanging out of a fourth floor window", "a worker is dangling from the scaffolding"]) {
    assert.ok(kinds(d).includes("height"), d);
  }
  assert.deepEqual(kinds("window washers are hanging off the building next door all morning"), []);
  assert.ok(!kinds("a person is standing on the outside of the bridge railing").includes("suicide"), "no suicide reading from position alone");
  assert.ok(kinds("someone says they want to die and is standing on the bridge railing").includes("suicide"));
});

test("floods with people inside, and vehicles out of control now", () => {
  for (const d of ["a water main burst and water is rushing into basements with people inside", "the flood water is rising and my parents are stuck in the basement", "water is up to my neighbor's chest in their basement apartment", "a car is stuck in the flooded underpass and the driver is inside"]) {
    assert.ok(kinds(d).includes("flood_people"), d);
  }
  for (const d of ["there's black ice on the bridge and cars are spinning out right now", "a truck is sliding down the icy hill toward the playground", "a car is driving on the sidewalk and almost hitting people right now"]) {
    assert.ok(kinds(d).includes("vehicle_out_of_control"), d);
  }
  for (const d of ["my basement floods every time it rains", "cars always skid on this hill when it snows"]) assert.deepEqual(kinds(d), [], d);
});

test("medical danger words are for people, not animals or figures of speech", async () => {
  for (const d of ["a stray cat yowls all night like it's being hurt", "a dog got hit by a car and is limping", "this construction noise is killing me", "the music from the bar sounds like a bomb went off", "my neighbor's dog barks like it's being murdered"]) {
    assert.deepEqual(kinds(d), [], d);
  }
  assert.ok(kinds("a car hit a dog and the driver is hurt").includes("hurt"), "a person hurt still counts");
  const out = await howToReport({ description: "a pigeon with a broken wing is sitting on my stoop" }, client);
  assert.equal(out.best_match?.ka_number ?? out.alternatives[0]?.ka_number, "KA-01789");
});

test("a broken TV on the sidewalk is dumping, not noise", async () => {
  const out = await howToReport({ description: "someone left a broken TV on the sidewalk" }, client);
  assert.ok(!/noise/i.test(out.best_match?.title ?? ""), out.best_match?.title);
  assert.equal(out.best_match?.ka_number, "KA-02097");
});

test("Parkway is a street unless it is a named expressway-type parkway", async () => {
  for (const d of ["pothole on Eastern Parkway", "pothole on Ocean Parkway", "pothole on Pelham Parkway", "pothole on Mosholu Parkway", "pothole on Eastern Pkwy"]) assert.equal(HIGHWAY.test(d.toLowerCase()), false, d);
  for (const d of ["pothole on the belt parkway", "grand central parkway", "the hutchinson river parkway", "cross bronx expressway", "the fdr drive", "henry hudson parkway", "bronx river parkway", "jackie robinson parkway"]) assert.equal(HIGHWAY.test(d), true, d);
  const { soda } = await fixtureSla();
  const { data } = await fixtureData();
  for (const [d, loc] of [["big pothole on Eastern Parkway in Crown Heights", "Eastern Pkwy and Nostrand Ave"], ["pothole on Ocean Parkway", "Ocean Pkwy and Avenue J"]]) {
    const out = await draftReport({ description: d, location: loc, borough: "Brooklyn" }, client, soda, data);
    assert.equal(out.drafted, true, d);
    assert.equal(out.reports[0].report_at.ka_number, "KA-01093", d);
  }
  const belt = await howToReport({ description: "pothole on the Belt Parkway near exit 9" }, client);
  assert.equal(belt.best_match?.ka_number, "KA-01106");
});
