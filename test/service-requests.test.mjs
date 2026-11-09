// Phase 3 (#16): find_requests, plain-language statuses, and the 311 API lookups with
// their plain_language block. No network: BoardStat is served from the fixtures, and the
// 311 API from responses recorded on 2026-11-07 (test/fixtures/api/), with fetch stubbed.
import { SAFETY_LINE } from "../dist/emergency.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDistrictTool } from "../dist/district-tools.js";
import { parseToolArgs, callTool } from "../dist/tools.js";
import { assertNoZipValues } from "../dist/envelope.js";
import {
  API_STATUS_CODES,
  describeServiceRequest,
  describeServiceRequestList,
  explainStatus,
  streetOf,
} from "../dist/service-requests.js";
import { FIX, MANIFEST, fixtureData, pick } from "./district-fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED = JSON.parse(await readFile(path.join(FIX, "expected-lookup.json"), "utf8"));
const API = JSON.parse(await readFile(path.join(HERE, "fixtures", "api", "service-requests-2026-11-07.json"), "utf8"));
const LAST = MANIFEST.window.last_created.slice(0, 10);

async function run(args) {
  const { data } = await fixtureData();
  const env = await runDistrictTool("find_requests", parseToolArgs("find_requests", args), data);
  return env;
}

// ── find_requests, against DuckDB ─────────────────────────────────────────────

const CASES = [
  ["all_484", { community_district: 484, from_date: "2020-01-01", to_date: LAST, limit: 10 }],
  ["all_484_page2", { community_district: 484, from_date: "2020-01-01", to_date: LAST, limit: 10, offset: 10 }],
  ["pending_484", { community_district: 484, from_date: "2020-01-01", to_date: LAST, limit: 200, statuses: ["pending"] }],
  ["closed_dot_484_fy2026", { community_district: 484, fiscal_year: 2026, limit: 5, status: "closed", agency: "dot" }],
  ["not_closed_cc1", { council_district: 1, from_date: "2020-01-01", to_date: LAST, limit: 50, status: "not_closed" }],
];

for (const [key, args] of CASES) {
  test(`find_requests ${JSON.stringify(args)} matches DuckDB exactly (${key})`, async () => {
    const { data } = await run(args);
    const want = EXPECTED[key];
    assert.equal(data.requests, want.requests);
    assert.deepEqual(pick(data.by_status, want.by_status), want.by_status);
    assert.deepEqual(pick(data.newest_first, want.newest_first), want.newest_first);
  });
}

test("find_requests pages with offset and next_offset, and every row has the agency's resolution", async () => {
  const one = await run({ community_district: 484, from_date: "2020-01-01", limit: 10 });
  assert.equal(one.data.next_offset, 10);
  const last = await run({ community_district: 484, from_date: "2020-01-01", limit: 10, offset: 860 });
  assert.equal(last.data.newest_first.length, 7);
  assert.equal(last.data.next_offset, null);
  for (const r of one.data.newest_first) {
    assert.ok("resolution" in r && "unique_key" in r && !("sr_number" in r));
  }
  assertNoZipValues(one);
});

test("find_requests explains every status it counts, and says Closed is not fixed", async () => {
  const { data } = await run({ community_district: 484, from_date: "2020-01-01" });
  const statuses = data.by_status.map((s) => s.status).sort();
  assert.deepEqual(statuses, ["Assigned", "Closed", "In Progress", "Open", "Pending", "Started"]);
  for (const s of data.by_status) {
    assert.ok(s.meaning.length > 20, s.status);
    assert.equal(s.closed, s.status === "Closed");
  }
  assert.match(data.by_status.find((s) => s.status === "Closed").meaning, /does not mean the problem was fixed/);
});

test("find_requests: an unknown status is refused with the statuses present; one status goes into the BoardStat link", async () => {
  const { data } = await fixtureData();
  await assert.rejects(
    runDistrictTool("find_requests", parseToolArgs("find_requests", { community_district: 484, from_date: "2020-01-01", statuses: ["Resolved"] }), data),
    /no request .* has the status 'Resolved'.*'Pending'/i
  );
  const env = await run({ community_district: 484, from_date: "2020-01-01", statuses: ["Pending"] });
  assert.equal(new URL(env.boardstat_url).searchParams.get("status"), "Pending");
  const two = await run({ community_district: 484, from_date: "2020-01-01", statuses: ["Pending", "Open"] });
  assert.equal(new URL(two.boardstat_url).searchParams.get("status"), null);
  assert.ok(two.caveats.some((c) => /one status at a time/.test(c)));
});

