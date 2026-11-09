// The three Local Law 47 of 2005 reports (#15). No network.
// BoardStat numbers are checked against test/fixtures/boardstat/expected-ll47.json, which DuckDB
// computed over the same fixture files with scripts/boardstat_oracle.py (written from the law's
// list and BoardStat's columns, not from src/ll47-reports.ts). The call-center report replays
// real responses from NYC Open Data (wewp-mm3p), recorded 2026-11-07 by
// scripts/run-call-center-report.mjs and trimmed to nine topics.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runLl47Tool,
  reportPeriods,
  lastCompleteMonth,
  parseMonth,
  toCsv,
  callSection,
  cbMonthlyList,
  directoryAssistanceReport,
  DA_REQUEST,
  DA_BUDGET_MS,
  DA_ANSWER_WAIT_MS,
  DA_CONCURRENT_MONTHS,
  STILL_LOADING,
  MANDATES,
  LL47_TOOLS,
} from "../dist/ll47-reports.js";
import { SodaClient, resolveAppToken, assertNoZipSoql } from "../dist/soda.js";
import { parseToolArgs } from "../dist/tools.js";
import { BASE, FIX, MANIFEST, fixtureData, pick } from "./district-fixture.mjs";

const EXPECTED = JSON.parse(await readFile(path.join(FIX, "expected-ll47.json"), "utf8"));
const SODA_FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "soda", "wewp-mm3p");

async function run(name, args, opts) {
  const { data, requested } = await fixtureData(opts);
  const env = await runLl47Tool(name, parseToolArgs(name, args), { data });
  return { env, data: env.data, requested };
}

/** A manifest whose community districts are cut to the two fixture files, so "every district file" is 101 + 484. */
const TWO_CD = { ...MANIFEST, districts: { ...MANIFEST.districts, cd: MANIFEST.districts.cd.filter((e) => [101, 484].includes(e.id)) } };
function serveManifest(manifest, log = []) {
  return async (url) => {
    const rel = String(url).slice(BASE.length);
    log.push(rel);
    if (rel === "manifest.json") return Response.json(manifest);
    const bytes = await readFile(path.join(FIX, ...rel.split("/"))).catch(() => null);
    return bytes ? new Response(bytes) : new Response("not found", { status: 404 });
  };
}

// ── ll47_service_request_report: numbers, against DuckDB ─────────────────────

const SR_CASES = [
  [{ community_district: 484, month: "2025-10" }, "sr_484_2025_10"],
  [{ community_district: "484", fiscal_year: "FY26" }, "sr_484_fy2026"],
  [{ council_district: 1, month: "2020-01" }, "sr_cc1_2020_01"],
];
for (const [args, key] of SR_CASES) {
  test(`ll47_service_request_report ${JSON.stringify(args)} matches DuckDB exactly (${key})`, async () => {
    const { data } = await run("ll47_service_request_report", args);
    const want = EXPECTED[key];
    assert.equal(data.complete, true);
    assert.deepEqual(pick(data, want), want);
  });
}

for (const [month, key] of [["2026-10", "sr_two_files_2026_10"], ["2026-11", "sr_two_files_2026_11"]]) {
  test(`citywide with read_every_district reads every community district file and matches DuckDB (${key})`, async () => {
    const requested = [];
    const { data } = await run(
      "ll47_service_request_report",
      { month, read_every_district: true, limit: 200 },
      { fetch: serveManifest(TWO_CD, requested) }
    );
    assert.deepEqual(pick(data, EXPECTED[key]), EXPECTED[key]);
    assert.equal(data.district_files_read, 2);
    assert.ok(requested.includes("detail/cd/101.parquet") && requested.includes("detail/cd/484.parquet"));
  });
}

test("citywide without read_every_district answers from the month file only, says it is incomplete, and how big the rest is", async () => {
  const { data, requested, env } = await run("ll47_service_request_report", { month: "2026-10" });
  const want = EXPECTED.agg_city_2026_10;
  assert.deepEqual(pick(data, want), want);
  assert.equal(data.complete, false);
  assert.equal(data.month.by_agency, null);
  assert.equal(data.month.resolution_time_by_category_and_agency, null);
  assert.match(data.how_to_get_the_rest, /read_every_district: true/);
  assert.match(data.how_to_get_the_rest, /71 files, about \d+ MB/);
  assert.ok(!requested.some((f) => f.startsWith("detail/")), `downloaded district files: ${requested}`);
  assert.ok(env.caveats.some((c) => /grouped problem names/.test(c)));
});

test("one borough from the month file matches DuckDB", async () => {
  const { data } = await run("ll47_service_request_report", { month: "2026-10", borough: "Queens" });
  assert.deepEqual(pick(data, EXPECTED.agg_queens_2026_10), EXPECTED.agg_queens_2026_10);
  assert.equal(data.geography.label, "Queens");
});

test("by_district lists every district from the month file, honors borough and limit, and says when it cut the list", async () => {
  const { data } = await run("ll47_service_request_report", { by_district: "borough", month: "2026-10" });
  const queens = data.districts.find((r) => r.id === "Queens");
  assert.equal(queens.requests_month, EXPECTED.agg_queens_2026_10.month.requests);
  assert.equal(data.district_count, 5);
  const cds = await run("ll47_service_request_report", { by_district: "community_district", borough: "Queens", month: "2026-10", limit: 3 });
  assert.equal(cds.data.districts.length, 3);
  assert.equal(cds.data.truncated, true);
  // Said in words too, and in the caveats (beta test 2026-11-08).
  assert.match(cds.data.truncation_note, /^Showing 3 of \d+ (community districts|areas \(\d+ community districts and \d+ Joint Interest Areas?\)), because limit is 3: with by_district, limit counts rows/);
  // Brooklyn: 18 community districts and 2 Joint Interest Areas, said so (beta retest 1).
  const bk = await run("ll47_service_request_report", { by_district: "community_district", borough: "Brooklyn", month: "2026-10", limit: 5 });
  assert.equal(bk.data.truncation_note, "Showing 5 of 20 areas (18 community districts and 2 Joint Interest Areas), because limit is 5: with by_district, limit counts rows of this table. Give limit 20 to see every one.");
  const cc = await run("ll47_service_request_report", { by_district: "council_district", month: "2026-10", limit: 2 });
  assert.match(cc.data.truncation_note, /^Showing 2 of 51 Council districts, because limit is 2/);
  assert.ok(cds.env.caveats.includes(cds.data.truncation_note));
  assert.ok(cds.data.districts.every((r) => r.borough === "Queens"));
  const all = await run("ll47_service_request_report", { by_district: "community_district", month: "2026-10", limit: 100 });
  assert.equal(all.data.district_count, MANIFEST.districts.cd.length);
  assert.equal(all.data.truncation_note, undefined);
  const r484 = all.data.districts.find((r) => r.id === 484);
  assert.equal(r484.requests_month, EXPECTED.sr_two_files_2026_10.month.requests, "cd 484 is the only fixture district with October rows");
});

