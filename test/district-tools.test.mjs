// The ten district tools (#14), against slices of the 2026-11-07 BoardStat build. No network.
// Numbers are checked against test/fixtures/boardstat/expected.json, which DuckDB computed
// over the same fixture files with scripts/boardstat_oracle.py (written from BoardStat's
// own page queries, not from this package's code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { runDistrictTool, resolveDistrict, shiftMonths, median, toolPeriod, DISTRICT_TOOLS } from "../dist/district-tools.js";
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
  assert.equal(z.dropped_after_comma, "BROOKLYN, NY");
  assert.ok(!JSON.stringify(z).includes("11222"), "the ZIP code is not kept anywhere");
  assert.ok(isPlaceholderAddress("-999 RODNEY ST") && isPlaceholderAddress("*** WEB/MAP CALL SOURCE") && !isPlaceholderAddress("1 MAIN STREET"));
});

test("find_district: typed form to City spelling, every spelling and borough found, no ZIP in the answer", async () => {
  const { env, data } = await run("find_district", { address: "350 Fifth Ave., New York, NY 10118" });
  assert.equal(data.found, true);
  assert.deepEqual(new Set(data.matches.map((m) => m.address)), new Set(["350 5 AVENUE", "350 FIFTH AVENUE"]));
  assert.deepEqual(new Set(data.matches.map((m) => m.borough)), new Set(["Manhattan", "Brooklyn"]));
  assert.match(data.message, /Give a borough/);
  assert.ok(!JSON.stringify(env).includes("10118"));
  assert.match(env.caveats.join(" "), /ZIP code was ignored/);
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
  await assert.rejects(run("address_history", { address: "350 5 Ave" }), /more than one place.*Give a borough/s);
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
