// about_data, the third shared BetaNYC tool (betanyc-ai-workspace platform/system/
// about-data-standard.md): where each kind of data comes from, read from DATA-SOURCES.json.
// How current each source is comes from what this server last fetched and saved (the hooks
// in src/tools.ts), never from a date typed into the file. No network anywhere here: the
// caches are written into temporary folders first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callTool, TOOLS, SHARED_TOOL_LINE, FRESHNESS_HOOKS } from "../dist/tools.js";
import { assertEveryToolExplained, BETANYC_INSTRUCTIONS, parseDataSources } from "../dist/betanyc-tools.js";
import { SERVER_INSTRUCTIONS } from "../dist/instructions.js";
import { BoardStatData } from "../dist/boardstat-data.js";
import { setBoardStatData } from "../dist/district-tools.js";
import { SodaClient, setSodaClient, CALL_CENTER_DATASET } from "../dist/soda.js";
import { ContentClient, setContentClient } from "../dist/content-311.js";
import { BUILT_IN_911_READ } from "../dist/emergency.js";
import { SLA_KEY } from "../dist/draft-report.js";

const DS_TEXT = readFileSync(new URL("../DATA-SOURCES.json", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("./fixtures/boardstat/manifest.json", import.meta.url), "utf8"));
const CITY_META_ISO = "2026-11-12T03:15:00.000Z";
const SLA_DAY = "2024-03-05";
const ARTICLES_AT = "2026-11-10T14:00:00.000Z";

/** A cache folder laid out as the server writes it: BoardStat's state, Socrata's, 311 content's. */
async function seededCache() {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-about-data-"));
  await writeFile(path.join(dir, "manifest-state.json"), JSON.stringify({ checked_at: Date.now(), manifest: MANIFEST }));
  await mkdir(path.join(dir, "soda", "meta"), { recursive: true });
  await mkdir(path.join(dir, "soda", "sla"), { recursive: true });
  const meta = { id: CALL_CENTER_DATASET, name: "311 Call Center Inquiry", rowsUpdatedAt: 1794453300, rowsUpdatedAt_iso: CITY_META_ISO, columns: [] };
  await writeFile(path.join(dir, "soda", "meta", `${CALL_CENTER_DATASET}.json`), JSON.stringify({ version: 1794453300, fetched_at: new Date().toISOString(), value: meta }));
  await writeFile(path.join(dir, "soda", `${SLA_KEY}.json`), JSON.stringify({ version: 1709669453, fetched_at: new Date().toISOString(), value: { rows: [], rows_updated: SLA_DAY } }));
  await mkdir(path.join(dir, "content-311"), { recursive: true });
  await writeFile(path.join(dir, "content-311", "categories.json"), JSON.stringify({ fetched_at: ARTICLES_AT, value: [] }));
  return dir;
}

function useCache(t, dir) {
  const noFetch = async () => { throw new Error("no network in this test"); };
  setBoardStatData(new BoardStatData({ cacheDir: dir, fetch: noFetch, logger: () => {} }));
  setSodaClient(new SodaClient({ cacheDir: path.join(dir, "soda"), fetch: noFetch, logger: () => {} }));
  setContentClient(new ContentClient({ cacheDir: path.join(dir, "content-311"), fetch: noFetch, logger: () => {}, apiKey: () => "unused" }));
  t.after(() => {
    setBoardStatData(null);
    setSodaClient(null);
    setContentClient(null);
  });
}

const bySource = (r) => Object.fromEntries(r.structuredContent.sources.map((s) => [s.topic, s]));

test("every tool says where its data comes from (no tool ships unexplained)", () => {
  assertEveryToolExplained(DS_TEXT, TOOLS.map((t) => t.name));
  // The check really bites: a tool with no source, and a source naming a tool we lack.
  assert.throws(() => assertEveryToolExplained(DS_TEXT, [...TOOLS.map((t) => t.name), "new_tool"]), /new_tool/);
  assert.throws(() => assertEveryToolExplained(DS_TEXT, TOOLS.map((t) => t.name).filter((n) => n !== "get_calendar")), /get_calendar/);
});

