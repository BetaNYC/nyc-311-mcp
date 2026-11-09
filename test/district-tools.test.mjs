// The ten district tools (#14), against slices of the 2026-11-07 BoardStat build. No network.
// Numbers are checked against test/fixtures/boardstat/expected.json, which DuckDB computed
// over the same fixture files with scripts/boardstat_oracle.py (written from BoardStat's
// own page queries, not from this package's code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDistrictTool, resolveDistrict, shiftMonths, median, toolPeriod, priorWindow, nycLocal, DISTRICT_TOOLS } from "../dist/district-tools.js";
import { assertNoZipValues, districtEnvelope, redactZip } from "../dist/envelope.js";
import { BoardStatData } from "../dist/boardstat-data.js";
import { citySpellings, isPlaceholderAddress } from "../dist/address-spelling.js";
import { parseToolArgs } from "../dist/tools.js";
import { EXPECTED, MANIFEST, fixtureData, pick } from "./district-fixture.mjs";

async function run(name, args, opts) {
  const { data, requested } = await fixtureData(opts);
  const env = await runDistrictTool(name, parseToolArgs(name, args), data);
  return { env, data: env.data, requested };
}

// ── Numbers, against DuckDB ──────────────────────────────────────────────────

const CASES = [
  ["top_problems", { community_district: 484, from_date: "2021-01-01", limit: 10 }, "top_problems_all"],
  ["top_problems", { community_district: "484", fiscal_year: "FY26", limit: 5 }, "top_problems_fy2026"],
  ["agency_response", { community_district: 484, from_date: "2020-01-01", limit: 100 }, "agency_response_all"],
  ["still_open", { community_district: 484, limit: 5 }, "still_open_all"],
  ["top_addresses", { community_district: 484, from_date: "2020-01-01", limit: 5 }, "top_addresses_all"],
  ["problem_trend", { community_district: 484, problem: "noise - street/sidewalk", from_date: "2025-07-01" }, "problem_trend_noise"],
  ["district_summary", { community_district: 484, fiscal_year: 2027 }, "district_summary_fy2027"],
];

for (const [name, args, key] of CASES) {
  test(`${name} ${JSON.stringify(args)} matches DuckDB exactly (${key})`, async () => {
    const { data } = await run(name, args);
    const want = EXPECTED[key];
    assert.deepEqual(pick(data, want), want);
  });
}

test("address_history matches DuckDB for the busiest address in the fixture district", async () => {
  const want = EXPECTED.address_history_top;
  const { data } = await run("address_history", { address: want.address.toLowerCase(), borough: "Queens", limit: 5 });
  assert.equal(data.address, want.address);
  assert.equal(data.requests, want.requests);
  assert.deepEqual(pick(data.by_problem, want.by_problem), want.by_problem);
  assert.deepEqual(data.newest_first.map((r) => r.sr_number), want.newest_sr_numbers);
  assert.ok(data.newest_first.every((r) => "resolution" in r && "status" in r));
});

// ── Envelope, links, caveats ─────────────────────────────────────────────────

const DISTRICT_PAGE_PARAMS = new Set(["geo", "id", "start", "end", "type", "desc", "descx", "agency", "status"]);

test("every district answer carries the envelope, and its link uses only parameters BoardStat's page reads", async () => {
  const calls = [
    ["district_summary", { community_district: 484 }],
    ["top_problems", { council_district: 1, last_days: 30, agency: "nypd", status: "not_closed" }],
    ["problem_trend", { community_district: 484, problem: "Street Light Condition", fiscal_year: 2026 }],
    ["agency_response", { community_district: 484, problems: ["Street Light Condition"] }],
    ["still_open", { community_district: 484 }],
    ["top_addresses", { community_district: 484, problems: ["Illegal Parking"], from_date: "2020-01-01" }],
    ["boardstat_link", { community_district: 484, problems: ["illegal parking"], descriptions: ["blocked hydrant"], exclude_descriptions: true, status: "closed", fiscal_year: 2026 }],
  ];
  for (const [name, args] of calls) {
    const { env } = await run(name, args);
    assert.equal(env.data_as_of, MANIFEST.generated_at, name);
    assert.ok(env.caveats.length >= 4, name);
    assert.equal(env.source.dataset.id, "erm2-nwe9", name);
    const u = new URL(env.boardstat_url);
    assert.equal(u.origin + u.pathname, "https://www.beta.nyc/boardstat/district.html", name);
    for (const k of u.searchParams.keys()) assert.ok(DISTRICT_PAGE_PARAMS.has(k), `${name}: '${k}' is not a BoardStat page parameter`);
    const status = u.searchParams.get("status");
    if (status) assert.ok(["Closed", "not_closed"].includes(status), status);
  }
});

