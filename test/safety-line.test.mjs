// Every response from every tool carries one fixed sentence, Noel's (beta round 13): "If this is an
// emergency, please call 911." It is first in the text and the first field of the structured output,
// on success and on error, for all 21 tools, whatever was or was not detected (defense in depth:
// beta retest 11 found eight emergencies the danger words missed). A detected danger still leads
// how_to_report's and draft_311_report's first_line with its own 911 line.
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

test("the safety line is Noel's sentence, word for word", () => {
  assert.equal(SAFETY_LINE, "If this is an emergency, please call 911.");
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

test("every response from all 21 tools starts with the safety line, success or error", async (t) => {
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
    assert.ok(text.startsWith(SAFETY_LINE), `${name}: ${text.slice(0, 140)}`);
    if (!r.isError) {
      const out = JSON.parse(text.slice(SAFETY_LINE.length));
      assert.equal(Object.keys(out)[0], "safety_line", name);
      assert.equal(out.safety_line, SAFETY_LINE, name);
    }
  }
  // A detected danger still leads first_line with its own 911 line.
  const gas = JSON.parse((await callTool("how_to_report", { description: "I smell gas in my kitchen" })).content[0].text.slice(SAFETY_LINE.length));
  assert.match(gas.first_line, /^Call 911/);
});
