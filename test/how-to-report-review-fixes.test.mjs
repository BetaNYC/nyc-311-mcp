// Two how_to_report fixes from the 2026-11-08 stack review. Recorded content, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, correctTypos, parseQuery } from "../dist/how-to-report.js";
import { fixtureContent } from "./content-fixture.mjs";

test("sparking wires lead with 911: the typo fixer does not turn 'sparking' into 'parking'", async () => {
  assert.equal(correctTypos("the wires are sparking").text, "the wires are sparking");
  const { client } = await fixtureContent();
  for (const d of ["the wires are sparking on the sidewalk", "an outlet is sparking in my apartment"]) {
    assert.deepEqual(parseQuery(d).danger.kinds.map((k) => k.id), ["electric"], d);
    const out = await howToReport({ description: d }, client);
    assert.ok(out.emergency, `${d}: no emergency lead`);
    assert.match(out.first_line, /call 911/i, d);
    assert.notEqual(out.best_match?.title, "Illegal Parking", d);
  }
});

test("danger is read from the person's own words, before any typo is corrected", () => {
  // Whatever the typo list holds, a danger word that is one edit from it stays a danger.
  const q = parseQuery("smoke coming from the outlet and it is sparking");
  assert.ok(q.danger.kinds.some((k) => k.id === "electric"));
});

test("'Article text as of' is the New York date, not the UTC date", async () => {
  // 21:30 in New York on 2026-11-07 is 02:30 UTC on 2026-11-08.
  const { client } = await fixtureContent({ now: () => Date.parse("2026-11-08T02:30:00Z") });
  const out = await howToReport({ description: "pothole on my street" }, client);
  assert.ok(out.best_match);
  assert.match(out.first_line, /Article text as of 2026-11-07\./);
});
