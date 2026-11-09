import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, callTool } from "../dist/tools.js";
import { setBoardStatData } from "../dist/district-tools.js";
import { fixtureData } from "./district-fixture.mjs";
import { SodaClient, setSodaClient } from "../dist/soda.js";
import { setContentClient } from "../dist/content-311.js";
import { fixtureContent } from "./content-fixture.mjs";

// These tests never touch the live 311 API. A key is set so getApiKey() does not
// short-circuit, and fetch is stubbed so anything that escapes argument
// validation is served locally instead of reaching api.nyc.gov.
process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
const STUB_BODY = { inEffect: false };
globalThis.fetch = async () =>
  new Response(JSON.stringify(STUB_BODY), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("every advertised tool schema rejects unknown parameters", () => {
  for (const tool of TOOLS) {
    assert.equal(
      tool.inputSchema.additionalProperties,
      false,
      `${tool.name}.inputSchema is missing additionalProperties: false`
    );
  }
});

test("get_status rejects an unknown parameter instead of silently dropping it", async () => {
  const result = await callTool("get_status", {
    type: "CodeBlue",
    bogus_unknown_param: "SHOULD_REJECT",
  });
  const text = result.content[0].text;
  assert.equal(result.isError, true, `expected an error, got: ${text}`);
  assert.match(text, /unrecognized|unknown|not permitted/i);
  // The message must name the offending key and the accepted ones.
  assert.match(text, /bogus_unknown_param/);
  assert.match(text, /\btype\b/);
});

test("get_status still answers a valid call", async () => {
  const result = await callTool("get_status", { type: "CodeBlue" });
  assert.notEqual(result.isError, true, result.content[0].text);
  assert.deepEqual(JSON.parse(result.content[0].text), STUB_BODY);
});

test("get_status still rejects a missing required type", async () => {
  const result = await callTool("get_status", {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /type/);
});

// #7, for every tool rather than one: a valid call plus one invented parameter
// must be refused. VALID_ARGS must name every tool, so a tool added later
// without an entry fails here instead of going untested.
// The district tools read the BoardStat fixtures instead of beta.nyc.
setBoardStatData((await fixtureData()).data);
// The call-center report gets a client that answers locally (an empty dataset), never data.cityofnewyork.us.
setSodaClient(
  new SodaClient({
    fetch: async (url) =>
      String(url).includes("/api/views/")
        ? Response.json({ name: "311 Call Center Inquiry", rowsUpdatedAt: 1794103577, columns: [] })
        : Response.json([]),
    logger: () => {},
    minIntervalMs: 0,
    cacheDir: (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "nyc-311-mcp-strict-")),
  })
);

// how_to_report and list_311_categories read the recorded 311 content, never api.nyc.gov.
setContentClient((await fixtureContent()).client);

const VALID_ARGS = {
  how_to_report: { description: "a pothole on my block" },
  list_311_categories: { category_id: "311-12" },
  draft_311_report: { description: "a pothole on my block", borough: "Queens" },
  find_district: { address: "350 5th Ave" },
  district_summary: { community_district: 484 },
  top_problems: { council_district: 1, last_days: 30 },
  problem_trend: { community_district: 484, problem: "Street Light Condition" },
  agency_response: { community_district: 484, fiscal_year: 2026 },
  still_open: { community_district: 484 },
  top_addresses: { community_district: 484, problems: ["Illegal Parking"] },
  address_history: { address: "JACOB RIIS PARK", borough: "Queens" },
  find_requests: { community_district: 484, statuses: ["pending"] },
  boardstat_link: { community_district: 101 },
  boardstat_status: {},
  ll47_service_request_report: { community_district: 484, month: "2025-10" },
  ll47_directory_assistance_report: { month: "2026-10" },
  cb_monthly_list: { community_district: 484 },
  get_calendar: { date: "2026-07-04" },
  get_status: { type: "CodeBlue" },
  get_service_request: { sr_number: "311-17323508" },
  get_service_request_list: { sr_numbers: ["311-17323508"] },
};

test("VALID_ARGS covers every advertised tool", () => {
  assert.deepEqual(Object.keys(VALID_ARGS).sort(), TOOLS.map((t) => t.name).sort());
});

for (const [name, args] of Object.entries(VALID_ARGS)) {
  test(`${name} answers its valid call and rejects the same call plus an unknown parameter`, async () => {
    const ok = await callTool(name, args);
    assert.notEqual(ok.isError, true, ok.content[0].text);
    // council_district is a real parameter of the district tools, so they get a
    // different invented one; either way the error must name the rejected key.
    const props = TOOLS.find((t) => t.name === name).inputSchema.properties;
    const invented = "council_district" in props ? "neighborhood_name" : "council_district";
    const bad = await callTool(name, { ...args, [invented]: "10" });
    assert.equal(bad.isError, true, `${name} silently dropped ${invented}: ${bad.content[0].text}`);
    assert.match(bad.content[0].text, new RegExp(`${invented}.*not accept|does not accept '${invented}'`));
  });
}