test("find_requests and the other lists say unique_key is not the 311 number", async () => {
  const env = await run({ community_district: 484 });
  assert.ok(env.caveats.some((c) => /not the 311 number \(311-XXXXXXXX\)/.test(c)));
  const { data } = await fixtureData();
  const open = await runDistrictTool("still_open", parseToolArgs("still_open", { community_district: 484 }), data);
  assert.ok(open.caveats.some((c) => /not the 311 number/.test(c)));
  assert.ok(open.data.oldest_first.every((r) => "unique_key" in r && !("sr_number" in r)));
  assert.ok(Object.keys(open.data.status_meanings).length > 0);
});

test("address_history pages with offset and explains its statuses", async () => {
  const { data } = await fixtureData();
  const want = JSON.parse(await readFile(path.join(FIX, "expected.json"), "utf8")).address_history_top;
  const args = { address: want.address.toLowerCase(), borough: "Queens", limit: 2 };
  const first = await runDistrictTool("address_history", parseToolArgs("address_history", args), data);
  const second = await runDistrictTool("address_history", parseToolArgs("address_history", { ...args, offset: 2 }), data);
  assert.deepEqual([...first.data.newest_first, ...second.data.newest_first].map((r) => r.unique_key), want.newest_unique_keys.slice(0, 4));
  assert.equal(first.data.next_offset, 2);
  assert.ok(Object.keys(first.data.status_meanings).length >= 1);
});

test("find_requests and address_history: next_page carries data_as_of, and a page from another build is refused", async () => {
  const one = await run({ community_district: 484, from_date: "2020-01-01", limit: 10 });
  assert.deepEqual(one.data.next_page, { offset: 10, data_as_of: MANIFEST.generated_at });
  const two = await run({ community_district: 484, from_date: "2020-01-01", limit: 10, ...one.data.next_page });
  assert.equal(two.data.offset, 10);
  await assert.rejects(run({ community_district: 484, from_date: "2020-01-01", offset: 10, data_as_of: "2026-01-01T00:00:00Z" }), /published new data since the first page/);
  const { data } = await fixtureData();
  const want = JSON.parse(await readFile(path.join(FIX, "expected.json"), "utf8")).address_history_top;
  const args = { address: want.address.toLowerCase(), borough: "Queens", limit: 2 };
  const first = await runDistrictTool("address_history", parseToolArgs("address_history", args), data);
  assert.deepEqual(first.data.next_page, { offset: 2, data_as_of: MANIFEST.generated_at });
  await assert.rejects(
    runDistrictTool("address_history", parseToolArgs("address_history", { ...args, offset: 2, data_as_of: "2026-01-01T00:00:00Z" }), data),
    /published new data since the first page/
  );
});

test("find_requests refuses status + statuses that cannot both hold, and allows ones that agree", async () => {
  for (const args of [{ status: "closed", statuses: ["Pending"] }, { status: "not_closed", statuses: ["closed"] }, { status: "closed", statuses: ["Closed", "Open"] }]) {
    await assert.rejects(run({ community_district: 484, ...args }), /cannot both hold/, JSON.stringify(args));
  }
  const ok = await run({ community_district: 484, from_date: "2020-01-01", status: "not_closed", statuses: ["Pending"] });
  assert.equal(ok.data.requests, EXPECTED.pending_484.requests);
});

test("find_requests reads the text columns only for the page, not for every request in the district", async () => {
  const { data } = await fixtureData();
  const pinned = await data.pinned();
  let textRows = 0;
  let lightRows = 0;
  const spy = {
    siteUrl: pinned.siteUrl,
    manifest: () => pinned.manifest(),
    readParquet: async (rel, opts) => {
      const r = await pinned.readParquet(rel, opts);
      if (rel.startsWith("detail/")) {
        if (opts.columns.includes("resolution_description")) textRows += r.rows.length;
        else lightRows += r.rows.length;
      }
      return r;
    },
  };
  const env = await runDistrictTool("find_requests", parseToolArgs("find_requests", { community_district: 484, from_date: "2020-01-01", limit: 3 }), spy);
  assert.equal(env.data.newest_first.length, 3);
  assert.equal(lightRows, 867);
  assert.equal(textRows, 3);
  assert.ok(env.data.newest_first.every((r) => "resolution" in r && "address" in r));
});

