// The BoardStat data layer, against real BoardStat files (small slices of the
// 2026-11-07 build, see test/fixtures/build_fixtures.py). No network: a stub
// fetch serves the fixture folder and records every request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoZipFilter,
  BoardStatData,
  buildKey,
  dataWindow,
  defaultCacheDir,
  lookupAddress,
  normalizeAddress,
  resolveDataUrl,
  validateManifest,
} from "../dist/boardstat-data.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "boardstat");
const BASE = "https://www.beta.nyc/boardstat/data/";
const REAL_MANIFEST = JSON.parse(await readFile(path.join(FIX, "manifest.json"), "utf8"));

/** A fake beta.nyc. `overrides` maps a relative path to a function returning a Response. */
function fakeServer({ manifest = REAL_MANIFEST, overrides = {} } = {}) {
  const log = [];
  let active = 0;
  let maxActive = 0;
  const server = {
    log,
    get maxActive() {
      return maxActive;
    },
    manifest,
    fetch: async (url, init = {}) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        const u = String(url);
        assert.ok(u.startsWith(BASE), `request left beta.nyc/boardstat/data: ${u}`);
        const rel = u.slice(BASE.length);
        log.push({ rel, headers: init.headers, hasSignal: init.signal instanceof AbortSignal });
        await new Promise((r) => setTimeout(r, 2));
        if (overrides[rel]) return overrides[rel]();
        if (rel === "manifest.json") return Response.json(server.manifest);
        const bytes = await readFile(path.join(FIX, ...rel.split("/"))).catch(() => null);
        return bytes ? new Response(bytes) : new Response("not found", { status: 404 });
      } finally {
        active -= 1;
      }
    },
  };
  return server;
}

async function freshCache() {
  return mkdtemp(path.join(tmpdir(), "nyc-311-mcp-test-"));
}

function client(server, cacheDir, extra = {}) {
  return new BoardStatData({ dataUrl: BASE, cacheDir, fetch: server.fetch, logger: () => {}, ...extra });
}

test("reads agg/month_type.parquet: the documented columns, ZSTD-compressed", async () => {
  const server = fakeServer();
  const data = client(server, await freshCache());
  const { rows, manifest } = await data.readParquet("agg/month_type.parquet");
  assert.deepEqual(Object.keys(rows[0]), ["geo_kind", "geo_id", "year_month", "complaint_type", "n"]);
  assert.equal(typeof rows[0].n, "number", "INT64 counts come back as numbers, not BigInt");
  assert.deepEqual(new Set(rows.map((r) => r.geo_kind)), new Set(["borough", "cc", "cd", "city"]));
  assert.equal(manifest.manifest.generated_at, "2026-11-07T10:36:39Z");
});

test("reads detail/cd/101.parquet with the published columns, but never incident_zip", async () => {
  const data = client(fakeServer(), await freshCache());
  const cols = await data.columns("detail/cd/101.parquet");
  for (const c of [
    "unique_key", "created_date", "closed_date", "agency", "agency_name", "complaint_type",
    "complaint_type_raw", "descriptor", "status", "incident_address", "bbl", "borough",
    "community_board", "council_district", "latitude", "longitude", "resolution_description",
    "cd", "cc", "city_cd", "days_to_close", "close_flag", "address_norm", "year_month", "is_closed",
  ]) {
    assert.ok(cols.includes(c), `missing column ${c}`);
  }
  assert.ok(!cols.some((c) => /zip/i.test(c)), `a ZIP column leaked: ${cols}`);
  const { rows } = await data.readParquet("detail/cd/101.parquet");
  assert.equal(rows.length, 200);
  assert.ok(rows.every((r) => !("incident_zip" in r)));
  assert.ok(rows[0].created_date instanceof Date);
  assert.ok(rows.every((r) => r.cd === 101));
  // BoardStat writes open requests last; the fixture keeps the file's last 50 rows.
  assert.equal(rows.at(-1).is_closed, false);
});

test("asking for a ZIP column is refused", async () => {
  const data = client(fakeServer(), await freshCache());
  await assert.rejects(data.readParquet("addresses.parquet", { columns: ["address", "zip"] }), /ZIP code columns are not available/);
});

test("reads a whole real district file (cd 484) and the boundaries", async () => {
  const data = client(fakeServer(), await freshCache());
  const { rows } = await data.readParquet("detail/cd/484.parquet", { columns: ["unique_key", "cd", "status"] });
  const listed = REAL_MANIFEST.districts.cd.find((d) => d.id === 484);
  assert.equal(rows.length, listed.rows, "row count matches the manifest's districts entry");
  const { value } = await data.readJson("boundaries/cd.geojson");
  assert.equal(value.type, "FeatureCollection");
  assert.equal(value.features[0].properties.id, 101);
});

