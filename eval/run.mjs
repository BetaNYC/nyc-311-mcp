#!/usr/bin/env node
// Runs eval/questions.json offline against the test fixtures and scores it (#46).
//   npm run build && node eval/run.mjs            print the table
//   npm run build && node eval/run.mjs --record   also write eval/runs/<YYYY-MM-DD>.md (-2, -3 ... if taken)
// No network: the district tools read the BoardStat fixture files, how_to_report the recorded
// 311 articles, the request lookups the recorded 311 Public API answers, and get_calendar and
// get_status the offline answers in test/fixtures/api/calendar-and-status.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseToolArgs, callTool } from "../dist/tools.js";
import { runDistrictTool, DISTRICT_TOOLS } from "../dist/district-tools.js";
import { runLl47Tool, LL47_TOOLS } from "../dist/ll47-reports.js";
import { howToReport } from "../dist/how-to-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureData } from "../test/district-fixture.mjs";
import { stressClient } from "../test/stress-client.mjs";

const HERE = new URL("./", import.meta.url);
export const QUESTIONS = JSON.parse(readFileSync(new URL("questions.json", HERE), "utf8")).questions;
const RECORDED = JSON.parse(readFileSync(new URL("../test/fixtures/api/service-requests-2026-11-07.json", HERE), "utf8")).responses;
const CALENDAR_STATUS = JSON.parse(readFileSync(new URL("../test/fixtures/api/calendar-and-status.json", HERE), "utf8")).responses;
const API_TOOLS = new Set(["get_calendar", "get_status", "get_service_request", "get_service_request_list"]);

const DISTRICT = new Set(DISTRICT_TOOLS.map((t) => t.name));
const LL47 = new Set(LL47_TOOLS.map((t) => t.name));

/** The 311 Public API, answered from the recorded calls; a call that was not recorded fails. */
function recordedFetch(url, init = {}) {
  const u = new URL(String(url));
  const op = u.pathname.split("/").pop();
  if (op === "GetCalendar" || u.pathname.includes("/Status/")) {
    const name = op === "GetCalendar" ? "GetCalendar" : `Status/${op}`;
    const params = Object.fromEntries(u.searchParams);
    const hit = Object.values(CALENDAR_STATUS).find(
      (r) => r.request.operation === name && JSON.stringify(r.request.params ?? {}) === JSON.stringify(params)
    );
    if (!hit) throw new Error(`no recorded answer for ${name} ${JSON.stringify(params)}`);
    return new Response(JSON.stringify(hit.body), { status: hit.http_status });
  }
  const nums = op === "GetServiceRequest" ? [new URL(String(url)).searchParams.get("srnumber")] : JSON.parse(init.body ?? "{}").SRNumbers;
  const hit = Object.values(RECORDED).find(
    (r) => r.request.operation === op && JSON.stringify(r.request.sr_numbers) === JSON.stringify(nums)
  );
  if (!hit) throw new Error(`no recorded answer for ${op} ${JSON.stringify(nums)}`);
  return new Response(JSON.stringify(hit.body), { status: hit.http_status });
}

export async function answer(tool, args) {
  if (DISTRICT.has(tool)) return runDistrictTool(tool, parseToolArgs(tool, args), (await fixtureData()).data);
  if (LL47.has(tool)) return runLl47Tool(tool, parseToolArgs(tool, args), { data: (await fixtureData()).data });
  if (tool === "how_to_report") return howToReport(parseToolArgs(tool, args), await stressClient());
  if (API_TOOLS.has(tool)) {
    process.env.NYC_311_API_KEY ||= "eval-key-never-sent";
    const saved = globalThis.fetch;
    globalThis.fetch = async (u, i) => recordedFetch(u, i);
    try {
      const r = await callTool(tool, args);
      if (r.isError) throw new Error(r.content[0].text);
      return JSON.parse(r.content[0].text.slice(0, -SAFETY_LINE.length));
    } finally {
      globalThis.fetch = saved;
    }
  }
  throw new Error(`the eval has no offline route for ${tool}`);
}

const at = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

