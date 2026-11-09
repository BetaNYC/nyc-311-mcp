// Beta retest 3 (2026-11-09, home machine): three routing misses, one debatable route, a
// "strong" rating built on one shared word, and an empty agency field. Every route below is
// a City article from 311's own lists, recorded read-only from the live 311 Public API on
// 2026-11-09 in test/fixtures/content/GetContent/ (no ZIP codes in these three):
//   KA-01091 Noise from Construction: "construction activity during, before, or after
//     hours"; its report options include "Noise from Jackhammer" and "Noise from After
//     Hours Construction". Residential construction "is allowed between 7 AM and 6 PM".
//   KA-01071 Bus Stop Shelters: "report an existing bus stop shelter that needs
//     maintenance or repair"; report option "Bus Stop Shelter Complaint" (DOT).
//   KA-02152 Street Vendor Complaint: "a vendor operating on City streets, sidewalks, or
//     bridges"; its "Unlicensed" section has "Unlicensed Street Vendor" (DSNY).
//   KA-02245 Dead Animal on Public Property: "a dead animal in a public place, including
//     sidewalks, highways, and parks"; "Dead Animal on a Sidewalk or Street" (DSNY).
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, AGENCY_NOT_LISTED, AGENCY_DEPENDS } from "../dist/how-to-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";

const ROWS = [
  ["a construction site starts jackhammering at 6am", "KA-01091"],
  ["they are jackhammering next door at 6am", "KA-01091"],
  ["construction noise late at night", "KA-01091"],
  ["the glass in the bus stop shelter is smashed", "KA-01071"],
  ["smashed bus shelter glass", "KA-01071"],
  ["someone is selling food on the street without a permit", "KA-02152"],
  ["unlicensed street food seller", "KA-02152"],
  ["there's a dead rat on the sidewalk", "KA-02245"],
  ["a dead pigeon on my block", "KA-02245"],
];

const { client } = await fixtureContent();

for (const [description, ka] of ROWS) {
  test(`beta retest 3 phrasing: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.equal(out.safety_line, SAFETY_LINE);
    assert.equal(out.emergency, null, "none of these is an emergency");
    assert.equal(out.best_match?.ka_number, ka, `${description}: got ${out.best_match?.ka_number} ${out.best_match?.title}`);
  });
}

test("6am jackhammering picks a construction-noise report option, never the No Smoking Sign article", async () => {
  const out = await howToReport({ description: "a construction site starts jackhammering at 6am" }, client);
  assert.match(out.best_match.best_action?.name ?? "", /^Noise from (Jackhammer|After Hours Construction)$/);
  assert.equal(out.best_match.agency, "Department of Environmental Protection");
  assert.notEqual(out.best_match.title, "Construction Site No Smoking Sign Complaint");
});

test("a dead rat on the sidewalk: Dead Animal first, Rat or Mouse still offered", async () => {
  const out = await howToReport({ description: "there's a dead rat on the sidewalk" }, client);
  assert.equal(out.best_match.best_action?.name, "Dead Animal on a Sidewalk or Street");
  assert.ok(out.alternatives.some((a) => a.title === "Rat or Mouse Complaint"), JSON.stringify(out.alternatives.map((a) => a.title)));
  // A live rat is still a rat complaint.
  const live = await howToReport({ description: "rats running on the sidewalk" }, client);
  assert.equal(live.best_match.ka_number, "KA-01107");
});

test("an unlicensed vendor picks the Unlicensed Street Vendor option", async () => {
  const out = await howToReport({ description: "unlicensed street food seller" }, client);
  assert.equal(out.best_match.best_action?.name, "Unlicensed Street Vendor");
});

test("a bus shelter picks its complaint option, not a request for a new shelter", async () => {
  const out = await howToReport({ description: "the glass in the bus stop shelter is smashed" }, client);
  assert.equal(out.best_match.best_action?.name, "Bus Stop Shelter Complaint");
  assert.equal(out.best_match.agency, "Department of Transportation");
});

test("one shared word is never rated strong", async () => {
  // Each of these shares only one specific word with many titles in its categories.
  for (const description of ["construction", "something about construction at the site", "a sign"]) {
    const out = await howToReport({ description }, client);
    if (out.best_match) assert.doesNotMatch(out.best_match.confidence, /^strong/, `${description}: ${out.best_match.title} ${out.best_match.confidence}`);
  }
});

test("clear matches stay strong", async () => {
  for (const description of ["a car is parked in front of the fire hydrant on my street", "bed bugs in my apartment", "the stop sign at the corner was knocked down", "there's mold all over my bathroom ceiling"]) {
    const out = await howToReport({ description }, client);
    assert.match(out.best_match.confidence, /^strong/, `${description}: ${out.best_match.title} ${out.best_match.confidence}`);
  }
});

test("the agency field is never empty", async () => {
  const cases = [
    // No report option: the one agency the article's text names.
    ["a delivery truck is blocking the bike lane", "KA-01260"],
    ["broken traffic light at the intersection", "KA-01404"],
    // Report options for more than one agency, none picked by the words.
    ["water is leaking from my ceiling", "KA-01509"],
    ["the sidewalk wasn't shoveled and it's icy", "KA-01397"],
  ];
  for (const [description, ka] of cases) {
    const out = await howToReport({ description }, client);
    const b = out.best_match;
    assert.equal(b.ka_number, ka, `${description}: got ${b.ka_number} ${b.title}`);
    assert.ok(typeof b.agency === "string" && b.agency.length > 0, `${description}: agency ${b.agency}`);
    assert.ok(b.agency_source, `${description}: agency_source`);
  }
  const bike = await howToReport({ description: "a delivery truck is blocking the bike lane" }, client);
  if (bike.best_match.report_actions.length === 0) {
    assert.equal(bike.best_match.agency, "Department of Transportation (DOT)");
    assert.match(bike.best_match.agency_source, /article's text/);
  }
  const signal = await howToReport({ description: "broken traffic light at the intersection" }, client);
  assert.equal(signal.best_match.agency, "Department of Transportation (DOT)");
  assert.doesNotMatch(signal.first_line, /handled by/, "an agency read from the text is not claimed as the handler in the first line");
  const leak = await howToReport({ description: "water is leaking from my ceiling" }, client);
  if (!leak.best_match.best_action) assert.equal(leak.best_match.agency, AGENCY_DEPENDS);
  assert.equal(typeof AGENCY_NOT_LISTED, "string");
  assert.match(AGENCY_NOT_LISTED, /^agency not listed by 311/);
});

test("a stop sign that was knocked down picks the fallen-sign option and its agency", async () => {
  const out = await howToReport({ description: "the stop sign at the corner was knocked down" }, client);
  assert.equal(out.best_match.best_action?.name, "Street Sign Fallen, Dangling, or Leaning");
  assert.equal(out.best_match.agency, "Department of Transportation");
});
