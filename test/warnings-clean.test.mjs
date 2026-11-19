// #49 review, round 2 (D): a reason inside a successful answer (a stale-copy warning, a "not
// counted" note, a month that failed) is one clean line: no stack frame, no key, at most 300
// characters. And a 200 that is not JSON gives a plain sentence, never a raw SyntaxError.
// No network: every fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const KEY = "k3y-311-abcdef0123456789";
const TOKEN = "tok-socrata-0123456789";
process.env.NYC_311_API_KEY = KEY;
process.env.SOCRATA_APP_TOKEN = TOKEN;
const { cleanWarning, WARNING_MAX } = await import("../dist/warning-text.js");
const { ContentClient } = await import("../dist/content-311.js");
const { SodaClient } = await import("../dist/soda.js");

const NASTY = () =>
  new Error(
    `socket closed for ${KEY} (token ${encodeURIComponent(TOKEN)})\n    at evil (/Users/x/secret/path.js:1:2)\nsecond line ${TOKEN}`
  );

function assertClean(text) {
  assert.ok(!text.includes(KEY), "the 311 key leaked");
  assert.ok(!text.includes(TOKEN), "the Socrata token leaked");
  assert.ok(!text.includes(encodeURIComponent(TOKEN)), "the token leaked, encoded");
  assert.ok(!text.includes("/Users/x/secret"), "a stack frame leaked");
  assert.ok(!text.includes("second line"), "more than one line");
  assert.doesNotMatch(text, /[\r\n]/);
}

test("cleanWarning: the first line only, keys redacted (plain and encoded), at most 300 characters", () => {
  const w = cleanWarning(NASTY());
  assertClean(w);
  assert.equal(w, "socket closed for [redacted] (token [redacted])");
  assert.equal(WARNING_MAX, 300);
  const long = cleanWarning(new Error(`${"x".repeat(1_000)} ${KEY}`));
  assert.equal([...long].length, 300);
  assert.ok(long.endsWith("…"));
  // A key that sits across the cut is redacted before the cut, so no part of it survives.
  const across = cleanWarning(new Error(`${"y".repeat(290)}${KEY}`));
  assert.ok(!across.includes(KEY.slice(0, 9)), across);
  assert.equal(cleanWarning(null), "unknown error");
  assert.equal(cleanWarning("plain words"), "plain words");
});

test("no answer text in the named files puts a raw err.message into an answer", () => {
  for (const f of ["content-311.ts", "soda.ts", "boardstat-data.ts", "ll47-reports.ts", "draft-report.ts", "how-to-report.ts"]) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\$\{err instanceof Error \? err\.message : String\(err\)\}/, f);
    assert.doesNotMatch(src, /const reason = err instanceof Error \? err\.message/, f);
  }
});

const CATEGORIES = readFileSync(new URL("./fixtures/content/GetCategory.json", import.meta.url), "utf8");

async function contentClient(fetch, clock) {
  return new ContentClient({
    apiKey: () => KEY,
    fetch,
    cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-warn-")),
    minIntervalMs: 0,
    ttlMs: 1_000,
    now: () => clock.t,
    logger: () => {},
  });
}

test("311 content: the stale-copy warning is one clean line", async () => {
  const clock = { t: Date.parse("2026-11-18T12:00:00Z") };
  let fail = false;
  const c = await contentClient(async () => {
    if (fail) throw NASTY();
    return new Response(CATEGORIES, { status: 200 });
  }, clock);
  assert.equal((await c.categories()).stale, false);
  fail = true;
  clock.t += 60_000;
  const got = await c.categories();
  assert.equal(got.stale, true);
  assertClean(got.warning);
  assert.match(got.warning, /^The 311 API could not be reached \(socket closed for \[redacted\] \(token \[redacted\]\)\)\. This uses the copy saved /);
});

test("311 content: a 200 that is not JSON gives the plain sentence", async () => {
  const c = await contentClient(async () => new Response("<html>Service Unavailable</html>", { status: 200 }), { t: Date.now() });
  await assert.rejects(c.categories(), (err) => {
    assert.equal(err.message, "The City's 311 API sent an answer that could not be read (it was not JSON). Try again in a minute.");
    return true;
  });
});

const VIEW = await readFile(new URL("./fixtures/soda/wewp-mm3p/view.json", import.meta.url), "utf8");

async function sodaClient(fetch) {
  return new SodaClient({
    fetch,
    token: TOKEN,
    cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-warn-soda-")),
    minIntervalMs: 0,
    maxTries: 1,
    metadataTtlMs: 0,
    sleep: async () => {},
    logger: () => {},
  });
}

test("NYC Open Data: the stale-copy warning is one clean line", async () => {
  let fail = false;
  const s = await sodaClient(async () => {
    if (fail) throw NASTY();
    return new Response(VIEW, { status: 200 });
  });
  assert.equal((await s.metadataOrCached("wewp-mm3p")).stale, false);
  fail = true;
  const got = await s.metadataOrCached("wewp-mm3p");
  assert.equal(got.stale, true);
  assertClean(got.warning);
  assert.match(got.warning, /^NYC Open Data could not be reached \(Gave up on NYC Open Data after 1 try: socket closed for \[redacted\] \(token \[redacted\]\)\)\. Answering from the saved copy/);
});

test("NYC Open Data: a 200 that is not JSON gives the plain sentence", async () => {
  const s = await sodaClient(async () => new Response("<html>oops</html>", { status: 200 }));
  await assert.rejects(s.metadata("wewp-mm3p"), (err) => {
    assert.equal(err.message, "NYC Open Data sent an answer for /api/views/wewp-mm3p.json that could not be read (it was not JSON). Try again in a minute.");
    return true;
  });
});
