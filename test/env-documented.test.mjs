// Every environment variable the server reads is named in README.md (#49, post-merge check:
// BOARDSTAT_DATA_URL was read but never documented). Finds `process.env.NAME`, `env.NAME` and
// `env[CONST]` where `CONST = "NAME"` in src/, outside comments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const SRC = new URL("../src/", import.meta.url);
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** Read on purpose but not ours to document: the OS's own folders for the default cache path. */
const EXCEPTIONS = new Map([
  ["LOCALAPPDATA", "Windows' own folder; README names the cache path it gives"],
  ["XDG_CACHE_HOME", "Linux's own cache folder setting; README names the cache path it gives"],
]);

function codeOnly(text) {
  // Drop block comments and line comments, so an example in a doc comment does not count.
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function envNamesRead() {
  const names = new Map();
  for (const f of readdirSync(SRC).filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))) {
    const code = codeOnly(readFileSync(new URL(f, SRC), "utf8"));
    const consts = new Map([...code.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([A-Z][A-Z0-9_]*)"/g)].map((m) => [m[1], m[2]]));
    for (const m of code.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) names.set(m[1], f);
    for (const m of code.matchAll(/\benv\[\s*([A-Z][A-Z0-9_]*)\s*\]/g)) {
      assert.ok(consts.has(m[1]), `${f}: env[${m[1]}] uses a constant this test cannot resolve`);
      names.set(consts.get(m[1]), f);
    }
    for (const m of code.matchAll(/\benv\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g)) names.set(m[1], f);
  }
  return names;
}

test("the scan finds the variables we know the server reads", () => {
  const names = envNamesRead();
  for (const n of ["NYC_311_API_KEY", "SOCRATA_APP_TOKEN", "BOARDSTAT_DATA_URL", "NYC_311_MCP_CACHE_DIR"]) assert.ok(names.has(n), n);
});

test("every environment variable read in src/ is named in README.md, or is a named exception", () => {
  const missing = [...envNamesRead()].filter(([n]) => !EXCEPTIONS.has(n) && !README.includes(`\`${n}\``)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(missing, [], `not in README.md: ${missing.join(", ")}`);
});
