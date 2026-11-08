import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertNoZip, boardstatUrl, CAVEATS, districtEnvelope } from "../dist/envelope.js";

const SITE = "https://www.beta.nyc/boardstat/";
const MANIFEST = JSON.parse(await readFile(new URL("./fixtures/boardstat/manifest.json", import.meta.url), "utf8"));

test("boardstatUrl uses the parameter names BoardStat's district page reads", () => {
  assert.equal(boardstatUrl(SITE), SITE);
  assert.equal(boardstatUrl(SITE, { geo: "cd", id: 101 }), `${SITE}district.html?geo=cd&id=101`);
  const u = new URL(
    boardstatUrl(SITE, {
      geo: "cc",
      id: 1,
      start: "2026-07-01",
      end: "2026-11-07",
      types: ["Noise - Residential", "Illegal Parking"],
      agency: "NYPD",
      status: "Open",
    })
  );
  assert.equal(u.pathname, "/boardstat/district.html");
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    geo: "cc",
    id: "1",
    start: "2026-07-01",
    end: "2026-11-07",
    type: "Noise - Residential|Illegal Parking",
    agency: "NYPD",
    status: "Open",
  });
});

test("districtEnvelope carries data_as_of, the link, the four caveats and the source", () => {
  const env = districtEnvelope({
    manifest: { manifest: MANIFEST, stale: false },
    siteUrl: SITE,
    link: { geo: "cd", id: 101, start: "2026-07-01", end: "2026-11-07" },
    data: { total: 3 },
    extraCaveats: ["FY2027 is not over: the data runs to 2026-11-07, so this is fiscal year to date."],
  });
  assert.equal(env.data_as_of, "2026-11-07T10:36:39Z");
  assert.equal(env.latest_request, "2026-11-04 02:05:23");
  assert.equal(env.boardstat_url, `${SITE}district.html?geo=cd&id=101&start=2026-07-01&end=2026-11-07`);
  assert.equal(env.caveats.length, CAVEATS.length + 1);
  assert.match(env.caveats.join(" "), /reports, not problems/);
  assert.match(env.caveats.join(" "), /does not mean the problem was fixed/);
  assert.match(env.caveats.join(" "), /2020-01-01/);
  assert.match(env.caveats.join(" "), /not yet been reviewed/);
  assert.equal(env.source.dataset.id, "erm2-nwe9");
  assert.equal(env.source.url, SITE);
  assert.equal(env.warning, undefined);
  assert.deepEqual(env.data, { total: 3 });
});

test("districtEnvelope passes a stale-cache warning through", () => {
  const env = districtEnvelope({
    manifest: { manifest: MANIFEST, stale: true, warning: "Could not reach BoardStat" },
    siteUrl: SITE,
    data: [],
  });
  assert.equal(env.warning, "Could not reach BoardStat");
});

test("no ZIP code can ride out in an answer, at any depth", () => {
  assert.throws(
    () => districtEnvelope({ manifest: MANIFEST, siteUrl: SITE, data: { rows: [{ address: "1 X ST", incident_zip: "10001" }] } }),
    /ZIP codes are not part of any answer/
  );
  assert.throws(() => assertNoZip({ a: [{ b: { Zip: 1 } }] }), /a\[0\]\.b/);
  assert.doesNotThrow(() => assertNoZip({ address: "1 ZIPPER LANE" }), "values are not keys");
});