test("with no month, the report is for the newest complete month, and says so", async () => {
  const { data, env } = await run("ll47_service_request_report", { community_district: 484 });
  assert.ok(env.caveats.some((c) => /closed before they were created, or with a close date in the future, are left out/.test(c)));
  assert.equal(data.month.start, "2026-10-01");
  assert.equal(data.fiscal_year.label, "FY2027 to date (2026-07-01 to 2026-10-31)");
  assert.ok(env.caveats.some((c) => /newest complete month in the data, 2026-10/.test(c)));
});

test("a month or fiscal year that starts before 2020 is cut to the data, with a note", async () => {
  const { data, env } = await run("ll47_service_request_report", { council_district: 1, month: "2020-01" });
  assert.equal(data.fiscal_year.start, "2020-01-01");
  assert.ok(env.caveats.some((c) => /data begins 2020-01-01/.test(c)), env.caveats.join("\n"));
});

test("bad and conflicting periods and geographies are refused", async () => {
  const bad = [
    [{ month: "2026-10", fiscal_year: 2027 }, /not both/],
    [{ month: "2026-13" }, /Invalid month/],
    [{ month: "2019-12" }, /before the data begins/],
    [{ month: "2026-10", community_district: 101, borough: "Queens" }, /at most one/],
    [{ by_district: "borough", community_district: 101 }, /cannot be combined/],
  ];
  for (const [args, re] of bad) {
    const { data } = await fixtureData();
    await assert.rejects(runLl47Tool("ll47_service_request_report", parseToolArgs("ll47_service_request_report", args), { data }), re, JSON.stringify(args));
  }
});

// ── The mandate block, the envelope, ZIP codes ───────────────────────────────