test("DATA-SOURCES.json parses with no errors, and every freshness hook it names is wired", () => {
  const parsed = parseDataSources(DS_TEXT);
  assert.deepEqual(parsed.errors, []);
  for (const s of parsed.doc.sources) {
    assert.equal(s.valid, true, s.id);
    if (s.freshness.kind === "hook") assert.equal(typeof FRESHNESS_HOOKS[s.freshness.key], "function", s.id);
    assert.notEqual(s.freshness.kind, "file", `${s.id}: this server has no build file to point at`);
  }
});

test("the server instructions send AI apps to about_data, before the closing safety line", () => {
  assert.ok(SERVER_INSTRUCTIONS.includes(BETANYC_INSTRUCTIONS));
  assert.match(SERVER_INSTRUCTIONS, /call about_data/);
  assert.match(SERVER_INSTRUCTIONS, /call about_betanyc/);
  assert.ok(SERVER_INSTRUCTIONS.indexOf(BETANYC_INSTRUCTIONS) < SERVER_INSTRUCTIONS.indexOf("For informational purposes only."));
  const about = TOOLS.find((t) => t.name === "about_data");
  assert.match(about.description, /Topics on this server: calendar-and-status, service-request-lookup, /);
});

test("about_data for the district tools: BoardStat's build time, the owning agency as publisher, figures not official", async (t) => {
  useCache(t, await seededCache());
  const r = await callTool("about_data", { topic: "district_summary" });
  assert.notEqual(r.isError, true, r.content[0].text);
  const s = bySource(r);
  const d = s["service-requests-by-district"];
  assert.ok(d, Object.keys(s).join(", "));
  assert.equal(d.publisher, "NYC Office of Technology and Innovation (OTI)");
  assert.equal(d.source_url, "https://data.cityofnewyork.us/d/erm2-nwe9");
  assert.equal(d.official, true);
  assert.equal(d.figures_official, false, "BetaNYC placed and counted them");
  assert.deepEqual(d.changed_by_betanyc.steps, ["filtered", "address-matched", "merged", "counted"]);
  assert.equal(d.as_of, MANIFEST.generated_at, "read from the saved manifest");
  assert.equal(d.as_of_status, "read");
  assert.equal(d.coverage.start, "2020-01-01");
  assert.equal(d.report_errors.in_the_data, "https://www.nyc.gov/opendata/contact-us");
  assert.equal(d.report_errors.in_this_server, "https://github.com/BetaNYC/nyc-311-mcp/issues");
  assert.match(d.terms.credit_line, /^BoardStat by BetaNYC/);
  // The boundaries behind the district placement, as of the build's own record of them.
  assert.equal(s["community-district-boundaries"].as_of, MANIFEST.sources.community_districts.rowsUpdatedAt_iso);
  assert.equal(s["council-district-boundaries"].as_of, MANIFEST.sources.council_districts.rowsUpdatedAt_iso);
  const text = r.content[0].text;
  assert.match(text, /not an official NYC Office of Technology and Innovation \(OTI\) report/);
  assert.equal(s["community-district-boundaries"].publisher, "NYC Department of City Planning (DCP)");
  assert.match(text, /Call about_betanyc for who built nyc-311-mcp/);
  assert.ok(text.endsWith(`\n\n${SHARED_TOOL_LINE}`));
});

