// Beta test round 1 (2026-11-08): board and Council staff write community districts as
// BK09, MN03 or "Brooklyn 9", not BoardStat's 309. Every form maps to the same id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDistrict, parseCommunityDistrict, runDistrictTool } from "../dist/district-tools.js";
import { parseToolArgs } from "../dist/tools.js";
import { MANIFEST, fixtureData } from "./district-fixture.mjs";

const SAME = [
  [309, ["309", 309, "BK09", "bk9", "BK 09", "BK-9", "Brooklyn 9", "brooklyn cd 9", "Brooklyn CD 09", "Brooklyn Community District 9", "Brooklyn Community Board 9", "Brooklyn CB9", "Kings 9", "CD 9 Brooklyn", "Community District 9, Brooklyn"]],
  [103, ["MN03", "mn3", "Manhattan 3", "Manhattan Community District 3", "Manhattan CB 3", "New York County 3"]],
  [212, ["BX12", "Bronx 12", "The Bronx CD 12"]],
  [401, ["QN01", "Queens 1", "QN 1"]],
  [503, ["SI03", "Staten Island 3", "Richmond 3", "SI 3"]],
];

for (const [id, forms] of SAME) {
  test(`community district forms for ${id} all resolve to ${id}`, () => {
    for (const f of forms) {
      assert.equal(parseCommunityDistrict(f), id, String(f));
      assert.equal(resolveDistrict(MANIFEST, { community_district: f }).id, id, String(f));
    }
  });
}

test("a form that is not a district gets a plain error that shows the accepted forms and an example", () => {
  for (const bad of ["Gotham 9", "BK", "XX09", "Brooklyn", "ninety", ""]) {
    assert.throws(
      () => resolveDistrict(MANIFEST, { community_district: bad }),
      (e) => /BK09/.test(e.message) && /Brooklyn 9/.test(e.message) && /309/.test(e.message) && !/expected a number/.test(e.message),
      bad
    );
  }
});

test("a well-formed code for a district that does not exist names both forms", () => {
  assert.throws(() => resolveDistrict(MANIFEST, { community_district: "BK19" }), /BK19.*319|319.*BK19/);
  assert.throws(() => resolveDistrict(MANIFEST, { community_district: "MN13" }), /Manhattan 101-112/);
});

test("council districts accept 'Council District 7' and 'CD7' is not mistaken for one", () => {
  assert.equal(resolveDistrict(MANIFEST, { council_district: "Council District 7" }).id, 7);
  assert.equal(resolveDistrict(MANIFEST, { council_district: "district 7" }).id, 7);
  assert.throws(() => resolveDistrict(MANIFEST, { council_district: "BK09" }), /1 to 51/);
});

test("a district tool answers MN01-style ids end to end, through the argument parser", async () => {
  for (const form of ["MN01", "Manhattan CD 1", 101]) {
    const { data } = await fixtureData();
    const env = await runDistrictTool("district_summary", parseToolArgs("district_summary", { community_district: form, last_days: 30 }), data);
    assert.equal(env.data.district.id, 101, String(form));
  }
});