test("every report carries the Phase 0 envelope and a mandate block naming the section, its status and what is left out", async () => {
  const sodaC = await fixtureSoda();
  const sr = (await run("ll47_service_request_report", { community_district: 484, month: "2025-10" })).env;
  const cb = (await run("cb_monthly_list", { community_district: 484, month: "2025-10" })).env;
  const da = await runLl47Tool("ll47_directory_assistance_report", { month: "2026-10" }, { soda: sodaC.soda });
  for (const [env, section, status] of [
    [sr, "§ 1075(b)", "repealed"],
    [da, "§ 1075(c)", "repealed"],
    [cb, "§ 1075(d)", "current"],
  ]) {
    for (const k of ["data_as_of", "latest_request", "boardstat_url", "caveats", "source", "data"]) assert.ok(k in env, `${section}: no ${k}`);
    assert.ok(env.mandate.charter_section.includes(section));
    assert.equal(env.mandate.status, status);
    assert.equal(env.mandate.note, "This is a BetaNYC rebuild from NYC Open Data, not the City's official report. Only the City can meet § 1075.");
    assert.ok(env.mandate.omissions.some((o) => /ZIP code breakdown: omitted by BetaNYC's decision/.test(o) && /postal delivery areas, not City districts/.test(o)));
    assert.ok(env.mandate.omissions.some((o) => /before 2020-01-01/.test(o) && /April 1, 2004/.test(o)));
    if (status === "repealed") assert.match(env.mandate.repealed_by, /Local Law 69 of 2023/);
    else assert.equal(env.mandate.repealed_by, undefined);
    assert.match(env.mandate.law, /Local Law 47 of 2005/);
    const text = JSON.stringify(env);
    assert.ok(!/"[^"]*zip[^"]*":/i.test(text), `${section}: a key names a ZIP code`);
  }
});

test("tool descriptions say plainly that these are BetaNYC rebuilds, not the City's official reports", () => {
  for (const t of LL47_TOOLS) {
    assert.match(t.description, /not the City's official report/);
    assert.match(t.description, /ZIP codes/);
    assert.equal(t.inputSchema.additionalProperties, false);
  }
  assert.equal(MANDATES.cb_list.status, "current");
});

// ── cb_monthly_list (§ 1075(d)) ──────────────────────────────────────────────

for (const [cd, month, key] of [[484, "2025-10", "cb_484_2025_10"], [101, "2026-11", "cb_101_2026_11"]]) {
  test(`cb_monthly_list ${cd} ${month}: the month's requests, then every older unresolved one, in DuckDB's order (${key})`, async () => {
    const want = EXPECTED[key];
    const { data } = await run("cb_monthly_list", { community_district: cd, month, limit: 1000 });
    assert.equal(data.counts.new_this_month, want.new_this_month.length);
    assert.equal(data.counts.unresolved_from_prior_months, want.unresolved_from_prior_months.length);
    assert.equal(data.counts.unresolved_at_month_end_now_closed, want.unresolved_at_month_end_now_closed.length);
    assert.deepEqual(data.record_problems, want.record_problems);
    assert.deepEqual(data.rows.map((r) => r.unique_key), [
      ...want.new_this_month,
      ...want.unresolved_from_prior_months,
      ...want.unresolved_at_month_end_now_closed,
    ]);
    const monthEnd = `${month}-${month === "2025-10" ? "31" : "04"}`;
    for (const r of data.rows.filter((x) => x.section === "unresolved_at_month_end_now_closed")) {
      assert.equal(r.status, "Closed");
      assert.ok(r.closed > `${monthEnd} 23:59:59` && r.created < `${month}-01`, JSON.stringify(r));
    }
    for (const r of data.rows) {
      assert.deepEqual(Object.keys(r), data.columns);
      assert.ok(r.category && r.agency && r.created, JSON.stringify(r));
    }
    assert.ok(data.rows.filter((r) => r.section === "unresolved_from_prior_months").every((r) => r.status !== "Closed"));
  });
}

test("cb_monthly_list pages with offset and limit, and next_offset walks the whole list once", async () => {
  const want = EXPECTED.cb_484_2025_10;
  const all = [...want.new_this_month, ...want.unresolved_from_prior_months, ...want.unresolved_at_month_end_now_closed];
  const { data: fd } = await fixtureData();
  const seen = [];
  let page = { offset: 0 };
  for (let i = 0; i < 50 && page !== null; i++) {
    const env = await runLl47Tool("cb_monthly_list", parseToolArgs("cb_monthly_list", { community_district: 484, month: "2025-10", limit: 25, ...page }), { data: fd });
    seen.push(...env.data.rows.map((r) => r.unique_key));
    assert.equal(env.data.next_offset, env.data.next_page?.offset ?? null);
    page = env.data.next_page;
    if (page) assert.equal(page.data_as_of, MANIFEST.generated_at);
  }
  assert.deepEqual(seen, all);
});

test("cb_monthly_list refuses a next page from a different build, so a list is never stitched from two", async () => {
  const { data } = await fixtureData();
  await assert.rejects(
    runLl47Tool("cb_monthly_list", parseToolArgs("cb_monthly_list", { community_district: 484, month: "2025-10", offset: 25, data_as_of: "2026-11-06T10:00:00Z" }), { data }),
    /published new data since the first page.*Start again at offset 0/
  );
});

test("cb_monthly_list for an older month says plainly that 'unresolved' is as of the build, not the month's end", async () => {
  const old = await run("cb_monthly_list", { community_district: 484, month: "2025-10" });
  assert.equal(old.data.status_as_of, MANIFEST.generated_at);
  assert.match(old.data.status_note, /not closed when this data was built .* not at the end of 2025-10/);
  assert.match(old.data.status_note, /A § 1075\(d\) list sent at the month's end would show the status as of then/);
  assert.ok(old.env.caveats.some((c) => c === old.data.status_note));
  const newest = await run("cb_monthly_list", { community_district: 484 });
  assert.equal(newest.data.month.start, "2026-10-01");
  assert.equal(newest.data.status_note, undefined);
  assert.ok(newest.env.caveats.some((c) => /current status, as of when this data was built/.test(c)));
});

test("cb_monthly_list part= keeps one half; format csv gives the same page as CSV text", async () => {
  const want = EXPECTED.cb_484_2025_10;
  const fresh = await run("cb_monthly_list", { community_district: 484, month: "2025-10", part: "new_this_month" });
  assert.deepEqual(fresh.data.rows.map((r) => r.unique_key), want.new_this_month);
  assert.equal(fresh.data.counts.unresolved_from_prior_months, null);
  const old = await run("cb_monthly_list", { community_district: 484, month: "2025-10", part: "unresolved_from_prior_months", limit: 5 });
  assert.deepEqual(old.data.rows.map((r) => r.unique_key), want.unresolved_from_prior_months.slice(0, 5));
  const since = await run("cb_monthly_list", { community_district: 484, month: "2025-10", part: "unresolved_at_month_end_now_closed" });
  assert.deepEqual(since.data.rows.map((r) => r.unique_key), want.unresolved_at_month_end_now_closed);
  assert.equal(since.data.counts.new_this_month, null);
  const csv = await run("cb_monthly_list", { community_district: 484, month: "2025-10", format: "csv", limit: 5 });
  assert.equal(csv.data.rows, undefined);
  const lines = csv.data.csv.trimEnd().split("\r\n");
  assert.equal(lines[0], csv.data.columns.join(","));
  assert.equal(lines.length, 6);
  assert.ok(lines[1].includes(want.new_this_month[0]));
  assert.ok(csv.env.caveats.some((c) => /Joint Interest Area has no community board/.test(c)));
});

test("cb_monthly_list removes ZIP codes from descriptions and addresses (free text)", async () => {
  const created = new Date("2026-10-05T10:00:00Z");
  const reader = {
    siteUrl: "https://www.beta.nyc/boardstat/",
    manifest: async () => ({ manifest: MANIFEST, stale: false }),
    readParquet: async (_file, opts) => ({
      manifest: { manifest: MANIFEST, stale: false },
      rows: opts.filter?.is_closed
        ? []
        : [
            {
              unique_key: "1",
              created_date: created,
              complaint_type_raw: "Noise",
              descriptor: "Reported at 100 Main St, New York, NY 10010",
              agency: "NYPD",
              agency_name: "New York City Police Department",
              status: "Open",
              incident_address: "730 11363",
            },
          ],
    }),
  };
  const env = await cbMonthlyList(reader, { community_district: 101, month: "2026-10" });
  const r = env.data.rows[0];
  assert.ok(!/10010/.test(r.description), r.description);
  assert.ok(!/11363/.test(r.address), r.address);
  assert.match(r.description, /ZIP code removed/);
});

test("toCsv quotes commas, quotes and line breaks, and leaves blanks empty", () => {
  const out = toCsv(["a", "b"], [{ a: 'x, "y"', b: null }, { a: "line\nbreak", b: "z" }]);
  assert.equal(out, 'a,b\r\n"x, ""y""",\r\n"line\nbreak",z\r\n');
});

// ── Periods ──────────────────────────────────────────────────────────────────

test("reportPeriods: a month and its fiscal year to date; a fiscal year; the newest complete month", () => {
  const w = { start: "2020-01-01", end: "2026-11-04" };
  const p = reportPeriods({ month: "2026-10" }, w, "2026-10");
  assert.deepEqual([p.month.start, p.month.end, p.fiscal_year.start, p.fiscal_year.end], ["2026-10-01", "2026-10-31", "2026-07-01", "2026-10-31"]);
  assert.equal(p.fiscal_year.fiscal_year, 2027);
  const j = reportPeriods({ month: "2027-01" }, { start: "2020-01-01", end: "2027-02-10" }, "x");
  assert.equal(j.fiscal_year.start, "2026-07-01");
  const fy = reportPeriods({ fiscal_year: 2027 }, w, "x");
  assert.equal(fy.month, null);
  assert.equal(fy.fiscal_year.end, "2026-11-04");
  const part = reportPeriods({ month: "2026-11" }, w, "x");
  assert.equal(part.month.end, "2026-11-04");
  assert.ok(part.notes.some((n) => /not complete/.test(n)));
  assert.equal(lastCompleteMonth("2026-11-04"), "2026-10");
  assert.equal(lastCompleteMonth("2026-10-31"), "2026-10");
  assert.equal(lastCompleteMonth("2026-01-15"), "2025-12");
  assert.equal(parseMonth(" 2026-03 "), "2026-03");
  assert.throws(() => parseMonth("2026-3"), /YYYY-MM/);
});

// ── ll47_directory_assistance_report (wewp-mm3p, recorded responses) ─────────

async function fixtureSoda({ token, respond, cost = 0, cacheDir, rowsUpdatedAt } = {}) {
  const requests = [];
  const sleeps = [];
  let clock = Date.parse("2026-11-07T12:00:00Z");
  const fetch = async (url, init) => {
    const u = new URL(url);
    requests.push({ url: u, headers: init.headers, at: clock });
    clock += cost;
    if (rowsUpdatedAt && u.pathname === "/api/views/wewp-mm3p.json") {
      const v = JSON.parse(await readFile(path.join(SODA_FIX, "view.json"), "utf8"));
      return Response.json({ ...v, rowsUpdatedAt });
    }
    if (respond) {
      const r = await respond(u, requests.length, init);
      if (r) return r;
    }
    if (u.pathname === "/api/views/wewp-mm3p.json") return new Response(await readFile(path.join(SODA_FIX, "view.json")));
    if (u.pathname === "/resource/wewp-mm3p.json") {
      const m = /date >= '(\d{4}-\d{2})-01T00:00:00' AND date < '(\d{4}-\d{2})-01T00:00:00'/.exec(u.searchParams.get("$where"));
      if (!m) return new Response("bad where", { status: 400 });
      if (u.searchParams.get("$offset") !== "0") return Response.json([]);
      const body = await readFile(path.join(SODA_FIX, `${m[1]}.json`)).catch(() => null);
      return body ? new Response(body) : Response.json([]);
    }
    return new Response("not found", { status: 404 });
  };
  const soda = new SodaClient({
    fetch,
    token,
    logger: () => {},
    cacheDir: cacheDir ?? (await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-test-"))),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { soda, requests, sleeps };
}

const NOW = Date.parse("2026-11-07T12:00:00Z");
const monthSum = async (ym, pred = () => true) =>
  JSON.parse(await readFile(path.join(SODA_FIX, `${ym}.json`), "utf8")).filter(pred).reduce((a, r) => a + Number(r.n), 0);

test("ll47_directory_assistance_report adds up the recorded months, by topic, and marks itself limited", async () => {
  const { soda } = await fixtureSoda();
  // A one-month call fetches only its month; the fiscal year to date adds the saved ones.
  for (const ym of ["2026-07", "2026-08", "2026-09"]) await runLl47Tool("ll47_directory_assistance_report", { month: ym }, { soda });
  const env = await runLl47Tool("ll47_directory_assistance_report", parseToolArgs("ll47_directory_assistance_report", { month: "2026-10" }), { soda });
  const d = env.data;
  assert.equal(d.month.calls, await monthSum("2026-10"));
  let fy = 0;
  for (const ym of ["2026-07", "2026-08", "2026-09", "2026-10"]) fy += await monthSum(ym);
  assert.equal(d.fiscal_year.calls, fy);
  assert.equal(d.month.directory_assistance_topic_calls, await monthSum("2026-10", (r) => r.inquiry_name === "Directory Assistance"));
  assert.equal(d.month.directory_assistance_topic_calls, 2333, "the City's dashboard shows 2,333 for October FY2027");
  assert.equal(d.month.by_category[0].category, "Heat or Hot Water Complaint in a Residential Building");
  assert.equal(d.month.by_category[0].calls, 7959);
  // The recorded rows have no agency or call_resolution (Socrata omits nulls): say so, invent nothing.
  assert.equal(d.month.by_agency, null);
  assert.equal(d.month.calls_with_blank_agency, d.month.calls);
  assert.equal(d.month.by_call_resolution, null);
  assert.equal(d.limited, true);
  assert.ok(d.limited_because.some((r) => /agency column is blank/.test(r)));
  assert.ok(d.limited_because.some((r) => /directory assistance category/.test(r)));
  assert.equal(env.boardstat_url, null);
  assert.equal(env.source.dataset.id, "wewp-mm3p");
  assert.equal(env.mandate.status, "repealed");
});

test("the call-center report asks one $group query per month, politely, and serves repeats from the cache", async () => {
  const { soda, requests, sleeps } = await fixtureSoda({ token: "tok123" });
  await runLl47Tool("ll47_directory_assistance_report", { month: "2026-10" }, { soda });
  const data = requests.filter((r) => r.url.pathname.startsWith("/resource/"));
  assert.equal(requests.length, 2, "metadata + the asked month only");
  assert.equal(data.length, 1);
  for (const r of data) {
    const p = r.url.searchParams;
    assert.match(p.get("$select"), /count\(\*\) AS n/);
    assert.ok(p.get("$group") && p.get("$order") && p.get("$limit") && p.get("$offset"));
    assert.ok(![...p.values()].some((v) => /zip/i.test(v)));
  }
  for (const r of requests) {
    assert.equal(r.headers["X-App-Token"], "tok123");
    assert.match(r.headers["User-Agent"], /nyc-311-mcp/);
  }
  for (let i = 1; i < requests.length; i++) assert.ok(requests[i].at - requests[i - 1].at >= 2000, "at least 2 s between requests");
  assert.ok(sleeps.length >= 1);
  const again = await runLl47Tool("ll47_directory_assistance_report", { month: "2026-10" }, { soda });
  assert.equal(requests.length, 2, "the second answer asked nothing new");
  assert.equal(again.data.months_from_cache, 1);
});

test("the call-center client honors Retry-After on 429, widens the gap, and does not retry a 400", async () => {
  let n = 0;
  const { soda, sleeps } = await fixtureSoda({
    respond: async (u) => (u.pathname.startsWith("/api/views/") && n++ === 0 ? new Response("slow down", { status: 429, headers: { "Retry-After": "7" } }) : null),
  });
  await soda.metadata("wewp-mm3p");
  assert.ok(sleeps.includes(7000), `slept ${sleeps}`);
  const bad = await fixtureSoda({ respond: async () => new Response("no", { status: 400 }) });
  await assert.rejects(bad.soda.getJson("/resource/wewp-mm3p.json", { $limit: "1" }), /HTTP 400/);
  assert.equal(bad.requests.length, 1);
});

test("SOCRATA_APP_TOKEN is optional but must not be blank; no query may name a ZIP code", () => {
  assert.equal(resolveAppToken({}), undefined);
  assert.equal(resolveAppToken({ SOCRATA_APP_TOKEN: "abc" }), "abc");
  assert.throws(() => resolveAppToken({ SOCRATA_APP_TOKEN: " " }), /empty or contains spaces/);
  assert.throws(() => assertNoZipSoql({ $select: "incident_zip, count(*)" }), /ZIP/);
});

test("with no month, the call-center report is for the newest complete month (New York time)", async () => {
  const { soda } = await fixtureSoda();
  const env = await directoryAssistanceReport({}, soda, NOW);
  assert.equal(env.data.month.start, "2026-10-01");
});

test("callSection reports agencies and call resolutions when the dataset has them", () => {
  const s = callSection(
    [
      { inquiry_name: "A", agency: "DOF", agency_name: "Department of Finance", call_resolution: "Information Provided", n: 3 },
      { inquiry_name: "A", agency: null, agency_name: null, call_resolution: null, n: 1 },
      { inquiry_name: "B", agency: "HPD", agency_name: null, call_resolution: "CSMS SR", n: 2 },
    ],
    10
  );
  assert.equal(s.calls, 6);
  assert.deepEqual(s.by_agency.map((a) => [a.agency, a.calls]), [["DOF", 3], ["HPD", 2], ["(blank)", 1]]);
  assert.equal(s.calls_with_blank_agency, 1);
  assert.deepEqual(s.by_call_resolution.map((r) => r.call_resolution), ["Information Provided", "CSMS SR", "(blank)"]);
});

// ── The call-center report when NYC Open Data is slow, down, or has changed (QA on #21) ──

const daArgs = (a) => parseToolArgs("ll47_directory_assistance_report", a);
/** Saves the given months in `dir`, one one-month call each. */
async function warmMonths(dir, months) {
  for (const ym of months) await directoryAssistanceReport(daArgs({ month: ym }), (await fixtureSoda({ cacheDir: dir })).soda, NOW);
}
const FY27_TO_OCT = ["2026-07", "2026-08", "2026-09", "2026-10"];

test("when NYC Open Data is down, a warm cache answers, marked stale with a warning", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-down-"));
  await warmMonths(dir, FY27_TO_OCT);
  const first = await directoryAssistanceReport(daArgs({ month: "2026-10" }), (await fixtureSoda({ cacheDir: dir })).soda, NOW);
  assert.equal(first.data.fiscal_year.complete, true);
  // A new client, as after a restart: nothing in memory, the portal unreachable.
  const down = await fixtureSoda({ cacheDir: dir, respond: async () => { throw new TypeError("fetch failed"); } });
  const env = await directoryAssistanceReport(daArgs({ month: "2026-10" }), down.soda, NOW);
  assert.equal(env.stale, true);
  assert.match(env.warning, /could not be reached/);
  assert.ok(env.caveats.some((c) => /could not be reached just now/.test(c)));
  assert.equal(env.data.month.calls, first.data.month.calls);
  assert.equal(env.data.fiscal_year.calls, first.data.fiscal_year.calls);
  assert.equal(env.data.months_queried, 0);
});

test("when NYC Open Data is down and nothing is saved, it says so instead of answering", async () => {
  const down = await fixtureSoda({ respond: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(directoryAssistanceReport(daArgs({ month: "2026-10" }), down.soda, NOW), /fetch failed|NYC Open Data/);
});

test("settled months are not asked again when the dataset's nightly version changes; recent months are", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-settled-"));
  await warmMonths(dir, FY27_TO_OCT);
  const next = await fixtureSoda({ cacheDir: dir, rowsUpdatedAt: 1794200000 });
  const env = await directoryAssistanceReport(daArgs({ month: "2026-10" }), next.soda, NOW);
  const asked = next.requests.filter((r) => r.url.pathname.startsWith("/resource/")).map((r) => /'(\d{4}-\d{2})-01/.exec(r.url.searchParams.get("$where"))[1]);
  assert.deepEqual(asked, ["2026-10"], "July to September ended over a week ago and are kept; October is re-asked");
  assert.equal(env.data.months_queried, 1);
  assert.equal(env.data.months_from_cache, 3);
});

test("a fiscal-year call against a quick portal finishes in one call, and the month call after it uses the saved months", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-budget-"));
  const quick = await fixtureSoda({ cacheDir: dir, cost: 3_000 });
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), quick.soda, NOW);
  assert.equal(env.data.fiscal_year.complete, true, JSON.stringify(env.data.fiscal_year.months_missing));
  let fy = 0;
  for (const ym of ["2026-07", "2026-08", "2026-09", "2026-10"]) fy += await monthSum(ym);
  assert.equal(env.data.fiscal_year.calls, fy, "November has no recorded calls in the fixture");
  const third = await directoryAssistanceReport(daArgs({ month: "2026-10" }), (await fixtureSoda({ cacheDir: dir })).soda, NOW);
  assert.equal(third.data.month.calls, await monthSum("2026-10"));
  assert.equal(third.data.fiscal_year.complete, true);
  assert.equal(third.data.fiscal_year.calls, fy);
});

test("the Socrata client's deadline bounds retries and waits", async () => {
  const { soda, requests } = await fixtureSoda({ respond: async () => new Response("busy", { status: 503 }), cost: 10_000 });
  await assert.rejects(soda.getJson("/resource/wewp-mm3p.json", { $limit: "1" }, { deadline: soda.clock() + 15_000 }), /Ran out of time/);
  assert.ok(requests.length <= 2, `${requests.length} requests`);
});

test("cb_monthly_list counts inconsistent City records and says so in a caveat (QA round 2 on #21)", async () => {
  const created = new Date("2025-01-05T10:00:00Z");
  const rows = {
    open: [{ unique_key: "a", created_date: created, closed_date: new Date("2025-02-01T00:00:00Z"), status: "Open", agency: "NYPD", complaint_type_raw: "Noise" }],
    closedNoDate: [{ created_date: created, closed_date: null, is_closed: true }, { created_date: created, closed_date: null, is_closed: true }],
  };
  const reader = {
    siteUrl: "https://www.beta.nyc/boardstat/",
    manifest: async () => ({ manifest: MANIFEST, stale: false }),
    readParquet: async (_f, opts) => ({
      manifest: { manifest: MANIFEST, stale: false },
      rows:
        opts.filter.is_closed?.$eq === false ? rows.open
        : opts.filter.is_closed?.$eq === true && !opts.filter.closed_date ? rows.closedNoDate
        : [],
    }),
  };
  const env = await cbMonthlyList(reader, { community_district: 101, month: "2025-10" });
  assert.deepEqual(env.data.record_problems, { closed_without_close_date: 2, not_closed_but_close_date_before_month_end: 1 });
  assert.ok(env.caveats.some((c) => /^2 requests created before 2025-10 are marked Closed but have no close date/.test(c)));
  assert.ok(env.caveats.some((c) => /City records are inconsistent for 1 requests/.test(c)));
});

test("Open Data failing on the asked month: stop there, no fiscal-year months, a plain message (beta test 2026-11-08)", async () => {
  const { soda, requests } = await fixtureSoda({
    respond: async (u) => (u.pathname === "/resource/wewp-mm3p.json" ? new Response("Service Unavailable", { status: 503 }) : null),
    cost: 1_000,
  });
  const t0 = soda.clock();
  await assert.rejects(
    directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW),
    (e) => /NYC Open Data is not responding right now/.test(e.message) && /Try again later/.test(e.message) && !/Gave up on|Service Unavailable/.test(e.message)
  );
  const months = new Set(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").map((r) => /date >= '(\d{4}-\d{2})/.exec(r.url.searchParams.get("$where"))[1]));
  assert.deepEqual([...months], ["2026-10"], "only the asked month was tried");
  assert.ok(soda.clock() - t0 < 45_000, `${soda.clock() - t0} ms`);
});

// Beta retest 1 (2026-11-08): October still took the full 45 s when NYC Open Data answered
// 503 slowly, and ended on "this call ran out of time". Now: few tries, a plain sentence
// that NYC Open Data is not responding, and a pointer to trying later or a fiscal year.
const OUTAGE = (e) =>
  /NYC Open Data is not responding right now/.test(e.message) &&
  /Try again later, or ask for the fiscal year/.test(e.message) &&
  !/Gave up on|Service Unavailable|Ran out of time|HTTP 503/.test(e.message);

test("slow 503s from NYC Open Data: a plain outage message well inside the budget", async () => {
  const { soda, requests } = await fixtureSoda({
    respond: async (u) => (u.pathname === "/resource/wewp-mm3p.json" ? new Response("Service Unavailable", { status: 503 }) : null),
    cost: 10_000,
  });
  const t0 = soda.clock();
  await assert.rejects(directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW), OUTAGE);
  // A slow 503 (10 s here) is not retried: one try for the month, after one for the metadata.
  assert.equal(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").length, 1);
  assert.ok(soda.clock() - t0 <= 20_000, `${soda.clock() - t0} ms`);
});

test("a fast 503 is retried once, then the plain outage message", async () => {
  const { soda, requests } = await fixtureSoda({
    respond: async (u) => (u.pathname === "/resource/wewp-mm3p.json" ? new Response("Service Unavailable", { status: 503 }) : null),
    cost: 200,
  });
  const t0 = soda.clock();
  await assert.rejects(directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW), OUTAGE);
  assert.equal(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").length, 2);
  assert.ok(soda.clock() - t0 < 5_000, `${soda.clock() - t0} ms`);
});

test("NYC Open Data down before the metadata answers, nothing saved: the same plain outage message", async () => {
  const { soda } = await fixtureSoda({ respond: async () => new Response("Service Unavailable", { status: 503 }), cost: 1_000 });
  await assert.rejects(directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW), OUTAGE);
});

// ── Beta retest 2 (2026-11-09): the City's dataset was slow, not down ──────────
// A direct October query took 74 s; the report gave up at 30 s and said "not responding".
// Now: a lighter query (one $group by topic, plus counts of filled agency and
// call_resolution), a longer wait per request, and "slow" vs "not responding" said apart.

/** A fetch that never answers until the client gives up on it. */
const hang = (init) =>
  new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason ?? new Error("aborted")), { once: true }));

test("each month is one light query: grouped by topic only, with counts of filled agency and call_resolution", async () => {
  const { soda, requests } = await fixtureSoda();
  await directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW);
  const data = requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json");
  assert.equal(data.length, 1, "one query for the asked month, no second query when agency and call_resolution are blank");
  for (const r of data) {
    assert.equal(r.url.searchParams.get("$group"), "inquiry_name");
    assert.match(r.url.searchParams.get("$select"), /count\(agency\)/);
    assert.match(r.url.searchParams.get("$select"), /count\(call_resolution\)/);
  }
});

