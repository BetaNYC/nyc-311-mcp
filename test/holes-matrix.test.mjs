// Before merge (2026-11-09): "a dog walker fell into a sinkhole" got a pothole answer and no 911,
// in how_to_report and draft_311_report. Round 17's test said "...and a dog walker fell in", with
// the hole named first, so the subject-first form ("<person> fell into a <hole>") was never
// exercised, and only the danger detector was called, not the two tools. This test crosses the
// verbs with the holes and calls both tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport } from "../dist/how-to-report.js";
import { draftReport } from "../dist/draft-report.js";
import { stressClient } from "./stress-client.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

const client = await stressClient();
const { soda } = await fixtureSla();
const { data } = await fixtureData();

const VERBS = ["fell into", "fell in", "fell down", "has fallen into", "slipped into", "dropped into"];
const HOLES = ["a sinkhole", "a manhole", "a trench", "a hole", "a shaft"];
const SUBJECTS = ["a dog walker", "a worker"];

const cases = [];
for (const s of SUBJECTS) for (const v of VERBS) for (const h of HOLES) cases.push(`${s} ${v} ${h}`);

test(`holes matrix: ${cases.length} phrasings lead with 911 in how_to_report and draft_311_report`, async () => {
  const missed = [];
  for (const d of cases) {
    const how = await howToReport({ description: d }, client);
    if (!how.emergency) missed.push(`how_to_report: ${d}`);
    const draft = await draftReport({ description: d, location: "Broadway and W 96 St", borough: "Manhattan" }, client, soda, data);
    if (draft.drafted !== false || !/911/.test(draft.first_line)) missed.push(`draft_311_report: ${d}`);
  }
  assert.deepEqual(missed, []);
});

test("objects in a hole are not people in a hole", async () => {
  for (const d of ["my phone fell into a manhole", "my keys dropped into the sewer grate", "my dog fell into a hole", "my car's wheel fell into a pothole hole on the street", "the sidewalk fell into a sinkhole", "the truck got stuck in a trench"]) {
    const how = await howToReport({ description: d }, client);
    assert.equal(how.emergency, null, d);
  }
});