test("boardstat_link writes canonical names, the description exclusion, and BoardStat's status values", async () => {
  const { env } = await run("boardstat_link", {
    community_district: 484, problems: ["illegal parking"], descriptions: ["blocked hydrant"], exclude_descriptions: true, status: "closed", fiscal_year: 2026,
  });
  const p = Object.fromEntries(new URL(env.boardstat_url).searchParams);
  assert.deepEqual(p, { geo: "cd", id: "484", start: "2025-07-01", end: "2026-06-30", type: "Illegal Parking", desc: "Blocked Hydrant", descx: "1", status: "Closed" });
  const bare = await run("boardstat_link", { council_district: 1 });
  assert.equal(bare.env.boardstat_url, "https://www.beta.nyc/boardstat/district.html?geo=cc&id=1");
});

test("still_open links to BoardStat's 'Not yet closed' view and counts days open to the build time", async () => {
  const { env, data } = await run("still_open", { community_district: 484, limit: 2 });
  assert.equal(new URL(env.boardstat_url).searchParams.get("status"), "not_closed");
  assert.equal(data.oldest_first.length, 2);
  assert.equal(data.truncated, true);
  assert.ok(data.oldest_first[0].created <= data.oldest_first[1].created, "oldest first");
});

test("lists are capped by limit and say so", async () => {
  const { data } = await run("top_problems", { community_district: 484, from_date: "2020-01-01", limit: 3 });
  assert.equal(data.problems.length, 3);
  assert.equal(data.truncated, true);
  assert.ok(data.problem_count > 3);
});

test("a council district answer says BoardStat placed the requests and names the boundary release", async () => {
  const { env, data } = await run("top_problems", { council_district: 1, from_date: "2020-01-01" });
  assert.equal(data.district.kind, "council district");
  assert.match(env.caveats.join(" "), /BoardStat, by where they happened/);
  assert.match(env.caveats.join(" "), /26c/);
});

test("a Joint Interest Area is called one, not a community district", async () => {
  const { env, data } = await run("district_summary", { community_district: 484 });
  assert.equal(data.district.kind, "joint interest area");
  assert.match(env.caveats.join(" "), /Joint Interest Area/);
});

test("served from cache while BoardStat is unreachable: the answer says so in warning, stale and caveats", async () => {
  const { data } = await fixtureData({ manifestTtlMs: 1 });
  await runDistrictTool("district_summary", { community_district: 484 }, data);
  // A second process on the same cache folder, with the network gone and the TTL passed.
  const { BoardStatData } = await import("../dist/boardstat-data.js");
  const offline = new BoardStatData({
    dataUrl: data.dataUrl, cacheDir: data.cacheDir, manifestTtlMs: 1, logger: () => {},
    fetch: async () => { throw new TypeError("fetch failed"); },
  });
  await new Promise((r) => setTimeout(r, 5));
  const env = await runDistrictTool("district_summary", { community_district: 484 }, offline);
  assert.equal(env.stale, true);
  assert.match(env.warning, /Could not reach BoardStat/);
  assert.match(env.caveats.at(-1), /saved copy of the data/);
});

test("boardstat_status reports freshness and BoardStat's own late threshold", async () => {
  const { data } = await fixtureData();
  const { boardstatStatus } = await import("../dist/district-tools.js");
  const fresh = await boardstatStatus(data, Date.parse(MANIFEST.generated_at) + 3 * 3_600_000);
  assert.equal(fresh.data.hours_since_build, 3);
  assert.equal(fresh.data.nightly_run_late, false);
  assert.equal(fresh.data.requests.closed_before_created, MANIFEST.counts.closed_before_created);
  const late = await boardstatStatus(data, Date.parse(MANIFEST.generated_at) + 27 * 3_600_000);
  assert.equal(late.data.nightly_run_late, true);
});