test("a month whose calls do carry an agency is asked again with the full breakdown", async () => {
  const { soda, requests } = await fixtureSoda({
    respond: async (u) => {
      if (u.pathname !== "/resource/wewp-mm3p.json" || !/2026-07-01/.test(u.searchParams.get("$where"))) return null;
      if (u.searchParams.get("$offset") !== "0") return Response.json([]);
      return u.searchParams.get("$group") === "inquiry_name"
        ? Response.json([{ inquiry_name: "A", n: "5", with_agency: "3", with_resolution: "0" }])
        : Response.json([
            { inquiry_name: "A", agency: "DOF", agency_name: "Department of Finance", n: "3" },
            { inquiry_name: "A", n: "2" },
          ]);
    },
  });
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW);
  const july = requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json" && /2026-07-01/.test(r.url.searchParams.get("$where")));
  assert.deepEqual(july.map((r) => r.url.searchParams.get("$group")), ["inquiry_name", "inquiry_name, agency, agency_name, call_resolution"]);
  assert.ok(env.data.fiscal_year.by_agency.some((a) => a.agency === "DOF" && a.calls === 3));
});

test("NYC Open Data too slow on the asked month: says it is slow, not down, with no five-digit number", async () => {
  const { soda, requests } = await fixtureSoda({
    respond: async (u, _n, init) => (u.pathname === "/resource/wewp-mm3p.json" ? hang(init) : null),
  });
  await assert.rejects(directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW, { requestTimeoutMs: 20 }), (e) => {
    assert.match(e.message, /NYC Open Data is slow right now/);
    assert.doesNotMatch(e.message, /not responding|Gave up on|\d{5}/);
    return true;
  });
  assert.equal(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").length, 1, "a timeout is not retried");
});

