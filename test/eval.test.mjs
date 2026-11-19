// #46: the evaluation set stays runnable offline and keeps its shape: at least 10 realistic
// questions, each with checks and the place its known answer came from. Its score is recorded in
// eval/runs/; here every question must still pass, so a change that breaks a known answer shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS, runEval, sourceAndAsOf } from "../eval/run.mjs";

test("the eval set has at least 10 questions, each with checks and a known answer's source", () => {
  assert.ok(QUESTIONS.length >= 10, `${QUESTIONS.length} questions`);
  assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length, "ids are unique");
  for (const q of QUESTIONS) {
    assert.ok(q.q && q.tool && q.args, q.id);
    assert.ok(q.checks.length > 0, `${q.id} has no checks`);
    assert.ok(q.known_from?.trim(), `${q.id} does not say where its answer came from`);
  }
});

test("the source-and-as-of invariant reads only the answer's own provenance block", () => {
  const now = new Date().toISOString();
  const prov = { source: "NYC 311 Public API: GetCalendar and Status", publisher: "City of New York", source_url: "https://api-portal.nyc.gov/x", as_of: now, as_of_kind: "retrieved" };
  assert.equal(sourceAndAsOf({ days: [], provenance: prov }).ok, true);
  assert.equal(sourceAndAsOf({ data_as_of: "2026-11-07T10:36:39Z", source: { url: "https://www.beta.nyc/boardstat/" }, data: {} }).ok, true);
  assert.equal(sourceAndAsOf({ source: { url: "https://api-portal.nyc.gov/x", fetched_at: now } }).ok, true);
  // #49 review: a link and an as-of anywhere in the answer used to be enough. Not any more.
  assert.equal(sourceAndAsOf({ SRResponses: [{ portal_url: "https://portal.311.nyc.gov/a", as_of: "2026-11-07" }] }).ok, false, "nested link and date");
  assert.equal(sourceAndAsOf({ url: "https://x.example/", as_of: "2026-11-07" }).ok, false, "top-level loose keys are no provenance block");
  assert.equal(sourceAndAsOf({ data_as_of: "2026-11-07T00:00:00Z" }).ok, false, "no source");
  assert.equal(sourceAndAsOf({ source: { url: "https://x.example/" }, rows: [{ data_as_of: "2026-11-07" }] }).ok, false, "as-of only in a row");
  assert.equal(sourceAndAsOf({ provenance: { ...prov, source_url: "http://api-portal.nyc.gov/x" } }).ok, false, "http, not https");
  assert.equal(sourceAndAsOf({ provenance: { ...prov, as_of: "not a date" } }).ok, false, "garbled date");
  assert.equal(sourceAndAsOf({ provenance: { ...prov, as_of: "2999-01-01" } }).ok, false, "future date");
  assert.equal(sourceAndAsOf({ provenance: { ...prov, as_of: null, as_of_kind: "unknown" } }).ok, false, "unknown as-of");
  assert.equal(sourceAndAsOf({ provenance: { ...prov, publisher: "" } }).ok, false, "no publisher");
  assert.equal(sourceAndAsOf({ provenance: prov, data_as_of: "x", source: { url: "https://x.example/" } }).ok, true, "a provenance block wins over other keys");
});

test("every tool family is in the eval, and district 484 is not most of it", () => {
  const tools = new Set(QUESTIONS.map((q) => q.tool));
  for (const t of ["get_calendar", "get_status", "get_service_request", "get_service_request_list", "how_to_report", "ll47_service_request_report", "cb_monthly_list", "find_requests"]) {
    assert.ok(tools.has(t), `no question for ${t}`);
  }
  const about484 = QUESTIONS.filter((q) => q.args.community_district === 484 || /\b484\b|Jacob Riis/.test(q.q)).length;
  assert.ok(about484 * 2 < QUESTIONS.length, `${about484} of ${QUESTIONS.length} questions are about district 484`);
});

test("every eval question passes offline", async () => {
  const rows = await runEval();
  assert.deepEqual(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.failed.join("; ")}`), []);
});