// ── Districts and periods ────────────────────────────────────────────────────

test("resolveDistrict: one of the two, BoardStat's ids, plain errors", () => {
  assert.equal(resolveDistrict(MANIFEST, { community_district: 306 }).label, "Brooklyn CD 6");
  assert.equal(resolveDistrict(MANIFEST, { council_district: "4" }).label, "Council District 4");
  assert.throws(() => resolveDistrict(MANIFEST, {}), /exactly one/);
  assert.throws(() => resolveDistrict(MANIFEST, { community_district: 101, council_district: 1 }), /exactly one/);
  assert.throws(() => resolveDistrict(MANIFEST, { community_district: 6 }), /Brooklyn Community District 6 is 306/);
  assert.throws(() => resolveDistrict(MANIFEST, { council_district: 52 }), /1 to 51/);
  assert.throws(() => resolveDistrict(MANIFEST, { community_district: "MN01" }), /expected a number/);
});

test("periods: default is BoardStat's opening view; last_days ends on the newest request's day", () => {
  const view = toolPeriod({}, MANIFEST, "view");
  assert.equal(view.start, MANIFEST.window.default_start);
  assert.equal(view.end, MANIFEST.window.last_created.slice(0, 10));
  const all = toolPeriod({}, MANIFEST, "all");
  assert.equal(all.start, "2020-01-01");
  const l30 = toolPeriod({ last_days: 30 }, MANIFEST, "view");
  assert.deepEqual([l30.start, l30.end], ["2026-10-06", "2026-11-04"]);
  assert.match(l30.notes.join(" "), /not today/);
  assert.throws(() => toolPeriod({ last_days: 30, fiscal_year: 2027 }, MANIFEST, "view"), /on its own/);
  assert.throws(() => toolPeriod({ fiscal_year: 2027, from_date: "2026-08-01" }, MANIFEST, "view"), /not both/);
  const fy = toolPeriod({ fiscal_year: 2027 }, MANIFEST, "view");
  assert.match(fy.notes.join(" "), /fiscal year to date/);
});