test("the FY2027 report answers when one month times out: that month is listed as missing, slow, with no ZIP-guard error", async () => {
  const { soda } = await fixtureSoda({
    respond: async (u, _n, init) =>
      u.pathname === "/resource/wewp-mm3p.json" && /2026-10-01/.test(u.searchParams.get("$where")) ? hang(init) : null,
  });
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW, { requestTimeoutMs: 20 });
  const fy = env.data.fiscal_year;
  assert.equal(fy.complete, false);
  const oct = fy.months_missing.find((m) => m.month === "2026-10");
  assert.ok(oct, JSON.stringify(fy.months_missing));
  assert.match(oct.why, /slow/);
  assert.doesNotMatch(JSON.stringify(env), /ZIP code removed|\d{5} ms/);
});

test("timeout text says seconds, never a bare five-digit millisecond count", async () => {
  const { soda } = await fixtureSoda({ respond: async (_u, _n, init) => hang(init) });
  await assert.rejects(soda.getJson("/resource/wewp-mm3p.json", { $limit: "1" }, { timeoutMs: 1500, maxTries: 1 }), (e) => {
    assert.match(e.message, /no answer within 2 seconds/);
    assert.doesNotMatch(e.message, /\d{5}|after 1 tries/);
    return true;
  });
});

test("the report waits long enough for a slow month, and stays under a minute in all", () => {
  assert.ok(DA_REQUEST.timeoutMs >= 50_000 && DA_REQUEST.timeoutMs < 60_000, String(DA_REQUEST.timeoutMs));
  assert.ok(DA_BUDGET_MS >= DA_REQUEST.timeoutMs && DA_BUDGET_MS < 60_000, String(DA_BUDGET_MS));
});

