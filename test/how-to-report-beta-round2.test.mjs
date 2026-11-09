// Beta retest 1 (2026-11-08, home machine): two routing misses ("dead tree" got Fallen
// Tree or Branch; "skipped our garbage pickup" got Litter Basket Complaint), plus 15
// everyday phrasings as regression tests. Over the recorded 311 content (no network); the
// Dead Tree, Parking Meter, Street Flooding, Scaffold or Sidewalk Shed, Bed Bug, Food
// Poisoning, Homeless Outreach, Bike Lane and Litter Basket articles were recorded from
// the live API on 2026-11-08. Every route is a City article from 311's own lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";

const DSNY = "Department of Sanitation";
const HPD = "Department of Housing Preservation and Development";

// [description, article, what else must hold]
const ROWS = [
  // The two misses.
  ["there's a dead tree on the sidewalk in front of my house", "KA-02006", { agency: "Department of Parks and Recreation" }],
  ["the tree in front of my building is dying", "KA-02006", {}],
  ["a tree fell on the sidewalk", "KA-02138", {}],
  ["sanitation skipped our garbage pickup this week", "KA-01788", { agency: DSNY, problem: "Missed Collection" }],
  ["our trash wasn't picked up", "KA-01788", { agency: DSNY }],
  // Fifteen everyday phrasings.
  ["my landlord hasn't turned on the heat and there's no hot water", "KA-01036", { agency: HPD }],
  ["the bar downstairs blasts music until 4am", "KA-01085", {}],
  ["a delivery truck is parked in the bike lane", "KA-01986", {}], // Since beta.9 a vehicle in a bike lane is Illegal Parking (KA-01986 lists "Blocking a: ... Bike lane"; KA-01260 says "Illegal Parking to report a vehicle blocking a bike lane").
  ["the parking meter on my block is broken", "KA-01240", { agency: "Department of Transportation" }],
  ["the traffic light at the corner is broken", "KA-01404", {}],
  ["the street is flooded after the rain", "KA-02198", { agency: "Department of Environmental Protection" }],
  ["the sidewalk shed on my block has been up for years", "KA-02291", { agency: "Department of Buildings" }],
  ["there are rats in my building", "KA-02278", { agency: HPD }],
  ["I have bed bugs in my apartment", "KA-01236", { agency: HPD }],
  ["people setting off illegal fireworks every night", "KA-02249", {}],
  ["a homeless person on my block needs help", "KA-01037", { agency: "Department of Homeless Services" }],
  ["I got food poisoning at a restaurant", "KA-02051", { agency: "Department of Health and Mental Hygiene" }],
  ["the sidewalk in front of the store is dirty", "KA-01803", { agency: DSNY }],
  ["they missed our recycling pickup", "KA-01788", { agency: DSNY }],
  ["water is leaking from my ceiling", "KA-01509", {}],
];

const { client } = await fixtureContent();

test("the two misses and 15 everyday phrasings are covered", () => assert.ok(ROWS.length >= 17));

for (const [description, ka, want] of ROWS) {
  test(`beta retest phrasing: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.equal(out.safety_line, SAFETY_LINE);
    assert.equal(out.emergency, null, "none of these is an emergency");
    assert.equal(out.best_match?.ka_number, ka);
    if (want.agency) assert.equal(out.best_match.agency, want.agency);
    if (want.problem) assert.equal(out.best_match.problem_type, want.problem);
  });
}

test("a missed pickup is never routed to Litter Basket", async () => {
  for (const description of ["sanitation skipped our garbage pickup this week", "they missed our recycling pickup"]) {
    const out = await howToReport({ description }, client);
    assert.notEqual(out.best_match?.title, "Litter Basket Complaint or Request");
  }
});

test("Litter Basket only when a can, basket or bin is named", async () => {
  const lobby = await howToReport({ description: "there is trash in the lobby" }, client);
  assert.notEqual(lobby.best_match?.ka_number, "KA-02143");
  const can = await howToReport({ description: "the garbage can on the corner is overflowing" }, client);
  assert.equal(can.best_match?.ka_number, "KA-02143");
});