function check(c, body) {
  const got = at(body, c.path);
  if ("equals" in c) return { ok: got === c.equals, why: `${c.path} = ${JSON.stringify(got)} (want ${JSON.stringify(c.equals)})` };
  if ("includes" in c) return { ok: typeof got === "string" && got.toLowerCase().includes(String(c.includes).toLowerCase()), why: `${c.path} includes ${JSON.stringify(c.includes)}` };
  if ("min" in c) return { ok: typeof got === "number" && got >= c.min, why: `${c.path} = ${got} (want >= ${c.min})` };
  if ("not_null" in c) return { ok: got != null, why: `${c.path} is ${got == null ? "missing" : "set"}` };
  return { ok: false, why: `unknown check ${JSON.stringify(c)}` };
}

const isHttps = (v) => typeof v === "string" && /^https:\/\/[^\s/]+\.[^\s]+$/.test(v);
const filled = (v) => typeof v === "string" && v.trim() !== "";
/** A date that parses and is not in the future (a day of slack for time zones). */
const isDate = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)) && Date.parse(v) <= Date.now() + 86_400_000;

/**
 * Every answer names its source with an https link and says how current it is, in its OWN
 * provenance block: never a link or a date found somewhere else in the answer (a request's
 * portal_url, a row's as_of). The three kinds of block:
 *   - the 311 Public API tools: `provenance` {source, publisher, source_url, as_of, as_of_kind};
 *   - the district and Local Law 47 tools (the envelope): top-level `source.url` and `data_as_of`;
 *   - how_to_report: top-level `source.url` and `source.fetched_at`.
 */
export function sourceAndAsOf(body) {
  const fail = (why) => ({ ok: false, why: `provenance: ${why}` });
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("the answer is not an object");
  const p = body.provenance;
  if (p !== undefined) {
    if (!p || typeof p !== "object") return fail("provenance is not an object");
    if (!filled(p.source) || !filled(p.publisher)) return fail("provenance has no source or publisher");
    if (!isHttps(p.source_url)) return fail(`provenance.source_url is not an https link (${JSON.stringify(p.source_url)})`);
    if (!["retrieved", "source", "snapshot"].includes(p.as_of_kind)) return fail(`provenance.as_of_kind is ${JSON.stringify(p.as_of_kind)}`);
    if (!isDate(p.as_of)) return fail(`provenance.as_of is not a usable date (${JSON.stringify(p.as_of)})`);
    return { ok: true, why: "provenance block: link and as-of" };
  }
  const s = body.source;
  if (!s || typeof s !== "object" || Array.isArray(s)) return fail("no provenance block and no top-level source");
  if (!isHttps(s.url)) return fail(`source.url is not an https link (${JSON.stringify(s.url)})`);
  const asOf = "data_as_of" in body ? body.data_as_of : s.fetched_at;
  if (!isDate(asOf)) return fail(`no usable data_as_of or source.fetched_at (${JSON.stringify(asOf)})`);
  return { ok: true, why: "source block: link and as-of" };
}

export async function runEval() {
  const rows = [];
  for (const q of QUESTIONS) {
    let body;
    let err = null;
    try {
      body = await answer(q.tool, q.args);
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    const results = err ? [{ ok: false, why: `error: ${err}` }] : [...q.checks.map((c) => check(c, body)), sourceAndAsOf(body)];
    rows.push({ id: q.id, q: q.q, tool: q.tool, ok: results.every((r) => r.ok), failed: results.filter((r) => !r.ok).map((r) => r.why) });
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = await runEval();
  const passed = rows.filter((r) => r.ok).length;
  const lines = [
    "| Id | Tool | Result | Question |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.id} | ${r.tool} | ${r.ok ? "pass" : `FAIL: ${r.failed.join("; ")}`} | ${r.q} |`),
    "",
    `${passed} of ${rows.length} passed.`,
  ];
  console.log(lines.join("\n"));
  if (process.argv.includes("--record")) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const pkg = JSON.parse(readFileSync(new URL("../package.json", HERE), "utf8"));
    // Never overwrite an earlier run's record: a second run on the same day gets -2, -3, ...
    let out = new URL(`runs/${day}.md`, HERE);
    for (let n = 2; existsSync(out); n++) out = new URL(`runs/${day}-${n}.md`, HERE);
    writeFileSync(out, `# Eval run, ${day}\n\nnyc-311-mcp ${pkg.version} (source at this commit), offline against the test fixtures. Node ${process.version}.\n\n${lines.join("\n")}\n`);
    console.error(`wrote ${fileURLToPath(out)}`);
  }
  process.exit(passed === rows.length ? 0 : 1);
}