// ── Beta retest 3 (2026-11-09): a one-month call waited ~55 s even with its month saved ──
// It also tried to fill in the fiscal year to date, and waited on the months not yet saved.
// Now a one-month call fetches only its month; the fiscal-year call fetches the rest.

test("a one-month call with its month saved asks NYC Open Data for no rows, even when the portal hangs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-one-month-"));
  await warmMonths(dir, ["2026-10"]);
  const { soda, requests } = await fixtureSoda({ cacheDir: dir, respond: async (u, _n, init) => (u.pathname === "/resource/wewp-mm3p.json" ? hang(init) : null) });
  const t0 = soda.clock();
  const env = await directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW, { requestTimeoutMs: 50 });
  assert.equal(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").length, 0, "no row query");
  assert.ok(soda.clock() - t0 < 5_000, `${soda.clock() - t0} ms`);
  assert.equal(env.data.month.complete, true);
  assert.equal(env.data.month.calls, await monthSum("2026-10"));
  const fy = env.data.fiscal_year;
  assert.equal(fy.complete, false);
  assert.deepEqual(fy.months_missing.map((m) => m.month), ["2026-07", "2026-08", "2026-09"]);
  for (const m of fy.months_missing) assert.match(m.why, /one-month call fetches only its own month/);
  assert.match(fy.note, /fiscal_year/);
  assert.equal(env.data.months_queried, 0);
});

test("a cold one-month call fetches only that month", async () => {
  const { soda, requests } = await fixtureSoda();
  await directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW);
  const asked = requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").map((r) => /'(\d{4}-\d{2})-01/.exec(r.url.searchParams.get("$where"))[1]);
  assert.deepEqual(asked, ["2026-10"]);
});

test("a one-month call uses every saved month for its fiscal year to date, asking nothing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-one-month-fy-"));
  await warmMonths(dir, FY27_TO_OCT);
  const { soda, requests } = await fixtureSoda({ cacheDir: dir });
  const env = await directoryAssistanceReport(daArgs({ month: "2026-10" }), soda, NOW);
  assert.equal(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").length, 0);
  let fy = 0;
  for (const ym of FY27_TO_OCT) fy += await monthSum(ym);
  assert.equal(env.data.fiscal_year.complete, true);
  assert.equal(env.data.fiscal_year.calls, fy);
});