test("shiftMonths clamps the day as DuckDB's INTERVAL does; median is DuckDB's", () => {
  assert.equal(shiftMonths("2024-02-29", -12), "2023-02-28");
  assert.equal(shiftMonths("2025-03-31", -1), "2025-02-28");
  assert.equal(shiftMonths("2026-11-04 02:05:23", -12), "2025-11-04 02:05:23");
  assert.equal(shiftMonths("2025-12-15", 1), "2026-01-15");
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("an unknown problem name is refused with close matches, and a description hint", async () => {
  await assert.rejects(run("problem_trend", { community_district: 484, problem: "blocked bike lane" }), /not one of BoardStat's problem names.*Blocked Bike Lane/s);
  await assert.rejects(run("top_addresses", { community_district: 484, problems: ["Illegal Parking"], descriptions: ["Nope"], from_date: "2020-01-01" }), /descriptions used are/);
  await assert.rejects(run("top_problems", { community_district: 484, agency: "XYZ", from_date: "2020-01-01" }), /Agencies here/);
});

// ── find_district and the City's spelling ─────────────────────────────────────

test("citySpellings: BoardStat's own rules, plus digits and words for numbered streets", () => {
  assert.deepEqual(citySpellings("350 Fifth Ave., New York, NY 10118").spellings, ["350 5 AVENUE", "350 FIFTH AVENUE", "350 FIFTH AVE"]);
  assert.deepEqual(citySpellings("10 W 42nd St").spellings.slice(0, 1), ["10 WEST 42 STREET"]);
  assert.equal(citySpellings("76 St Nicholas Pl").spellings[0], "76 ST NICHOLAS PLACE", "a leading ST (Saint) is kept");
  assert.deepEqual(citySpellings("1530 W 8th St").spellings.slice(0, 2), ["1530 WEST 8 STREET", "1530 WEST EIGHTH STREET"]);
  assert.equal(citySpellings("114 Nassau Ave").spellings[0], "114 NASSAU AVENUE");
  assert.equal(citySpellings("1 Avenue S").spellings[0], "1 AVENUE S", "a trailing S is a lettered avenue, not South");
  const z = citySpellings("114 Nassau Ave, Brooklyn, NY 11222");
  assert.equal(z.dropped_zip, true);
  assert.equal(z.ignored_text, "BROOKLYN, NY");
  assert.equal(z.borough_hint, "Brooklyn");
  assert.ok(!JSON.stringify(z).includes("11222"), "the ZIP code is not kept anywhere");
  assert.ok(isPlaceholderAddress("-999 RODNEY ST") && isPlaceholderAddress("*** WEB/MAP CALL SOURCE") && !isPlaceholderAddress("1 MAIN STREET"));
});

test("find_district: typed form to City spelling, every spelling and borough found, no ZIP in the answer", async () => {
  const { env, data } = await run("find_district", { address: "350 Fifth Ave. 10118" });
  assert.equal(data.found, true);
  assert.deepEqual(new Set(data.matches.map((m) => m.address)), new Set(["350 5 AVENUE", "350 FIFTH AVENUE"]));
  assert.deepEqual(new Set(data.matches.map((m) => m.borough)), new Set(["Manhattan", "Brooklyn"]));
  assert.match(data.message, /Give a borough/);
  assert.ok(!JSON.stringify(env).includes("10118"));
  assert.match(env.caveats.join(" "), /ZIP code was ignored/);
  // "New York, NY" as the city is Manhattan.
  const ny = await run("find_district", { address: "350 Fifth Ave., New York, NY 10118" });
  assert.deepEqual([...new Set(ny.data.matches.map((x) => x.borough))], ["Manhattan"]);
  assert.ok(!JSON.stringify(ny.env).includes("10118"));
  const m = await run("find_district", { address: "350 5th avenue", borough: "Manhattan" });
  assert.deepEqual(m.data.matches.map((x) => [x.address, x.community_district.id, x.council_district.id]), [["350 5 AVENUE", 105, 4], ["350 FIFTH AVENUE", 105, 4]]);
  assert.equal(m.env.boardstat_url, "https://www.beta.nyc/boardstat/district.html?geo=cd&id=105");
  const saint = await run("find_district", { address: "76 St. Nicholas Pl" });
  assert.equal(saint.data.matches[0].address, "76 ST NICHOLAS PLACE");
  const word = await run("find_district", { address: "1530 W 8th St" });
  assert.equal(word.data.matches[0].address, "1530 WEST EIGHTH STREET");
});

test("find_district: not found says so plainly and suggests the City's spelling", async () => {
  const { data } = await run("find_district", { address: "350 Fith Avenu" });
  assert.equal(data.found, false);
  assert.match(data.message, /No 311 request in BoardStat's data uses this address/);
  assert.ok(data.suggestions.some((s) => s.address === "350 5 AVENUE" || s.address === "350 FIFTH AVENUE"), JSON.stringify(data.suggestions));
});

test("address_history needs a borough when an address is in several places", async () => {
  await assert.rejects(run("address_history", { address: "350 5 Ave" }), /more than one borough.*Give a borough/s);
});

// ── Tool definitions ─────────────────────────────────────────────────────────

test("the ten district tools are advertised, strict, and say they are not the City's official report", () => {
  assert.deepEqual(DISTRICT_TOOLS.map((t) => t.name), [
    "find_district", "district_summary", "top_problems", "problem_trend", "agency_response",
    "still_open", "top_addresses", "address_history", "boardstat_link", "boardstat_status",
  ]);
  for (const t of DISTRICT_TOOLS) {
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(!/zip/i.test(JSON.stringify(t.inputSchema.properties)), `${t.name} mentions ZIP in its schema`);
    if (!["boardstat_link", "boardstat_status"].includes(t.name)) {
      assert.match(t.description, /not an official City report/, t.name);
      assert.match(t.description, /reports, not problems/, t.name);
    }
  }
});

test("only beta.nyc/boardstat/data is ever requested", async () => {
  const { data, requested } = await fixtureData();
  for (const [name, args] of [["district_summary", { community_district: 484 }], ["find_district", { address: "350 5 ave" }]]) {
    await runDistrictTool(name, parseToolArgs(name, args), data);
  }
  assert.ok(requested.length > 0);
  // fixtureData's fetch throws on any other host, so reaching here is the proof.
});

test("each district tool's advertised JSON schema names exactly the parameters its parser accepts", async () => {
  const { DISTRICT_ARG_SHAPES } = await import("../dist/district-tools.js");
  for (const t of DISTRICT_TOOLS) {
    assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), Object.keys(DISTRICT_ARG_SHAPES[t.name]).sort(), t.name);
  }
});

// ── QA round 1 on #20 ────────────────────────────────────────────────────────

test("citySpellings: city, borough, state and ZIP after the street are dropped without a comma, too", () => {
  for (const typed of ["350 5th Ave New York NY 10118", "350 5th Ave, New York, NY 10118", "350 5th Ave NYC", "350 5th Ave 10118 New York"]) {
    const sp = citySpellings(typed);
    assert.equal(sp.spellings[0], "350 5 AVENUE", typed);
    assert.ok(!JSON.stringify(sp).includes("10118"), `${typed}: ZIP kept`);
  }
  const man = citySpellings("350 5th Ave Manhattan");
  assert.equal(man.spellings[0], "350 5 AVENUE");
  assert.equal(man.borough_hint, "Manhattan");
  assert.equal(citySpellings("10001 4th Ave").spellings[0], "10001 4 AVENUE", "a five-digit house number is kept");
  assert.equal(citySpellings("79-01 Queens Blvd").spellings[0], "79-01 QUEENS BOULEVARD", "QUEENS inside the street name is kept");
  assert.equal(citySpellings("100 New York Ave Brooklyn").spellings[0], "100 NEW YORK AVENUE");
  assert.equal(citySpellings("1 Staten Island Blvd").spellings[0], "1 STATEN ISLAND BOULEVARD");
});

test("find_district: a borough named in the address narrows the match; 'New York NY 10118' no longer blocks it", async () => {
  const man = await run("find_district", { address: "350 5th Ave Manhattan" });
  assert.deepEqual([...new Set(man.data.matches.map((m) => m.borough))], ["Manhattan"]);
  assert.match(man.env.caveats.join(" "), /Only Manhattan was searched/);
  const full = await run("find_district", { address: "350 5th Ave New York NY 10118" });
  assert.equal(full.data.found, true);
  assert.ok(!JSON.stringify(full.env).includes("10118"));
  const house = await run("find_district", { address: "10001 4th Ave" });
  assert.equal(house.data.matches[0].address, "10001 4 AVENUE");
});

test("redactZip: ZIP codes in free text are removed; house numbers and other numbers are kept", () => {
  assert.equal(
    redactZip("Call 311 or visit 100 Gold St, New York, NY 10038. You can also"),
    "Call 311 or visit 100 Gold St, New York, NY [ZIP code removed]. You can also"
  );
  assert.equal(redactZip("NY 10010-1234"), "NY [ZIP code removed]");
  assert.equal(redactZip("730 11363"), "730 [ZIP code removed]", "a junk address whose street is a ZIP");
  assert.equal(redactZip("10001 4 AVENUE"), "10001 4 AVENUE");
  // Not followed by a street in capitals, so not a house number: treated as a ZIP code.
  assert.equal(redactZip("Building 12345 was inspected"), "Building [ZIP code removed] was inspected");
  assert.equal(redactZip("the ZIP code 10010 is wrong"), "the ZIP code [ZIP code removed] is wrong");
  assert.equal(redactZip("Brooklyn 11201 residents"), "Brooklyn [ZIP code removed] residents");
  assert.equal(redactZip("Zip: 11222 per caller"), "Zip: [ZIP code removed] per caller");
  assert.equal(redactZip("zip#10001"), "zip#[ZIP code removed]");
  assert.equal(redactZip("BROOKLYN 11201 RESIDENTS"), "BROOKLYN [ZIP code removed] RESIDENTS", "after a borough, even in capitals");
  // A house number that starts an address is kept, wherever the address sits in the text.
  assert.equal(redactZip("Found as 10001 4 AVENUE and 10001 FOURTH AVENUE."), "Found as 10001 4 AVENUE and 10001 FOURTH AVENUE.");
  assert.equal(redactZip("SR 311-12345678"), "SR 311-12345678");
  assert.equal(redactZip(null), null);
});

test("no answer can carry a ZIP code in a value either: the envelope refuses it", () => {
  assert.throws(
    () => districtEnvelope({ manifest: MANIFEST, siteUrl: "https://www.beta.nyc/boardstat/", data: { rows: [{ resolution: "visit 33 Beaver St, New York, NY 10010." }] } }),
    /ZIP code was about to be returned/
  );
  assert.throws(() => assertNoZipValues({ a: ["NY 11222"] }), /a\[0\]/);
  assert.doesNotThrow(() => assertNoZipValues({ address: "10001 4 AVENUE", when: "2026-11-04 02:05:23", n: 10001 }));
});

test("address_history: an address straddling a district line uses the district with the most requests and names the other", async () => {
  const want = EXPECTED.address_history_straddle;
  const { env, data } = await run("address_history", { address: "Greenwich St", borough: "Manhattan" });
  assert.equal(data.community_district.id, want.chosen.cd);
  assert.equal(data.requests, want.chosen.requests);
  const note = env.caveats.find((c) => /another district/.test(c));
  assert.ok(note, env.caveats.join("\n"));
  assert.match(note, new RegExp(`Manhattan CD 2 \\(${want.other.requests}\\)`));
  const other = await run("address_history", { address: "Greenwich St", borough: "Manhattan", community_district: 102 });
  assert.equal(other.data.community_district.id, 102);
  assert.equal(other.data.requests, want.other.requests);
  assert.deepEqual(other.data.newest_first.slice(0, 5).map((r) => r.sr_number), want.other.newest_sr_numbers);
  await assert.rejects(run("address_history", { address: "Greenwich St", community_district: 484 }), /not in Queens Joint Interest Area 484/);
});

test("one tool call reads one build, even when BoardStat publishes a new one mid-call", async () => {
  let manifestCalls = 0;
  const B = { ...MANIFEST, generated_at: "2026-11-08T10:36:39Z" };
  const { data: base } = await fixtureData();
  const fetch = async (url) => {
    const rel = String(url).slice("https://www.beta.nyc/boardstat/data/".length);
    if (rel === "manifest.json") return Response.json(++manifestCalls === 1 ? MANIFEST : B);
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { FIX } = await import("./district-fixture.mjs");
    return new Response(await readFile(path.join(FIX, ...rel.split("/"))));
  };
  // TTL 0: an unpinned client would ask for the manifest on every read and switch builds.
  const data = new BoardStatData({ dataUrl: base.dataUrl, cacheDir: base.cacheDir, fetch, logger: () => {}, manifestTtlMs: 0 });
  const env = await runDistrictTool("district_summary", { community_district: 484 }, data);
  assert.equal(env.data_as_of, MANIFEST.generated_at);
  assert.equal(manifestCalls, 1, "the call asked for the manifest more than once");
});

test("toolPeriod and the year-earlier window, with explicit dates", () => {
  const W = (o) => ({ ...MANIFEST, window: { ...MANIFEST.window, ...o } });
  const m = MANIFEST; // window 2020-01-01 .. newest request 2026-11-04 02:05:23
  // FY boundaries: July 1 to June 30.
  assert.deepEqual([toolPeriod({ fiscal_year: 2026 }, m, "view").start, toolPeriod({ fiscal_year: 2026 }, m, "view").end], ["2025-07-01", "2026-06-30"]);
  assert.deepEqual([toolPeriod({ fiscal_year: "FY21" }, m, "view").start, toolPeriod({ fiscal_year: "FY21" }, m, "view").end], ["2020-07-01", "2021-06-30"]);
  // FY2020 starts before the data: cut to 2020-01-01, with a note.
  const fy20 = toolPeriod({ fiscal_year: 2020 }, m, "view");
  assert.deepEqual([fy20.start, fy20.end], ["2020-01-01", "2020-06-30"]);
  assert.match(fy20.notes.join(" "), /data begins 2020-01-01/);
  // last_days across a month end and a leap day.
  const leap = W({ last_created: "2024-03-01 09:00:00", end: "2024-03-02" });
  assert.deepEqual([toolPeriod({ last_days: 2 }, leap, "view").start, toolPeriod({ last_days: 2 }, leap, "view").end], ["2024-02-29", "2024-03-01"]);
  assert.equal(toolPeriod({ last_days: 1 }, m, "view").start, "2026-11-04");
  // Year-earlier windows.
  const pw = (start, end, mm = m) => priorWindow({ start, end, label: "", notes: [] }, mm);
  const mid = pw("2024-03-01", "2024-03-31");
  assert.equal(mid.from.toISOString(), "2023-03-01T00:00:00.000Z");
  assert.equal(mid.toExclusive.toISOString(), "2023-04-01T00:00:00.000Z");
  assert.equal(mid.label, "2023-03-01 to 2023-03-31");
  const leapStart = pw("2024-02-29", "2024-02-29");
  assert.equal(leapStart.from.toISOString(), "2023-02-28T00:00:00.000Z", "Feb 29 a year back is Feb 28");
  assert.equal(leapStart.toExclusive.toISOString(), "2023-03-01T00:00:00.000Z");
  const toNewest = pw("2026-07-01", "2026-11-04");
  assert.equal(toNewest.from.toISOString(), "2025-07-01T00:00:00.000Z");
  assert.equal(toNewest.toInclusive.toISOString(), "2025-11-04T02:05:23.000Z", "stops at the newest request's minute, a year back");
  assert.match(pw("2020-06-01", "2020-06-30").none, /start before BoardStat's data/);
  assert.equal(pw("2021-01-01", "2021-01-31").label, "2020-01-01 to 2020-01-31");
});

test("nycLocal: the build time in New York local time, across daylight saving", () => {
  assert.equal(nycLocal("2026-11-07T10:36:39Z"), "2026-11-07 05:36:39", "EST, UTC-5");
  assert.equal(nycLocal("2026-07-01T10:00:00Z"), "2026-07-01 06:00:00", "EDT, UTC-4");
  assert.equal(nycLocal("2026-03-08T07:30:00Z"), "2026-03-08 03:30:00", "just after the spring change");
  assert.equal(nycLocal("2026-11-01T05:30:00Z"), "2026-11-01 01:30:00", "the repeated hour, first pass");
});

test("citySpellings: only a house number left is refused; 'New York' / 'NY, NY' as the city means Manhattan", async () => {
  assert.deepEqual(citySpellings("730 11363").spellings, []);
  await assert.rejects(run("find_district", { address: "730 11363" }), /only a house number/);
  await assert.rejects(run("address_history", { address: "730 11363" }), /only a house number/);
  assert.equal(citySpellings("1 Broadway New York").borough_hint, "Manhattan");
  assert.equal(citySpellings("1 Broadway, NY, NY").borough_hint, "Manhattan");
  assert.equal(citySpellings("350 5th Ave, Brooklyn, New York").borough_hint, "Brooklyn", "a named borough wins");
  assert.equal(citySpellings("1 Broadway NYC").borough_hint, null, "NYC is all five boroughs");
  assert.equal(citySpellings("1 Broadway New York City").borough_hint, null);
  assert.equal(citySpellings("1 Broadway, NY").borough_hint, null, "NY alone is the state");
});

test("a fiscal year cut to the data is labeled to date in every district answer (QA on #21)", async () => {
  const { data } = await run("top_problems", { council_district: 1, fiscal_year: 2027 });
  assert.equal(data.period.end, EXPECTED.last_day);
  assert.equal(data.period.label, `FY2027 to date (2026-07-01 to ${EXPECTED.last_day})`);
});
