#!/usr/bin/env node
// Runs ll47_directory_assistance_report against the LIVE NYC Open Data dataset wewp-mm3p,
// politely (one request at a time, 2 s apart, one $group query per month). Not part of
// `npm test`. Used to compare with the City's 311 Reporting dashboards and to record the
// raw responses the unit tests replay.
//
//   npm run build && node scripts/run-call-center-report.mjs '{"month":"2026-10"}' [record-dir]
//
// With record-dir, every raw response body is written there (metadata as view.json,
// each month's rows as <YYYY-MM>.json), so test fixtures are real responses, not guesses.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SodaClient } from "../dist/soda.js";
import { directoryAssistanceReport } from "../dist/ll47-reports.js";
import { parseToolArgs } from "../dist/tools.js";

const args = parseToolArgs("ll47_directory_assistance_report", JSON.parse(process.argv[2] ?? "{}"));
const record = process.argv[3];
if (record) await mkdir(record, { recursive: true });

const recordingFetch = async (url, init) => {
  const res = await fetch(url, init);
  if (!record || !res.ok) return res;
  const body = await res.text();
  const u = new URL(url);
  let name = "view.json";
  if (u.pathname.startsWith("/resource/")) {
    const m = /date >= '(\d{4}-\d{2})-01/.exec(u.searchParams.get("$where") ?? "");
    name = `${m ? m[1] : "query"}${u.searchParams.get("$offset") !== "0" ? `.offset${u.searchParams.get("$offset")}` : ""}.json`;
  }
  await writeFile(path.join(record, name), body);
  return new Response(body, { status: res.status, headers: res.headers });
};

const soda = new SodaClient({
  fetch: recordingFetch,
  cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-soda-")),
});
const started = Date.now();
const env = await directoryAssistanceReport(args, soda);
process.stderr.write(`done in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
process.stdout.write(JSON.stringify(env, null, 2));