test("the fiscal-year call answers saved months at once and lists the slow ones as missing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-fy-mixed-"));
  await warmMonths(dir, ["2026-07", "2026-10"]);
  const { soda, requests } = await fixtureSoda({
    cacheDir: dir,
    respond: async (u, _n, init) => (u.pathname === "/resource/wewp-mm3p.json" && /2026-08-01/.test(u.searchParams.get("$where")) ? hang(init) : null),
  });
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW, { requestTimeoutMs: 20 });
  const fy = env.data.fiscal_year;
  assert.equal(fy.complete, false);
  assert.equal(fy.calls, undefined, "no partial total");
  const why = Object.fromEntries(fy.months_missing.map((m) => [m.month, m.why]));
  assert.match(why["2026-08"], /too slow/);
  // One request at a time (standards §6): after a slow month, the rest wait for the next call.
  assert.match(why["2026-09"], /not tried: NYC Open Data was too slow/);
  assert.match(why["2026-11"], /not tried/);
  assert.equal(why["2026-07"], undefined);
  assert.equal(why["2026-10"], undefined);
  assert.equal(env.data.months_from_cache, 2);
  const asked = requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").map((r) => /'(\d{4}-\d{2})-01/.exec(r.url.searchParams.get("$where"))[1]);
  assert.ok(!asked.includes("2026-07") && !asked.includes("2026-10"), "saved months are not asked");
  assert.equal(asked.filter((m) => m === "2026-08").length, 1, "a timeout is not retried");
});

// ── Beta retest 4 (2026-11-09): the first FY2027 call waited ~55 s on one slow month ──
// Now saved months answer at once, the rest are fetched one at a time, the answer waits
// DA_ANSWER_WAIT_MS at most, and months still loading are listed and saved when they land.

const realSetTimeout = globalThis.setTimeout;
const pause = (ms) => new Promise((r) => realSetTimeout(r, ms));
/** A response that takes `ms` (on the mocked clock), unless the request is aborted first. */
const slowly = (ms, init) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(null), ms);
    init.signal.addEventListener("abort", () => (clearTimeout(t), reject(init.signal.reason ?? new Error("aborted"))), { once: true });
  });
/** Advance the mocked timers in steps until `done()` or `limit` ms; returns the mocked ms that passed. */
async function advance(done, limit, step = 250) {
  let t = 0;
  while (!done() && t < limit) {
    await pause(3);
    mock.timers.tick(step);
    t += step;
  }
  await pause(10);
  return t;
}

test("fiscal-year call, slow portal: answers within the wait from saved months, lists the rest as still loading, and asking again finishes", async (t) => {
  assert.ok(DA_ANSWER_WAIT_MS <= 15_000 && DA_ANSWER_WAIT_MS >= 5_000, String(DA_ANSWER_WAIT_MS));
  assert.equal(DA_CONCURRENT_MONTHS, 1, "engineering standards §6: never in parallel to one portal");
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-fy-wait-"));
  await warmMonths(dir, ["2026-07", "2026-10"]);
  let active = 0;
  let most = 0;
  const { soda, requests } = await fixtureSoda({
    cacheDir: dir,
    respond: async (u, _n, init) => {
      if (u.pathname !== "/resource/wewp-mm3p.json") return null;
      most = Math.max(most, ++active);
      try {
        await slowly(40_000, init); // each month takes 40 s, as on 2026-11-09
      } finally {
        active--;
      }
      return null;
    },
  });
  const rows = () => requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json");
  // Node 20.11+ takes { apis }; Node 18 takes the array (package.json engines: >=18).
  let legacy = false;
  try {
    mock.timers.enable({ apis: ["setTimeout"] });
  } catch {
    mock.timers.enable(["setTimeout"]);
    legacy = true;
  }
  t.after(() => mock.timers.reset());
  let env;
  const first = directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW).then((e) => (env = e));
  const waited = await advance(() => env, 60_000);
  await first;
  t.diagnostic(`first fiscal-year call answered after ${waited} ms on the mocked clock`);
  assert.ok(waited <= DA_ANSWER_WAIT_MS + 500, `waited ${waited} ms`);
  const fy = env.data.fiscal_year;
  assert.equal(fy.complete, false);
  assert.equal(fy.calls, undefined, "no total is invented");
  assert.deepEqual(fy.months_missing.map((m) => m.month), ["2026-08", "2026-09", "2026-11"]);
  for (const m of fy.months_missing) assert.equal(m.why, STILL_LOADING);
  assert.match(STILL_LOADING, /ask again in a minute/);
  assert.match(fy.note, /still loading/);
  assert.equal(env.data.months_from_cache, 2);
  assert.equal(most, 1, `${most} requests at once`);
  // Node 18's mock timers never fire a timer set after the first tick, so the rest is
  // checked there by the real-clock test below.
  if (legacy) return t.diagnostic("Node 18 mock timers: background part checked by the real-clock test");
  // A second call while they load waits on the same requests: no new ones.
  let env2;
  const second = directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW).then((e) => (env2 = e));
  await advance(() => env2, 60_000);
  await second;
  assert.equal(env2.data.fiscal_year.complete, false);
  // The loads finish on their own (40 s each, one at a time) and are saved.
  const loaded = await advance(() => rows().length === 3 && active === 0, 400_000, 1_000);
  t.diagnostic(`background loads done ${loaded} ms after the second call`);
  await pause(50); // the last month's save is real file I/O
  assert.equal(active, 0);
  assert.equal(most, 1, `${most} requests at once`);
  const asked = rows().map((r) => /'(\d{4}-\d{2})-01/.exec(r.url.searchParams.get("$where"))[1]);
  assert.deepEqual([...asked].sort(), ["2026-08", "2026-09", "2026-11"], "each missing month asked once, across both calls");
  mock.timers.reset();
  const t0 = Date.now();
  const done = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW);
  assert.ok(Date.now() - t0 < 1_000);
  assert.equal(rows().length, 3, "nothing asked again");
  assert.equal(done.data.fiscal_year.complete, true);
  let total = 0;
  for (const ym of FY27_TO_OCT) total += await monthSum(ym);
  assert.equal(done.data.fiscal_year.calls, total);
});

test("fiscal-year call, real clock and short waits: answers at the wait, then the months load one at a time and are saved", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-fy-real-"));
  await warmMonths(dir, ["2026-07", "2026-10"]);
  let active = 0;
  let most = 0;
  const asked = [];
  // A real clock that reads as the fixtures' date, so saved months stay fresh on any day.
  const offset = Date.now() - NOW;
  const real = new SodaClient({
    logger: () => {},
    cacheDir: dir,
    minIntervalMs: 5,
    now: () => Date.now() - offset,
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/api/views/wewp-mm3p.json") return new Response(await readFile(path.join(SODA_FIX, "view.json")));
      const m = /date >= '(\d{4}-\d{2})-01/.exec(u.searchParams.get("$where"));
      asked.push(m[1]);
      most = Math.max(most, ++active);
      await pause(150);
      active--;
      if (u.searchParams.get("$offset") !== "0") return Response.json([]);
      const body = await readFile(path.join(SODA_FIX, `${m[1]}.json`)).catch(() => null);
      return body ? new Response(body) : Response.json([]);
    },
  });
  const t0 = Date.now();
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), real, NOW, { answerWaitMs: 60 });
  const took = Date.now() - t0;
  assert.ok(took < 140, `answered after ${took} ms, before any month could load`);
  assert.deepEqual(env.data.fiscal_year.months_missing.map((m) => [m.month, m.why]), [["2026-08", STILL_LOADING], ["2026-09", STILL_LOADING], ["2026-11", STILL_LOADING]]);
  for (let i = 0; i < 100 && !(asked.length === 3 && active === 0); i++) await pause(20);
  await pause(100);
  assert.equal(active, 0);
  assert.equal(most, 1, "one request at a time");
  assert.deepEqual(asked, ["2026-08", "2026-09", "2026-11"]);
  const done = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), real, NOW, { answerWaitMs: 60 });
  assert.equal(done.data.fiscal_year.complete, true);
  assert.equal(asked.length, 3, "nothing asked again");
});