// ── Status meanings ───────────────────────────────────────────────────────────

test("explainStatus: the API's four documented codes and Open Data's seven values all have a meaning", () => {
  assert.deepEqual(API_STATUS_CODES, { 614110000: "Cancel", 614110001: "Open", 614110002: "In Progress", 614110003: "Closed" });
  for (const s of ["Closed", "Open", "In Progress", "Pending", "Assigned", "Started", "Unspecified", "Cancel", "cancelled"]) {
    const e = explainStatus(s);
    assert.ok(!/not a status this server knows/.test(e.meaning), s);
    assert.equal(e.closed, s === "Closed");
    // Every meaning is BetaNYC's reading, and says the City publishes no definition (#22 QA).
    assert.equal(e.meaning_source, "BetaNYC", s);
    assert.match(e.meaning, /The City does not publish a definition of this status\./, s);
  }
  assert.equal(explainStatus("Resolved").closed, null);
  assert.match(explainStatus("Resolved").meaning, /not a status this server knows/);
  assert.equal(explainStatus(null).closed, null);
});

// ── The 311 API answers ───────────────────────────────────────────────────────

test("describeServiceRequest keeps every API field, removes the ZIP code, and adds plain_language", () => {
  const raw = API.responses.get_17323508.body;
  const out = describeServiceRequest(raw);
  for (const k of Object.keys(raw)) assert.ok(k in out, k);
  assert.equal(out.Status, "614110003");
  assert.doesNotMatch(JSON.stringify(out), /99999/);
  assert.equal(out.Address.FullAddress, "180 EAST   94 STREET, MANHATTAN (NEW YORK), NY, [ZIP code removed]");
  assert.deepEqual(
    { ...out.plain_language, meaning: undefined, about_the_number: undefined, next_step: undefined },
    {
      status: "Closed",
      status_code: "614110003",
      meaning: undefined,
      meaning_source: "BetaNYC",
      closed: true,
      resolution: "The Department of Sanitation investigated this complaint and issued a Notice of Violation.",
      resolution_updated: "2024-01-20T20:44:17",
      submitted: "2024-01-18T14:38:16",
      address_lookup: { address: "180 EAST 94 STREET", borough: "Manhattan" },
      about_the_number: undefined,
      next_step: undefined,
    }
  );
  assert.match(out.plain_language.next_step, /address_history with address '180 EAST 94 STREET' and borough 'Manhattan'/);
  assert.match(out.plain_language.about_the_number, /not NYC Open Data's unique_key/);
  assertNoZipValues(out);
});

test("describeServiceRequestList: each request explained, and the number the API left out is in not_found", () => {
  const rec = API.responses.list_17323508_17323514_70999528;
  const out = describeServiceRequestList(rec.body, rec.request.sr_numbers);
  assert.equal(out.SRResponses.length, 2);
  assert.ok(out.SRResponses.every((r) => r.plain_language.status === "Closed"));
  assert.deepEqual(out.not_found, ["311-70999528"]);
  assert.match(out.not_found_note, /not a 311 number/);
  assertNoZipValues(out);
});

test("an undocumented status code is reported as such, not guessed", () => {
  const out = describeServiceRequest({ SRNumber: "311-1", Status: "614110009", Address: null });
  assert.equal(out.plain_language.status, null);
  assert.match(out.plain_language.meaning, /not in the 311 API's documentation/);
  assert.equal(out.plain_language.address_lookup, null);
});

test("streetOf: the street before the first comma, spaces collapsed, no ZIP", () => {
  assert.equal(streetOf("165 EAST   94 STREET, MANHATTAN (NEW YORK), NY, 99999"), "165 EAST 94 STREET");
  assert.equal(streetOf(null), null);
});

test("the recorded evidence: the API's 311 number and Open Data's unique_key are different numbers", () => {
  const m = API.open_data_matches;
  for (const sr of ["311-17323508", "311-17323514"]) {
    const api = API.responses.list_17323508_17323514_70999528.body.SRResponses.find((r) => r.SRNumber === sr);
    const od = m[sr];
    assert.equal(api.DateTimeSubmitted, od.created_date.slice(0, 19));
    assert.equal(api.ResolutionAction, od.resolution_description);
    assert.equal(api.Address.FullAddress.split(",")[0], od.incident_address);
    assert.notEqual(sr.slice(4), od.unique_key);
  }
  assert.equal(API.responses.get_70999528.http_status, 404);
});

// ── Through callTool, with the 311 API stubbed ───────────────────────────────

test("get_service_request / get_service_request_list through callTool: plain_language, not_found, and a 404 hint", async () => {
  process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/GetServiceRequest")) {
      const key = `get_${u.searchParams.get("srnumber").slice(4)}`;
      const rec = API.responses[key];
      return new Response(JSON.stringify(rec.body), { status: rec.http_status, statusText: rec.http_status === 404 ? "Not Found" : "OK" });
    }
    if (u.pathname.endsWith("/GetServiceRequestList")) {
      const nums = JSON.parse(init.body).SRNumbers;
      const rec = API.responses[`list_${nums.map((n) => n.slice(4)).join("_")}`];
      return new Response(JSON.stringify(rec.body), { status: 200 });
    }
    throw new Error(`unexpected request ${u}`);
  };
  try {
    const one = await callTool("get_service_request", { sr_number: "311-17323508" });
    assert.notEqual(one.isError, true, one.content[0].text);
    const parsed = JSON.parse(one.content[0].text.slice(0, -SAFETY_LINE.length));
    assert.equal(parsed.plain_language.status, "Closed");
    assert.doesNotMatch(one.content[0].text, /99999/);

    const miss = await callTool("get_service_request", { sr_number: "311-70999528" });
    assert.equal(miss.isError, true);
    assert.match(miss.content[0].text, /311 has no service request 311-70999528\. If this number came from NYC Open Data.*not a 311 number/s);
    // Only the plain sentence: not the City's raw error body (beta retest 1).
    assert.doesNotMatch(miss.content[0].text, /Response body|wasn't found!|"Error"|NotFound/);

    const many = await callTool("get_service_request_list", { sr_numbers: ["311-17323508", "311-17323514", "311-70999528"] });
    assert.deepEqual(JSON.parse(many.content[0].text.slice(0, -SAFETY_LINE.length)).not_found, ["311-70999528"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a not-found message keeps a request id the API sent, and nothing else of its body", async () => {
  const { notFoundMessage, NOT_FOUND_HINT } = await import("../dist/service-requests.js");
  assert.equal(notFoundMessage("311-1", 'NYC 311 API error 404: Not Found Response body: {"Error":{"Code":"NotFound"}}'), `311 has no service request 311-1. ${NOT_FOUND_HINT}`);
  assert.match(notFoundMessage("311-1", 'NYC 311 API error 404: Not Found Response body: {"requestId": "abc123-def"}'), /\(311 API request id abc123-def\.\)$/);
});

// Beta retest 2 (2026-11-09): get_service_request_list with only made-up numbers got a 404
// from the City and passed its raw text through ("NYC 311 API error 404: Not Found Response
// body: {…No SR record was found…}"). Now it says the same plain sentence and hint as
// get_service_request. The 404 body here is a stub shaped like the one the retest saw.
test("get_service_request_list with only unknown numbers: one plain sentence and the unique_key hint, no raw City text", async () => {
  const { NOT_FOUND_HINT } = await import("../dist/service-requests.js");
  process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/GetServiceRequestList")) {
      return new Response(JSON.stringify({ message: "No SR record was found" }), { status: 404, statusText: "Not Found" });
    }
    throw new Error(`unexpected request ${u}`);
  };
  try {
    const one = await callTool("get_service_request_list", { sr_numbers: ["311-99999999"] });
    assert.equal(one.isError, true);
    assert.equal(one.content[0].text, `Error: 311 has no service request 311-99999999. ${NOT_FOUND_HINT}\n\n${SAFETY_LINE}`);
    const two = await callTool("get_service_request_list", { sr_numbers: ["311-99999998", "311-99999999"] });
    assert.equal(two.isError, true);
    assert.match(two.content[0].text, /^Error: 311 has none of these service requests: 311-99999998, 311-99999999\. /);
    for (const r of [one, two]) assert.doesNotMatch(r.content[0].text, /Response body|No SR record|error 404|Not Found/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
