// Beta retest 5 (2026-11-09, home machine): a park restroom that is locked, closed or dirty
// went to Breaking Park Rules (KA-02234) or Unlocked Park or Playground (KA-01950). The
// City's Park Maintenance Complaint (KA-01060, recorded in test/fixtures/content) covers
// "unclean conditions" and a "park, playground, or other park facility closed to the public
// during posted hours", so that is the article. Also: an agency named in an article's own
// text kept a possessive ("Department of Housing Preservation and Development's (HPD)").
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, parseQuery, agenciesNamedIn, PARK_RESTROOM } from "../dist/how-to-report.js";
import { draftReport } from "../dist/draft-report.js";
import { fixtureContent } from "./content-fixture.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

const { client } = await fixtureContent();
const PARK_MAINTENANCE = "KA-01060";

const PARK_RESTROOMS = [
  "public bathroom in the park is locked",
  "the public bathroom in the park is locked during the day",
  "the park restroom is closed",
  "the playground bathroom is dirty",
  "the bathroom in the playground is filthy",
  "the restrooms at the park are always locked",
  "the comfort station at the beach is closed",
  "park bathroom has no toilet paper",
  "the toilets in the playground are broken",
];

for (const description of PARK_RESTROOMS) {
  test(`a park restroom goes to Park Maintenance: ${description}`, async () => {
    const out = await howToReport({ description }, client);
    assert.equal(out.best_match?.ka_number, PARK_MAINTENANCE, `${description}: got ${out.best_match?.ka_number} ${out.best_match?.title}`);
    assert.notEqual(out.best_match.ka_number, "KA-02234", "not Breaking Park Rules");
    assert.notEqual(out.best_match.ka_number, "KA-01950", "not Unlocked Park or Playground");
    assert.equal(out.best_match.agency, "Department of Parks and Recreation");
  });
}

test("a dirty playground bathroom is one park problem, not trash or a home repair", () => {
  const q = parseQuery("the playground bathroom is dirty");
  assert.deepEqual(q.families, ["park_maintenance"]);
  assert.ok(!q.categories.includes("Tenants"));
});

test("a bathroom at home is not a park restroom", async () => {
  for (const t of ["the toilet in my bathroom is clogged", "my bathroom ceiling is leaking", "the bathroom sink in my apartment is broken", "parking lot by my building"]) {
    assert.equal(PARK_RESTROOM.test(t), false, t);
  }
  const out = await howToReport({ description: "the toilet in my bathroom is clogged" }, client);
  assert.notEqual(out.best_match?.ka_number, PARK_MAINTENANCE);
});

test("a playground left unlocked still lists Unlocked Park or Playground first", async () => {
  const out = await howToReport({ description: "the playground was left unlocked overnight" }, client);
  const first = out.best_match?.ka_number ?? out.alternatives?.[0]?.ka_number;
  assert.equal(first, "KA-01950");
});

test("a locked park bathroom is drafted for Parks", async () => {
  const { soda } = await fixtureSla();
  const { data } = await fixtureData();
  const out = await draftReport({ description: "the public bathroom in the park is locked during the day", location: "Van Cortlandt Park", borough: "Bronx" }, client, soda, data);
  assert.equal(out.drafted, true);
  assert.equal(out.reports[0].report_at.ka_number, PARK_MAINTENANCE);
  assert.equal(out.reports[0].report_at.agency, "Department of Parks and Recreation");
});

test("an agency named in an article's text drops a possessive, straight or curly", () => {
  assert.deepEqual(agenciesNamedIn("Report it to the Department of Housing Preservation and Development's (HPD) Code Enforcement unit."), [
    "Department of Housing Preservation and Development (HPD)",
  ]);
  assert.deepEqual(agenciesNamedIn("the Department of Housing Preservation and Development’s (HPD) inspectors"), [
    "Department of Housing Preservation and Development (HPD)",
  ]);
  assert.deepEqual(agenciesNamedIn("The Department of Transportation (DOT) maintains signals."), ["Department of Transportation (DOT)"]);
  // The same agency with and without the possessive is one agency.
  assert.deepEqual(
    agenciesNamedIn("The Department of Buildings (DOB) inspects. The Department of Buildings' (DOB) rules apply. The Department of Buildings's (DOB) office."),
    ["Department of Buildings (DOB)", "Department of Buildings' (DOB)"].slice(0, 1).concat([])
  );
});