test("fiscal-year call with every month saved answers without waiting or asking", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-fy-saved-"));
  await warmMonths(dir, [...FY27_TO_OCT, "2026-11"]);
  const { soda, requests } = await fixtureSoda({ cacheDir: dir, respond: async (u, _n, init) => (u.pathname === "/resource/wewp-mm3p.json" ? hang(init) : null) });
  const t0 = Date.now();
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW);
  assert.ok(Date.now() - t0 < 1_000);
  assert.equal(env.data.fiscal_year.complete, true);
  assert.equal(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").length, 0);
});

test("fiscal-year call, portal failing: the months tried say not responding, the rest are not tried, and it answers fast", async () => {
  const { soda, requests } = await fixtureSoda({
    respond: async (u) => (u.pathname === "/resource/wewp-mm3p.json" ? new Response("Service Unavailable", { status: 503 }) : null),
    cost: 6_000,
  });
  const t0 = Date.now();
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW);
  assert.ok(Date.now() - t0 < 2_000);
  const fy = env.data.fiscal_year;
  assert.equal(fy.complete, false);
  assert.equal(fy.calls, undefined);
  const whys = fy.months_missing.map((m) => m.why);
  assert.ok(whys.some((w) => /not responding/.test(w)), JSON.stringify(whys));
  assert.ok(whys.some((w) => /not tried: NYC Open Data was failing/.test(w)), JSON.stringify(whys));
  assert.equal(requests.filter((r) => r.url.pathname === "/resource/wewp-mm3p.json").length, 1, "a slow 503 is not retried, and no other month is tried");
});


// ── Beta retest 5 (2026-11-09): a failed background month cost a whole extra call, and a
// partial fiscal-year answer showed no numbers for the months it had saved. ──

test("a background month load that fails during the next call is retried in that call, one request at a time", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-fy-retry-"));
  await warmMonths(dir, ["2026-07", "2026-10"]);
  let active = 0;
  let most = 0;
  const asked = [];
  let firstAug = true;
  const offset = Date.now() - NOW;
  const real = new SodaClient({
    logger: () => {},
    cacheDir: dir,
    minIntervalMs: 5,
    now: () => Date.now() - offset,
    fetch: async (url, init) => {
      const u = new URL(url);
      if (u.pathname === "/api/views/wewp-mm3p.json") return new Response(await readFile(path.join(SODA_FIX, "view.json")));
      const m = /date >= '(\d{4}-\d{2})-01/.exec(u.searchParams.get("$where"));
      asked.push(m[1]);
      most = Math.max(most, ++active);
      try {
        if (m[1] === "2026-08" && firstAug) {
          firstAug = false;
          await hang(init); // the first August request times out (requestTimeoutMs below)
        }
        await pause(20);
      } finally {
        active--;
      }
      if (u.searchParams.get("$offset") !== "0") return Response.json([]);
      const body = await readFile(path.join(SODA_FIX, `${m[1]}.json`)).catch(() => null);
      return body ? new Response(body) : Response.json([]);
    },
  });
  // Call 1 answers at once and leaves August loading in the background.
  const first = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), real, NOW, { answerWaitMs: 10, requestTimeoutMs: 250 });
  assert.equal(first.data.fiscal_year.complete, false);
  // Call 2 starts while August is still loading; it fails during call 2's wait, and the
  // months it held up are retried in the same call rather than left for a third.
  const t0 = Date.now();
  const second = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), real, NOW, { answerWaitMs: 3_000, requestTimeoutMs: 250 });
  const took = Date.now() - t0;
  assert.equal(second.data.fiscal_year.complete, true, JSON.stringify(second.data.fiscal_year.months_missing));
  assert.ok(took < 3_000, `answered after ${took} ms`);
  assert.equal(most, 1, "one request at a time (standards §6)");
  assert.deepEqual(asked, ["2026-08", "2026-08", "2026-09", "2026-11"]);
  let total = 0;
  for (const ym of FY27_TO_OCT) total += await monthSum(ym);
  assert.equal(second.data.fiscal_year.calls, total);
});

test("an incomplete fiscal year shows each saved month's count and a labeled partial sum, never a total", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-fy-partial-"));
  await warmMonths(dir, ["2026-07", "2026-10"]);
  const { soda } = await fixtureSoda({
    cacheDir: dir,
    respond: async (u, _n, init) => (u.pathname === "/resource/wewp-mm3p.json" && /2026-08-01/.test(u.searchParams.get("$where")) ? hang(init) : null),
  });
  const env = await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW, { requestTimeoutMs: 20 });
  const fy = env.data.fiscal_year;
  assert.equal(fy.complete, false);
  assert.equal(fy.calls, undefined, "no fiscal-year total");
  const jul = await monthSum("2026-07");
  const oct = await monthSum("2026-10");
  const julDa = await monthSum("2026-07", (r) => r.inquiry_name === "Directory Assistance");
  assert.deepEqual(fy.saved_months.map((m) => [m.month, m.calls]), [["2026-07", jul], ["2026-10", oct]]);
  assert.equal(fy.saved_months[0].directory_assistance_topic_calls, julDa);
  assert.equal(fy.saved_months_so_far.calls, jul + oct);
  assert.equal(fy.saved_months_so_far.months, 2);
  assert.equal(fy.saved_months_so_far.of_months, 5);
  assert.match(fy.saved_months_so_far.label, /^Saved months so far \(2 of 5\): a partial sum, not the total/);
  assert.match(fy.note, /full total is not ready yet/);
  assert.match(fy.note, /partial sum of the saved months so far, not the total/);
});

test("an incomplete fiscal year with nothing saved has an empty saved_months and no partial sum", async () => {
  const { soda } = await fixtureSoda({
    respond: async (u) => (u.pathname === "/resource/wewp-mm3p.json" ? new Response("Service Unavailable", { status: 503 }) : null),
    cost: 6_000,
  });
  const fy = (await directoryAssistanceReport(daArgs({ fiscal_year: 2027 }), soda, NOW)).data.fiscal_year;
  assert.equal(fy.complete, false);
  assert.deepEqual(fy.saved_months, []);
  assert.equal(fy.saved_months_so_far, null);
  assert.doesNotMatch(fy.note, /saved_months/);
});
