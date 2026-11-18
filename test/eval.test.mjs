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

test("the source-and-as-of invariant fails an answer with no link or no as-of", () => {
  assert.equal(sourceAndAsOf({ data_as_of: "2026-11-07T00:00:00Z" }).ok, false);
  assert.equal(sourceAndAsOf({ url: "https://x.example/" }).ok, false);
  assert.equal(sourceAndAsOf({ url: "https://x.example/", as_of: "2026-11-07" }).ok, true);
});

test("every eval question passes offline", async () => {
  const rows = await runEval();
  assert.deepEqual(rows.filter((r) => !r.ok).map((r) => `${r.id}: ${r.failed.join("; ")}`), []);
});
