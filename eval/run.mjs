#!/usr/bin/env node
// Runs eval/questions.json offline against the test fixtures and scores it (#46).
//   npm run build && node eval/run.mjs            print the table
//   npm run build && node eval/run.mjs --record   also write eval/runs/<YYYY-MM-DD>.md
// No network: the district tools read the BoardStat fixture files, how_to_report the recorded
// 311 articles, and the request lookups the recorded 311 Public API answers.
import { readFileSync, writeFileSync } from "node:fs";
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

const DISTRICT = new Set(DISTRICT_TOOLS.map((t) => t.name));
const LL47 = new Set(LL47_TOOLS.map((t) => t.name));

/** The 311 Public API, answered from the recorded calls; a call that was not recorded fails. */
function recordedFetch(url, init = {}) {
  const op = new URL(String(url)).pathname.split("/").pop();
  const nums = op === "GetServiceRequest" ? [new URL(String(url)).searchParams.get("srnumber")] : JSON.parse(init.body ?? "{}").SRNumbers;
  const hit = Object.values(RECORDED).find(
    (r) => r.request.operation === op && JSON.stringify(r.request.sr_numbers) === JSON.stringify(nums)
  );
  if (!hit) throw new Error(`no recorded answer for ${op} ${JSON.stringify(nums)}`);
  return new Response(JSON.stringify(hit.body), { status: hit.http_status });
}

async function answer(tool, args) {
  if (DISTRICT.has(tool)) return runDistrictTool(tool, parseToolArgs(tool, args), (await fixtureData()).data);
  if (LL47.has(tool)) return runLl47Tool(tool, parseToolArgs(tool, args), { data: (await fixtureData()).data });
  if (tool === "how_to_report") return howToReport(parseToolArgs(tool, args), await stressClient());
  if (tool === "get_service_request" || tool === "get_service_request_list") {
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

/** Every answer names a source with an https link and says how current it is. */
export function sourceAndAsOf(body) {
  const text = JSON.stringify(body);
  const link = /"https:\/\/[^"]+"/.test(text);
  const asOf = /"(data_as_of|fetched_at|as_of)":"[^"]+"/.test(text);
  return { ok: link && asOf, why: `link ${link ? "yes" : "no"}, as-of ${asOf ? "yes" : "no"}` };
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
    const out = new URL(`runs/${day}.md`, HERE);
    writeFileSync(out, `# Eval run, ${day}\n\nnyc-311-mcp ${pkg.version} (source at this commit), offline against the test fixtures. Node ${process.version}.\n\n${lines.join("\n")}\n`);
    console.error(`wrote ${fileURLToPath(out)}`);
  }
  process.exit(passed === rows.length ? 0 : 1);
}
