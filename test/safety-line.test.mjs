// Every response from every tool carries one fixed text, Noel's (beta round 18): a disclaimer, then
// "If this is an emergency, or if you think this is an emergency, call 911." It is the LAST line of the text, like
// the end of a doctor's office phone message, on success and on error, for all 21 tools, whatever
// was or was not detected; and the first field (safety_line) of every structured answer. Danger
// spotting is a best effort; a detected danger still leads how_to_report's and draft_311_report's
// first_line with its own 911 line at the top.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callTool, TOOLS } from "../dist/tools.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { setContentClient } from "../dist/content-311.js";
import { setSodaClient, SodaClient } from "../dist/soda.js";
import { setBoardStatData } from "../dist/district-tools.js";
import { stressClient } from "./stress-client.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

test("the closing text is Noel's, word for word, and is in the server instructions once", async () => {
  const { SERVER_INSTRUCTIONS } = await import("../dist/instructions.js");
  assert.equal(SERVER_INSTRUCTIONS.split(SAFETY_LINE).length, 2);
  assert.equal(
    SAFETY_LINE,
    "For informational purposes only. BetaNYC builds these answers from City data; they may contain errors. Check the City's 311 page before you report. If this is an emergency, or if you think this is an emergency, call 911."
  );
  assert.equal(SAFETY_LINE.split("call 911").length, 2, "the 911 wording once");
});

/** Calls that reach each tool without the network: fixtures for content, BoardStat and Socrata; the 311 API tools answer from an argument error or a stubbed fetch. */
const CALLS = [
  ["get_calendar", { date: "not-a-date" }],
  ["get_status", { type: "NotAType" }],
  ["get_service_request", { sr_number: "bad" }],
  ["get_service_request_list", { sr_numbers: [] }],
  ["find_district", { borough: "Manhattan" }],
  ["district_summary", { community_district: 101, from_date: "2026-10-01", to_date: "2026-10-31" }],
  ["top_problems", { community_district: 101, from_date: "2026-10-01", to_date: "2026-10-31" }],
  ["problem_trend", { community_district: 101, problem: "Noise" }],
  ["agency_response", { community_district: 101, from_date: "2026-10-01", to_date: "2026-10-31" }],
  ["still_open", { community_district: 101 }],
  ["top_addresses", { community_district: 101, from_date: "2026-10-01", to_date: "2026-10-31" }],
  ["address_history", { address: "1 Centre Street", borough: "Manhattan" }],
  ["find_requests", { community_district: 101, from_date: "2026-10-01", to_date: "2026-10-02" }],
  ["boardstat_link", { community_district: 101 }],
  ["boardstat_status", {}],
  ["ll47_service_request_report", { community_district: 101, month: "2026-10" }],
  ["ll47_directory_assistance_report", { month: "2026-10" }],
  ["cb_monthly_list", { community_district: 101, month: "2026-10" }],
  ["how_to_report", { description: "a pothole on my block" }],
  ["how_to_report", { description: "my neighbor's security light shines into my bedroom" }],
  ["how_to_report", { description: "I smell gas in my kitchen" }],
  ["list_311_categories", {}],
  ["draft_311_report", { description: "a pothole on my block", location: "Broadway and W 96 St", borough: "Manhattan" }],
  ["draft_311_report", { description: "I smell gas in my kitchen" }],
  ["how_to_report", { description: "x" }],
  ["draft_311_report", {}],
  ["no_such_tool", {}],
];

test("every response from all 21 tools ends with the safety line, success or error", async (t) => {
  const SODA_FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "soda", "wewp-mm3p");
  setContentClient(await stressClient());
  setBoardStatData((await fixtureData()).data);
  // The call-center report and the draft's service levels read Socrata: one fixture client for both.
  const sla = await fixtureSla();
  const soda = new SodaClient({
    logger: () => {},
    minIntervalMs: 0,
    cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-safety-")),
    fetch: async (u) => {
      const url = new URL(String(u));
      if (url.pathname.includes("wewp-mm3p")) {
        if (url.pathname.startsWith("/api/views/")) return new Response(await readFile(path.join(SODA_FIX, "view.json")));
        const m = /date >= '(\d{4}-\d{2})-01/.exec(url.searchParams.get("$where") ?? "");
        if (url.searchParams.get("$offset") !== "0" || !m) return Response.json([]);
        return new Response(await readFile(path.join(SODA_FIX, `${m[1]}.json`)).catch(() => "[]"));
      }
      return sla.soda["fetchImpl"](u);
    },
  });
  setSodaClient(soda);
  t.after(() => {
    setContentClient(null);
    setSodaClient(null);
    setBoardStatData(null);
  });
  const covered = new Set(CALLS.map(([n]) => n));
  for (const tool of TOOLS) assert.ok(covered.has(tool.name), `no call for ${tool.name}`);
  assert.equal(TOOLS.length, 21);
  for (const [name, args] of CALLS) {
    const r = await callTool(name, args);
    const text = r.content[0].text;
    assert.ok(text.endsWith(`\n\n${SAFETY_LINE}`), `${name}: ...${text.slice(-160)}`);
    assert.ok(!text.startsWith(SAFETY_LINE), `${name}: no longer the first line`);
    if (r.isError) assert.equal(text.split(SAFETY_LINE).length, 2, `${name}: once in an error`);
    if (!r.isError) {
      const out = JSON.parse(text.slice(0, -SAFETY_LINE.length));
      // The sentence is the structured field and the last line, nowhere else.
      assert.equal(text.split(SAFETY_LINE).length, 3, `${name}: field and last line only`);
      assert.equal(Object.keys(out)[0], "safety_line", name);
      assert.equal(out.safety_line, SAFETY_LINE, name);
    }
  }
  // A detected danger still leads first_line with its own 911 line.
  const gas = JSON.parse((await callTool("how_to_report", { description: "I smell gas in my kitchen" })).content[0].text.slice(0, -SAFETY_LINE.length));
  assert.match(gas.first_line, /^Call 911/);
});
