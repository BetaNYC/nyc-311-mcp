// Beta test round 1 (2026-11-08): year-over-year numbers that mislead.
// - A status filter compares open-now with year-old requests that are open now; most of
//   those closed in the year since, so the comparison is not like for like.
// - A tiny year-earlier count makes a huge percent that means little.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDistrictTool, SMALL_BASE } from "../dist/district-tools.js";
import { parseToolArgs } from "../dist/tools.js";
import { fixtureData } from "./district-fixture.mjs";

async function run(name, args) {
  const { data } = await fixtureData();
  const env = await runDistrictTool(name, parseToolArgs(name, args), data);
  return { env, data: env.data };
}

test("the small-numbers threshold is 30", () => assert.equal(SMALL_BASE, 30));

test("top_problems: percent change only when the year-earlier count is 30 or more; counts always shown", async () => {
  const { env, data } = await run("top_problems", { community_district: 484, from_date: "2021-01-01", limit: 20 });
  let small = 0, big = 0;
  for (const p of data.problems) {
    assert.equal(typeof p.same_days_a_year_earlier, "number", p.problem);
    assert.equal(p.change, p.requests - p.same_days_a_year_earlier, p.problem);
    if (p.same_days_a_year_earlier < SMALL_BASE) {
      small++;
      assert.equal(p.change_pct, null, p.problem);
      assert.match(p.change_note, /small numbers; percent change not shown/, p.problem);
    } else {
      big++;
      assert.equal(typeof p.change_pct, "number", p.problem);
      assert.equal(p.change_note, undefined, p.problem);
    }
  }
  assert.ok(small > 0 && big > 0, "the fixture has both kinds");
  assert.match(env.caveats.join(" "), /under 30/);
});

for (const status of ["not_closed", "closed"]) {
  test(`top_problems with status '${status}': no year-earlier comparison, and the answer says why`, async () => {
    const { env, data } = await run("top_problems", { community_district: 484, from_date: "2021-01-01", status });
    assert.equal(data.year_earlier, null);
    assert.equal(data.requests_year_earlier, null);
    assert.ok(data.problems.length > 0);
    for (const p of data.problems) {
      assert.equal(p.same_days_a_year_earlier, null);
      assert.equal(p.change, null);
      assert.equal(p.change_pct, null);
    }
    assert.match(env.caveats.join(" "), /status filter/i);
    assert.match(env.caveats.join(" "), /a year to close/);
  });
}

test("problem_trend with a status filter: no year-earlier series either", async () => {
  const { env, data } = await run("problem_trend", { community_district: 484, problem: "Street Light Condition", fiscal_year: 2026, status: "not_closed" });
  assert.ok(data.months.length > 0);
  for (const m of data.months) assert.equal(m.same_days_a_year_earlier, null);
  assert.match(env.caveats.join(" "), /status filter/i);
});

test("without a status filter the year-earlier numbers are unchanged", async () => {
  const { data } = await run("problem_trend", { community_district: 484, problem: "Street Light Condition", fiscal_year: 2026 });
  assert.ok(data.months.some((m) => typeof m.same_days_a_year_earlier === "number"));
});
