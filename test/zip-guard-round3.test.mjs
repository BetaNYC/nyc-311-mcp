// Beta retest 2 (2026-11-09): the FY2027 call-center report died with "A ZIP code was about
// to be returned", because our own timeout text said "within 30000 ms" and the ZIP guard read
// 30000 as a ZIP code. Two fixes, tested here:
//   1. A five-digit number followed by a unit (ms, seconds, requests, calls…), after a dollar
//      sign, or inside a decimal is a quantity, not a ZIP code.
//   2. A ZIP-looking number left in a finished answer is removed and the answer goes on. It
//      never throws away a whole report. Real ZIP codes in City text are still removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertNoZipValues, districtEnvelope, redactZip, scrubZipValues } from "../dist/envelope.js";

const MANIFEST = JSON.parse(await readFile(new URL("./fixtures/boardstat/manifest.json", import.meta.url), "utf8"));
const SITE = "https://www.beta.nyc/boardstat/";

test("quantities are not ZIP codes: milliseconds, seconds, request counts, years, dollars, SR numbers", () => {
  for (const s of [
    "NYC Open Data sent no answer within 30000 ms (/resource/wewp-mm3p.json).",
    "waited 30000ms",
    "took 45000 milliseconds",
    "timed out after 90000 seconds",
    "10001 requests in this district",
    "10001 service requests",
    "12345 calls",
    "54321 rows",
    "FY2027, 2026-10, 2020-01-01 to 2026-11-07",
    "$12345 awarded",
    "$ 54321.50",
    "a budget of 12345.67",
    "SR 311-12345678 and 311-12345",
    "about 10,001 calls",
  ]) {
    assert.equal(redactZip(s), s, s);
    assert.doesNotThrow(() => assertNoZipValues({ why: s }), s);
  }
});

test("a real ZIP code in an address or City text is still removed, even when a unit-like word follows", () => {
  assert.equal(redactZip("100 Gold St, New York, NY 99999"), "100 Gold St, New York, NY [ZIP code removed]");
  assert.equal(redactZip("visit 33 Beaver St, New York, NY 99998."), "visit 33 Beaver St, New York, NY [ZIP code removed].");
  // After a state, a borough or the word ZIP it is a ZIP code, whatever follows.
  assert.equal(redactZip("Brooklyn 99997 requests"), "Brooklyn [ZIP code removed] requests");
  assert.equal(redactZip("NY 99996 calls"), "NY [ZIP code removed] calls");
  assert.equal(redactZip("zip code 99995 s"), "zip code [ZIP code removed] s");
  // A bare five-digit number with no unit is still treated as a ZIP code (fail-safe).
  assert.equal(redactZip("730 99994"), "730 [ZIP code removed]");
  assert.throws(() => assertNoZipValues({ address: "730 99994" }), /ZIP code/);
});

test("a ZIP-looking number left in an answer is removed, and the answer still comes back", () => {
  const env = districtEnvelope({
    manifest: { manifest: MANIFEST, stale: false },
    siteUrl: SITE,
    data: {
      rows: [{ address: "1 X ST", resolution: "visit 33 Beaver St, New York, NY 99998." }],
      months_missing: [{ month: "2026-10", why: "NYC Open Data sent no answer within 30000 ms" }],
    },
  });
  assert.equal(env.data.rows[0].resolution, "visit 33 Beaver St, New York, NY [ZIP code removed].");
  assert.equal(env.data.months_missing[0].why, "NYC Open Data sent no answer within 30000 ms");
  assert.doesNotThrow(() => assertNoZipValues(env));
});

test("scrubZipValues walks every string at any depth and leaves numbers and keys alone", () => {
  const out = scrubZipValues({ a: [{ b: "NY 99993" }], n: 10001, when: "2026-11-04 02:05:23", house: "12345 4 AVENUE" });
  assert.deepEqual(out, { a: [{ b: "NY [ZIP code removed]" }], n: 10001, when: "2026-11-04 02:05:23", house: "12345 4 AVENUE" });
});