test("lookupAddress: exact match after BoardStat's own normalization, no ZIP", async () => {
  const data = client(fakeServer(), await freshCache());
  const { rows } = await data.readParquet("addresses.parquet", { columns: ["address"], rowStart: 0, rowEnd: 1 });
  const known = rows[0].address;
  const messy = `  ${known.toLowerCase().replace(/ /g, "   ")} `;
  const { matches } = await lookupAddress(data, messy);
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].address, known);
  assert.equal(matches[0].cd, 101);
  assert.deepEqual(Object.keys(matches[0]).sort(), ["address", "borough", "cc", "cd", "requests"]);
  const none = await lookupAddress(data, "1 NOWHERE THAT EXISTS");
  assert.deepEqual(none.matches, []);
  const otherBorough = await lookupAddress(data, known, "Queens");
  assert.deepEqual(otherBorough.matches, []);
});

test("normalizeAddress mirrors upper(regexp_replace(trim(x), '\\s+', ' '))", () => {
  assert.equal(normalizeAddress("  34  peck\tslip "), "34 PECK SLIP");
});

test("cache: a file is downloaded once per build; the manifest is re-asked only after the TTL", async () => {
  const server = fakeServer();
  const cacheDir = await freshCache();
  let clock = 1_000_000;
  const data = client(server, cacheDir, { now: () => clock, manifestTtlMs: 60_000 });
  await data.readParquet("agg/month_type.parquet");
  await data.readParquet("agg/month_type.parquet");
  assert.deepEqual(server.log.map((l) => l.rel), ["manifest.json", "agg/month_type.parquet"]);

  // A second process (new client, same cache dir) inside the TTL asks nothing.
  const again = client(server, cacheDir, { now: () => clock, manifestTtlMs: 60_000 });
  await again.readParquet("agg/month_type.parquet");
  assert.equal(server.log.length, 2);

  // After the TTL, the same build: one manifest request, no re-download.
  clock += 61_000;
  await data.readParquet("agg/month_type.parquet");
  assert.deepEqual(server.log.map((l) => l.rel), ["manifest.json", "agg/month_type.parquet", "manifest.json"]);
});

test("cache: a newer build is downloaded and the old build folder is removed", async () => {
  const server = fakeServer();
  const cacheDir = await freshCache();
  let clock = 0;
  const data = client(server, cacheDir, { now: () => clock, manifestTtlMs: 1 });
  await data.file("boundaries/cc.geojson");
  server.manifest = { ...REAL_MANIFEST, generated_at: "2026-11-08T10:36:39Z" };
  clock = 10;
  await data.file("boundaries/cc.geojson");
  assert.equal(server.log.filter((l) => l.rel === "boundaries/cc.geojson").length, 2);
  assert.deepEqual(await readdir(path.join(cacheDir, "builds")), [buildKey("2026-11-08T10:36:39Z")]);

  // A rollback on BoardStat's side (an OLDER generated_at) is followed, not ignored
  // (QA round 1, item 2): the client uses what the server publishes, and its files
  // still read, because the cache is keyed per build.
  server.manifest = REAL_MANIFEST;
  clock = 20;
  const { manifest } = await data.manifest();
  assert.equal(manifest.generated_at, REAL_MANIFEST.generated_at);
  await data.file("boundaries/cc.geojson");
  assert.deepEqual(await readdir(path.join(cacheDir, "builds")), [buildKey(REAL_MANIFEST.generated_at)]);
});

test("cache: when beta.nyc is unreachable, the cached build answers and says it is stale", async () => {
  const server = fakeServer();
  const cacheDir = await freshCache();
  let clock = 0;
  const data = client(server, cacheDir, { now: () => clock, manifestTtlMs: 1 });
  await data.file("agg/month_type.parquet");
  server.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  const offline = client(server, cacheDir, { now: () => (clock = 100), manifestTtlMs: 1 });
  const { manifest } = await offline.readParquet("agg/month_type.parquet", { rowStart: 0, rowEnd: 1 });
  assert.equal(manifest.stale, true);
  assert.match(manifest.warning, /Could not reach BoardStat/);
  await assert.rejects(offline.file("addresses.parquet"), /not in the cache yet/);
});

