// Beta test round 1 (2026-11-08, home machine): everyday phrasings that went to the wrong
// 311 article or none. Over the recorded 311 content (no network); the Parks & Recreation
// (311-36) and Air (311-48) lists and the Graffiti, Barbecuing, Park Maintenance, Neighbor
// Odor and Chimney Smoke articles were recorded from the live API on 2026-11-08.
// Every route is the City's own article and report option; none is invented here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";

const DPR = "Department of Parks and Recreation";
const DOHMH = "Department of Health and Mental Hygiene";
const HPD = "Department of Housing Preservation and Development";

// [description, article (best match, or the first alternative when that article is not
// recorded), what else must hold]
const ROWS = [
  // Grills: Barbecuing is the closest City article; its only report option is for a park or
  // beach, so for a neighbor's grill no option is picked and the answer says it is not exact.
  ["not an emergency, just some smoke from a neighbor's grill", "KA-02228", { agency: null, closest: true }],
  ["smoke from a neighbor's barbecue grill coming in my window", "KA-02228", { agency: null, closest: true }],
  ["someone is grilling on the sidewalk", "KA-02228", { agency: null, closest: true }],
  ["someone is barbecuing in the park", "KA-02228", { agency: DPR, problem: "Violation of Park Rules" }],
  // Graffiti: the Graffiti article, never an apartment repair.
  ["graffiti on a mailbox", "KA-02070", { section: "USPS Mailbox" }],
  ["graffiti on the wall of a building", "KA-02070", { section: "Graffiti Removal Request for a Building, Sidewalk, or Street" }],
  ["someone spray painted graffiti on my store", "KA-02070", {}],
  ["graffiti in the park", "KA-02070", { agency: DPR, action: "Graffiti in Park" }],
  ["graffiti on the highway", "KA-02070", { action: "Graffiti on Highway" }],
  // Rats: the report option for the place named; a park is never HPD's at-home form.
  ["rats in the park", "KA-01107", { agency: DPR, action: "Rat or Mouse Complaint in Park" }],
  ["rats running around the playground", "KA-01107", { agency: DPR, action: "Rat or Mouse Complaint in Park" }],
  ["rats on the sidewalk", "KA-01107", { agency: DOHMH, action: "Rat or Mouse Complaint on a Sidewalk or Street" }],
  ["rats in the school yard", "KA-01107", { action: "Rat or Mouse Complaint in School" }],
  ["mice in my apartment", "KA-02278", { agency: HPD, action: "Pests in Apartment" }],
  ["there are mice in the hallway of my building", "KA-02278", { agency: HPD, action: "Pests in Public Area of Residential Building" }],
  // Park maintenance, and several problems in one description: each is answered.
  ["a broken bench in the park", "KA-01060", { agency: DPR }],
  ["the swings in the playground are broken", "KA-01060", { agency: DPR }],
  ["broken water fountain in the playground", "KA-01060", { agency: DPR }],
  ["the basketball hoop in the park is broken", "KA-01060", { agency: DPR }],
  ["Overflowing trash can and a broken bench in the park", "KA-02143", { others: ["KA-01060"] }],
  ["the streetlight is out and there is graffiti on the pole", "KA-02463", { others: ["KA-02070"] }],
  // Unchanged everyday ones, to show the new words did not move them.
  ["pothole on Gun Hill Road", "KA-01093", {}],
  ["a car is parked in front of the fire hydrant on my street", "KA-01986", { agency: "New York City Police Department", action: "Illegal Parking" }],
  ["my neighbor's cooking odor comes into my apartment", "KA-01332", {}],
  ["no heat in my apartment", "KA-01036", {}],
];

const { client } = await fixtureContent();

test("at least 20 everyday phrasings are covered", () => assert.ok(ROWS.length >= 20));

for (const [description, ka, want] of ROWS) {
  test(`beta phrasing: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.equal(out.safety_line, SAFETY_LINE);
    assert.equal(out.emergency, null, "none of these is an emergency");
    const b = out.best_match;
    assert.equal(b?.ka_number ?? out.alternatives[0]?.ka_number ?? null, ka);
    if ("agency" in want) assert.equal(b.agency, want.agency);
    if (want.problem) assert.equal(b.problem_type, want.problem);
    if (want.action) assert.equal(b.best_action?.name, want.action);
    if (want.section) assert.equal(b.matched_section?.name, want.section);
    if (want.closest) {
      assert.equal(b.best_action, null);
      assert.match(b.no_best_action, /closest 311 article, but not an exact match/);
    }
    if (b && /^(Graffiti|Barbecuing)$/.test(b.title)) assert.notEqual(b.agency, HPD);
    assert.deepEqual((out.other_problems ?? []).map((x) => x.best_match?.ka_number ?? x.alternatives[0]?.ka_number), want.others ?? []);
  });
}

test("the multi-problem answer tells the person to report each one separately", async () => {
  const out = await howToReport({ description: "Overflowing trash can and a broken bench in the park" }, client);
  assert.match(out.other_problems_note, /Report each one separately/);
});
