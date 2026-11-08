#!/usr/bin/env node
// Runs district tools against a LOCAL copy of BoardStat's data folder, with no network.
// Used by scripts/accuracy_check.py. Not part of `npm test`.
//
//   npm run build && echo '[{"name":"top_problems","args":{...}}]' | node scripts/run-district-tools.mjs <boardstat-data-dir>
//
// The data folder is only read. Files are copied into a throwaway cache, exactly as
// they would be downloaded from www.beta.nyc, so the tools run their real code path.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BoardStatData } from "../dist/boardstat-data.js";
import { runDistrictTool } from "../dist/district-tools.js";
import { parseToolArgs } from "../dist/tools.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/run-district-tools.mjs <boardstat-data-dir>  (calls as JSON on stdin)");
  process.exit(2);
}
const BASE = "https://www.beta.nyc/boardstat/data/";
const fetchLocal = async (url) => {
  const rel = String(url).slice(BASE.length);
  const bytes = await readFile(path.join(dir, ...rel.split("/"))).catch(() => null);
  return bytes ? new Response(bytes) : new Response("not found", { status: 404 });
};
const data = new BoardStatData({
  dataUrl: BASE,
  cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-accuracy-")),
  fetch: fetchLocal,
  logger: () => {},
});
let input = "";
for await (const chunk of process.stdin) input += chunk;
const out = [];
for (const call of JSON.parse(input)) {
  try {
    const args = parseToolArgs(call.name, call.args);
    out.push({ name: call.name, ok: true, result: await runDistrictTool(call.name, args, data) });
  } catch (err) {
    out.push({ name: call.name, ok: false, error: String(err?.message ?? err) });
  }
}
process.stdout.write(JSON.stringify(out));
