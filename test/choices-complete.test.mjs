// Live check 2026-11-19 (RESULTS.md, 311-27): draft_311_report for a street pothole listed 15
// of the 17 Problem Detail options and said only "more: 2", with no way to see them. One of the
// two was "Rough, Pitted or Cracked Roads", the street pothole option. Lists a person picks from
// are now given whole, in the City's words: Problem Detail options, each option's Additional
// Details (cut at 12 before), and an article's report options (cut at 15 in how_to_report).
// No network: the recorded 311 articles and cs9t-e3x8 rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { draftReport, detailOptions, optionText, slaTable } from "../dist/draft-report.js";
import { howToReport } from "../dist/how-to-report.js";
import { fixtureContent } from "./content-fixture.mjs";
import { fixtureSla, SLA_FIX } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

const ROWS = JSON.parse(readFileSync(path.join(SLA_FIX, "rows.json"), "utf8"));
const real = (v) => typeof v === "string" && v.trim() && v.trim() !== "N/A";

/** The City's rows for one problem type and agency: each Problem Detail with its Additional Details. */
function cityList(problem, agency) {
  const by = new Map();
  for (const r of ROWS) {
    if (r.problem.toLowerCase() !== problem.toLowerCase() || r.agency !== agency || !real(r.problem_details) || !real(r.sla_days)) continue;
    const add = by.get(r.problem_details.trim()) ?? new Set();
    if (real(r.additional_details)) add.add(r.additional_details.trim());
    by.set(r.problem_details.trim(), add);
  }
  return by;
}

async function setup() {
  const content = await fixtureContent();
  const sla = await fixtureSla();
  const { data } = await fixtureData();
  return { content, sla, data };
}

test("street pothole: all 17 Problem Detail options, including Rough, Pitted or Cracked Roads", async () => {
  const { content, sla, data } = await setup();
  // The live check's call, word for word.
  const out = await draftReport(
    { description: "There's a pothole on my block that keeps getting bigger.", location: "7th Avenue and 9th Street", borough: "Brooklyn", when: "since last week", ongoing: "keeps happening" },
    content.client,
    sla.soda,
    data
  );
  const r = out.reports[0];
  assert.equal(r.report_at.ka_number, "KA-01093");
  const o = r.what.problem_detail_options;
  const city = cityList("Street Condition", "Department of Transportation");
  assert.equal(city.size, 17, "the fixture has the 17 the live check saw");
  assert.equal(o.options.length, 17);
  assert.equal(o.count, 17);
  assert.equal("more" in o, false, "nothing is left out, so there is no 'more'");
  assert.ok(o.options.some((x) => x.startsWith("Rough, Pitted or Cracked Roads (")), "the street pothole option is listed");
  assert.ok(o.options.some((x) => x.startsWith("Unsafe Worksite (")));
  // Every name the City lists, exactly as it wrote it.
  assert.deepEqual(o.options.map((x) => x.replace(/(: .*)? \([^()]*\)$/, "")).sort(), [...city.keys()].sort());
  assert.match(r.questions_to_ask.join(" "), /17 options/);
});

test("every option of every problem type keeps every Additional Detail, in the City's words", async () => {
  const { soda } = await fixtureSla();
  const t = await slaTable(soda);
  const pairs = new Set(ROWS.filter((r) => real(r.problem_details)).map((r) => `${r.problem}\t${r.agency}`));
  let longest = 0;
  for (const pair of pairs) {
    const [problem, agency] = pair.split("\t");
    const city = cityList(problem, agency);
    const opts = detailOptions(t.rows, problem, agency).filter((o) => o.response_time.length);
    assert.deepEqual(opts.map((o) => o.problem_detail).sort(), [...city.keys()].sort(), pair);
    for (const o of opts) {
      assert.deepEqual([...o.additional_details].sort(), [...city.get(o.problem_detail)].sort(), `${pair}: ${o.problem_detail}`);
      longest = Math.max(longest, o.additional_details.length);
      // The line splits back into the City's own values: "; " is in none of them.
      const line = optionText(o);
      const m = line.match(/^(.*?)(?:: (.*))? \(([^()]*)\)$/);
      assert.equal(m[1], o.problem_detail, line);
      assert.deepEqual(m[2] ? m[2].split("; ") : [], o.additional_details, line);
    }
  }
  // Parks' "Structure - Outdoors" has 22 Additional Details; the old cut kept 12.
  assert.ok(longest > 12, `longest list ${longest}`);
  const parks = detailOptions(t.rows, "Maintenance or Facility", "Department of Parks and Recreation").find((o) => o.problem_detail === "Structure - Outdoors");
  assert.equal(parks.additional_details.length, 22);
});

test("a City value with commas stays one value: options split Additional Details by '; '", () => {
  const line = optionText({ problem_detail: "Department Store or Megastore", additional_details: ["Refund, Return, or Exchange Refused", "Overcharge"], response_time: ["30 days"] });
  assert.equal(line, "Department Store or Megastore: Refund, Return, or Exchange Refused; Overcharge (30 days)");
  for (const r of ROWS) for (const k of ["problem_details", "additional_details"]) if (real(r[k])) assert.ok(!r[k].includes(";"), r[k]);
});

test("how_to_report gives every report option of an article (KA-02136 has 60), not the first 15", async () => {
  const { content, data } = await setup();
  const raw = JSON.parse(readFileSync(path.join(path.dirname(SLA_FIX), "..", "content", "GetContent", "KA-02136.json"), "utf8"));
  const cityCount = raw.KnowledgeArticle[0].Section.reduce((n, s) => n + (s.ContentAction?.length ?? 0), 0);
  assert.equal(cityCount, 60);
  const out = await howToReport({ description: "the store overcharged me" }, content.client, data);
  const b = out.best_match;
  assert.equal(b.ka_number, "KA-02136");
  assert.equal(b.report_actions.length, 60);
  assert.equal("report_actions_truncated" in b, false);
  const online = b.ways_to_report.find((w) => w.method === "online");
  assert.match(online.how, /; and 54 more \(all 60 are in report_actions\)\.$/);
});