test("with no cache and no network, the error says so plainly", async () => {
  const data = client({ fetch: async () => { throw new TypeError("fetch failed"); } }, await freshCache());
  await assert.rejects(data.manifest(), /Could not load BoardStat's manifest.json/);
});

test("a download whose size disagrees with the manifest is not cached", async () => {
  const server = fakeServer({ overrides: { "boundaries/cd.geojson": () => new Response("{}") } });
  const cacheDir = await freshCache();
  const data = client(server, cacheDir);
  await assert.rejects(data.file("boundaries/cd.geojson"), /manifest says/);
  const dir = path.join(cacheDir, "builds", buildKey(REAL_MANIFEST.generated_at), "boundaries");
  assert.deepEqual(await readdir(dir), [], "neither the bad file nor a .partial is left behind");
});

test("only files the manifest lists can be fetched (no path tricks)", async () => {
  const server = fakeServer();
  const data = client(server, await freshCache());
  for (const rel of ["../../wp-login.php", "detail/cd/999.parquet", "/etc/passwd"]) {
    await assert.rejects(data.file(rel), /does not publish/);
  }
  assert.deepEqual(server.log.map((l) => l.rel), ["manifest.json"]);
});

test("polite: one request at a time, a timeout on each, and a User-Agent naming the package", async () => {
  const server = fakeServer();
  const data = client(server, await freshCache());
  await Promise.all([
    data.file("agg/month_type.parquet"),
    data.file("addresses.parquet"),
    data.file("boundaries/cd.geojson"),
    data.file("boundaries/cc.geojson"),
    data.file("agg/month_type.parquet"),
  ]);
  assert.equal(server.maxActive, 1, "requests overlapped");
  assert.equal(server.log.filter((l) => l.rel === "agg/month_type.parquet").length, 1, "same file fetched twice");
  for (const l of server.log) {
    assert.equal(l.hasSignal, true);
    assert.match(l.headers["User-Agent"], /^@betanyc\/nyc-311-mcp\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/BetaNYC\/nyc-311-mcp\)$/);
  }
});

test("polite: a 429 is retried once, honoring Retry-After", async () => {
  let n = 0;
  const server = fakeServer({
    overrides: {
      "manifest.json": () =>
        ++n === 1
          ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } })
          : Response.json(REAL_MANIFEST),
    },
  });
  const data = client(server, await freshCache());
  const { manifest } = await data.manifest();
  assert.equal(manifest.generated_at, REAL_MANIFEST.generated_at);
  assert.equal(n, 2);
});

test("a manifest of the wrong shape fails loudly", async () => {
  const server = fakeServer({ manifest: { hello: "world" } });
  const data = client(server, await freshCache());
  await assert.rejects(data.manifest(), /unexpected shape/);
  assert.throws(() => validateManifest({ ...REAL_MANIFEST, generated_at: "yesterday" }), /generated_at/);
});

test("defaultCacheDir: OS cache folders, and the env override wins", () => {
  assert.equal(defaultCacheDir("darwin", {}, "/Users/x"), "/Users/x/Library/Caches/nyc-311-mcp");
  assert.equal(defaultCacheDir("linux", {}, "/home/x"), "/home/x/.cache/nyc-311-mcp");
  assert.equal(defaultCacheDir("linux", { XDG_CACHE_HOME: "/xdg" }, "/home/x"), "/xdg/nyc-311-mcp");
  assert.equal(defaultCacheDir("darwin", { NYC_311_MCP_CACHE_DIR: "/tmp/c" }, "/Users/x"), "/tmp/c");
});

test("resolveDataUrl: https only (localhost excepted), trailing slash added", () => {
  assert.equal(resolveDataUrl({}), BASE);
  assert.equal(resolveDataUrl({ BOARDSTAT_DATA_URL: "https://example.org/data" }), "https://example.org/data/");
  assert.equal(resolveDataUrl({ BOARDSTAT_DATA_URL: "http://localhost:8000/data/" }), "http://localhost:8000/data/");
  assert.throws(() => resolveDataUrl({ BOARDSTAT_DATA_URL: "http://www.beta.nyc/boardstat/data/" }), /https/);
  assert.throws(() => resolveDataUrl({ BOARDSTAT_DATA_URL: "not a url" }), /not a valid URL/);
});


// ─── QA round 1 ──────────────────────────────────────────────────────────────

test("a nightly publish inside the manifest TTL: the size mismatch re-reads the manifest and succeeds", async () => {
  // Client checked build A; BoardStat then published B, where the file's size changed.
  const A = { ...REAL_MANIFEST, files: { ...REAL_MANIFEST.files, "boundaries/cd.geojson": 999 } };
  const server = fakeServer({ manifest: A });
  let clock = 0;
  const data = client(server, await freshCache(), { now: () => clock, manifestTtlMs: 60 * 60 * 1000 });
  await data.manifest();
  server.manifest = REAL_MANIFEST; // build B
  clock = 30 * 60 * 1000; // still inside the TTL
  const { manifest } = await data.file("boundaries/cd.geojson");
  assert.equal(manifest.manifest.files["boundaries/cd.geojson"], REAL_MANIFEST.files["boundaries/cd.geojson"]);
  assert.deepEqual(server.log.map((l) => l.rel), [
    "manifest.json",
    "boundaries/cd.geojson",
    "manifest.json",
    "boundaries/cd.geojson",
  ]);
  // and once more is a cache hit, no network
  await data.file("boundaries/cd.geojson");
  assert.equal(server.log.length, 4);
});