test("about_data for the calendar: live, passed on unchanged, with its corrections linked", async (t) => {
  useCache(t, await seededCache());
  const r = await callTool("about_data", { topic: "get_calendar" });
  const [c] = r.structuredContent.sources;
  assert.equal(r.structuredContent.sources.length, 1);
  assert.equal(c.topic, "calendar-and-status");
  assert.equal(c.as_of_status, "live");
  assert.equal(c.figures_official, true);
  assert.equal(c.report_errors.in_the_data_email, "api-support@platform.nyc.gov");
  assert.deepEqual(c.corrections.map((x) => x.date), ["2026-07-06", "2026-07-21"]);
  for (const x of c.corrections) assert.ok(x.url.startsWith("https://betanyc.github.io/nyc-311-mcp/whats-changed.html#2026-07-"), x.url);
  assert.equal(r.structuredContent.note, null);
  assert.equal(r.structuredContent.catalog.data_json, "https://betanyc.github.io/nyc-311-mcp/data.json");
  assert.match(r.content[0].text, /Official record: yes, passed on as NYC Office of Technology and Innovation \(OTI\) publishes it\./);
});

test("about_data reads the Socrata and 311 content caches, and the built-in 911 date", async (t) => {
  useCache(t, await seededCache());
  const s = bySource(await callTool("about_data", {}));
  assert.equal(Object.keys(s).length, 10);
  assert.equal(s["call-center-inquiries"].as_of, CITY_META_ISO);
  assert.equal(s["service-level-agreements"].as_of, SLA_DAY);
  assert.equal(s["311-articles"].as_of, ARTICLES_AT);
  assert.equal(s["built-in-911-lines"].as_of, BUILT_IN_911_READ);
  assert.equal(s["built-in-911-lines"].official, false, "BetaNYC's curation");
  assert.equal(s["ll47-service-request-reports"].figures_official, false);
});

test("on a machine that has fetched nothing yet, cached sources say so instead of a date", async (t) => {
  useCache(t, await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-about-data-empty-")));
  const s = bySource(await callTool("about_data", {}));
  for (const id of ["service-requests-by-district", "community-district-boundaries", "call-center-inquiries", "service-level-agreements", "311-articles"]) {
    assert.equal(s[id].as_of_status, "unavailable", `${id}: ${s[id].as_of}`);
    assert.doesNotMatch(s[id].as_of, /\d{4}-\d{2}-\d{2}/, id);
  }
  assert.equal(s["calendar-and-status"].as_of_status, "live");
  assert.equal(s["built-in-911-lines"].as_of, BUILT_IN_911_READ, "shipped with the code, so always known");
});

test("about_data rejects a bad topic by listing the topics", async () => {
  const r = await callTool("about_data", { topic: "parks" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /No data topic or tool named "parks"\. Topics: calendar-and-status/);
  assert.ok(r.content[0].text.endsWith(`\n\n${SHARED_TOOL_LINE}`));
});

test("over stdio, the SDK client accepts about_data for two topics against its output schema", async () => {
  const cache = await seededCache();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env, NYC_311_MCP_CACHE_DIR: cache },
    stderr: "ignore",
  });
  const client = new Client({ name: "about-data-test", version: "0" });
  await client.connect(transport);
  try {
    assert.ok(client.getInstructions().includes(BETANYC_INSTRUCTIONS));
    const district = await client.callTool({ name: "about_data", arguments: { topic: "service-requests-by-district" } });
    assert.equal(district.structuredContent.sources[0].as_of, MANIFEST.generated_at);
    const ll47 = await client.callTool({ name: "about_data", arguments: { topic: "ll47_directory_assistance_report" } });
    assert.deepEqual(ll47.structuredContent.sources.map((x) => [x.topic, x.as_of]), [["call-center-inquiries", CITY_META_ISO]]);
  } finally {
    await client.close();
  }
});

test("DATA-SOURCES.json and data.json ship in the npm package; the site's data.json is the same file", () => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" });
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  for (const f of ["DATA-SOURCES.json", "data.json", "WHATS-CHANGED.md"]) assert.ok(files.includes(f), `${f}: ${files.join(", ")}`);
  assert.ok(!files.includes("croissant.json"), "this repo publishes no data files of its own");
  assert.equal(readFileSync(new URL("../docs/data.json", import.meta.url), "utf8"), readFileSync(new URL("../data.json", import.meta.url), "utf8"));
});
