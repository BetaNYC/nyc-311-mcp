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
  BoardStatData,
  buildKey,
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

  // An OLDER manifest (a rollback or a stale CDN copy) does not replace the newer cache.
  server.manifest = REAL_MANIFEST;
  clock = 20;
  const { manifest } = await data.manifest();
  assert.equal(manifest.generated_at, "2026-11-08T10:36:39Z");
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

