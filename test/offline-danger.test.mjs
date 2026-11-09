// Beta test round 1 (2026-11-08): with no API key and an empty cache, "I smell gas" got only
// the general 911 line and a missing-key error, because the danger check ran after the 311
// content fetch. The City's own "Call 911" lines for the gravest dangers are now built in,
// so the gas answer does not depend on the network. No network here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { howToReport } from "../dist/how-to-report.js";
import { draftReport } from "../dist/draft-report.js";
import { ContentClient } from "../dist/content-311.js";
import { BUILT_IN_911, SAFETY_LINE } from "../dist/emergency.js";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

async function offline(kind) {
  const saved = process.env.NYC_311_API_KEY;
  if (kind === "nokey") delete process.env.NYC_311_API_KEY;
  const c = new ContentClient({
    cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-offline-")),
    logger: () => {},
    apiKey: kind === "nokey" ? undefined : () => "k",
    minIntervalMs: 0,
    sleep: async () => {},
    fetch: async () => { if (kind === "nokey") assert.fail("no request without a key"); throw new TypeError("fetch failed"); },
  });
  return { c, restore: () => { if (saved !== undefined) process.env.NYC_311_API_KEY = saved; } };
}

for (const kind of ["nokey", "down"]) {
  test(`${kind}: "I smell gas" leads with the City's own gas line, built in`, async () => {
    const { c, restore } = await offline(kind);
    try {
      const out = await howToReport({ description: "Not urgent, but I smell gas" }, c);
      assert.equal(out.safety_line, SAFETY_LINE);
      assert.equal(out.first_line, "Call 911 to report a gas leak or any gas-related emergency or dangerous condition.");
      assert.equal(out.emergency.ka_number, "KA-02048");
      assert.deepEqual(out.emergency.dangers, ["a gas smell or leak"]);
      assert.match(out.emergency.source, /built into this server/);
      assert.match(out.content_unavailable, /could not be reached|NYC_311_API_KEY/);
      const { soda } = await fixtureSla();
      const { data } = await fixtureData();
      const d = await draftReport({ description: "I smell gas", location: "Broadway and W 96 St", borough: "Manhattan" }, c, soda, data);
      assert.equal(d.drafted, false);
      assert.equal(d.first_line, out.first_line);
      assert.match(d.not_drafted, /No 311 draft is made when the description suggests an emergency/);
    } finally {
      restore();
    }
  });
}

test("offline, a problem that is not an emergency still gets the plain missing-key error", async () => {
  const { c, restore } = await offline("nokey");
  try {
    await assert.rejects(howToReport({ description: "a pothole" }, c), (e) => e.message.startsWith(`${SAFETY_LINE} NYC_311_API_KEY`));
  } finally {
    restore();
  }
});

test("the built-in City lines are the City's own summaries, each starting 'Call 911'", () => {
  for (const a of BUILT_IN_911) {
    assert.match(a.ka_number, /^KA-\d{5}$/);
    assert.match(a.description, /^Call 911 /);
  }
  assert.ok(BUILT_IN_911.some((a) => a.title === "Gas Leak"));
});
