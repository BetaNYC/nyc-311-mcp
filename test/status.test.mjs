// get_status in plain words (beta test, 2026-11-08: the answer was only {"inEffect":false}).
// The stubbed bodies are the shapes the live API returned on 2026-11-08. No network.
import { SAFETY_LINE } from "../dist/emergency.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../dist/tools.js";
import { describeStatus, STATUS_CHECKS } from "../dist/status.js";

const NOW = new Date("2026-11-08T12:00:00Z");

test("not in effect: a plain no, what it checks in the City's words, and when it was asked", () => {
  const out = describeStatus("CodeBlue", { inEffect: false }, NOW);
  assert.equal(out.inEffect, false, "the API's field is kept as returned");
  assert.equal(out.plain_language.in_effect, false);
  assert.match(out.plain_language.answer, /^No: the City's 311 API says Code Blue is not in effect right now\./);
  assert.match(out.plain_language.what_it_checks, /^API to determine if Code Blue status is currently active\./);
  assert.equal(out.plain_language.checked_at, "2026-11-08T12:00:00.000Z");
  assert.match(out.plain_language.not_alternate_side_parking, /get_calendar/);
  assert.equal(out.source.name, "NYC 311 Public API, Status/CodeBlue");
});

test("in effect, and OEM's event name", () => {
  assert.match(describeStatus("SnowOnSidewalk", { inEffect: true }, NOW).plain_language.answer, /^Yes: .*Snow or Ice on Sidewalk emergency is in effect now\.$/);
  const oem = describeStatus("OEM", { eventName: "", inEffect: false }, NOW);
  assert.equal(oem.plain_language.event_name, null);
  assert.equal(oem.eventName, "");
  assert.match(describeStatus("OEM", { eventName: "Coastal Storm", inEffect: true }, NOW).plain_language.answer, /\(Coastal Storm\)\.$/);
});

test("an answer without inEffect is shown as returned, and says so", () => {
  const out = describeStatus("FireHydrant", "maintenance", NOW);
  assert.equal(out.plain_language.in_effect, null);
  assert.equal(out.answer_as_returned, "maintenance");
  assert.match(out.plain_language.answer, /did not say whether/);
});

test("every status type has the City's description", () => {
  for (const t of ["CodeBlue", "FireHydrant", "OEM", "SnowOnSidewalk", "SnowOnStreet"]) assert.match(STATUS_CHECKS[t].city_description, /^API to (determine|get) /);
});

test("get_status through callTool returns plain_language", async () => {
  process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/Status\/SnowOnStreet$/);
    return new Response(JSON.stringify({ inEffect: false }), { status: 200 });
  };
  try {
    const r = await callTool("get_status", { type: "SnowOnStreet" });
    assert.notEqual(r.isError, true, r.content[0].text);
    const out = JSON.parse(r.content[0].text.slice(0, -SAFETY_LINE.length));
    assert.equal(out.inEffect, false);
    assert.match(out.plain_language.answer, /^No: .*Snow or Ice on Street emergency is not in effect/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