test("ZIP cannot be used through a filter either, at any depth", async () => {
  const data = client(fakeServer(), await freshCache());
  for (const filter of [
    { zip: { $eq: "10004" } },
    { $and: [{ cd: { $eq: 101 } }, { zip: { $eq: "10004" } }] },
    { $or: [{ $nor: [{ incident_zip: { $in: ["10004"] } }] }] },
    { ZIP: { $not: { $eq: "1" } } },
  ]) {
    await assert.rejects(
      data.readParquet("addresses.parquet", { columns: ["address", "cd"], filter }),
      /ZIP code columns are not available/,
      JSON.stringify(filter)
    );
  }
  assert.doesNotThrow(() => assertNoZipFilter({ address: { $eq: "1 ZIPPER LANE" } }));
  const ok = await data.readParquet("addresses.parquet", { columns: ["address", "cd"], filter: { cd: { $eq: 101 } } });
  // 200 top cd 101 addresses, plus the cd 101 rows of Phase 1's spelling cases (build_fixtures.py).
  assert.ok(ok.rows.length >= 200 && ok.rows.every((r) => r.cd === 101), String(ok.rows.length));
});

test("while beta.nyc is down, the network is tried once per backoff window, not on every call", async () => {
  let down = false;
  let attempts = 0;
  const server = fakeServer();
  const real = server.fetch;
  server.fetch = async (u, i) => {
    attempts += 1;
    if (down) throw new TypeError("fetch failed");
    return real(u, i);
  };
  let clock = 0;
  const data = client(server, await freshCache(), { now: () => clock, manifestTtlMs: 1000, offlineBackoffMs: 60_000 });
  await data.manifest();
  down = true;
  attempts = 0;
  clock = 10_000;
  for (let i = 0; i < 5; i++) assert.equal((await data.manifest()).stale, true);
  assert.equal(attempts, 1);
  clock = 80_000; // backoff over
  await data.manifest();
  assert.equal(attempts, 2);
  down = false;
  clock = 150_000;
  assert.equal((await data.manifest()).stale, false);
});

/** A body that sends `chunks` chunks `gapMs` apart, then optionally stalls forever. */
function slowBody(signal, { chunks, gapMs, stall = false }) {
  let sent = 0;
  return new ReadableStream({
    async pull(controller) {
      if (sent === chunks) {
        if (!stall) return controller.close();
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
      }
      await new Promise((r) => setTimeout(r, gapMs));
      sent += 1;
      controller.enqueue(new Uint8Array(10));
    },
  });
}

test("file downloads use an idle timeout: slow but steady completes, a stall is abandoned", async () => {
  const sized = { ...REAL_MANIFEST, files: { ...REAL_MANIFEST.files, "boundaries/cd.geojson": 100 } };
  const steady = fakeServer({ manifest: sized });
  const steadyFetch = steady.fetch;
  steady.fetch = (u, i) =>
    String(u).endsWith("cd.geojson") ? new Response(slowBody(i.signal, { chunks: 10, gapMs: 25 })) : steadyFetch(u, i);
  // 10 chunks x 25 ms = 250 ms in all, well past the 80 ms timeout, but never 80 ms idle.
  await client(steady, await freshCache(), { fileTimeoutMs: 80 }).file("boundaries/cd.geojson");

  const stalled = fakeServer({ manifest: sized });
  const stalledFetch = stalled.fetch;
  stalled.fetch = (u, i) =>
    String(u).endsWith("cd.geojson")
      ? new Response(slowBody(i.signal, { chunks: 2, gapMs: 5, stall: true }))
      : stalledFetch(u, i);
  const cacheDir = await freshCache();
  await assert.rejects(
    client(stalled, cacheDir, { fileTimeoutMs: 80 }).file("boundaries/cd.geojson"),
    /sent nothing for 80 ms/
  );
  const dir = path.join(cacheDir, "builds", buildKey(REAL_MANIFEST.generated_at), "boundaries");
  assert.deepEqual(await readdir(dir), [], "no .partial left behind");
});

test("dataWindow ends at the newest request (last_created), not the build date", () => {
  assert.deepEqual(dataWindow(REAL_MANIFEST), { start: "2020-01-01", end: "2026-11-04" });
  const { last_created, ...w } = REAL_MANIFEST.window;
  assert.deepEqual(dataWindow({ ...REAL_MANIFEST, window: w }), { start: "2020-01-01", end: "2026-11-07" });
});
