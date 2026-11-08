// Reads the files BoardStat publishes every night at https://www.beta.nyc/boardstat/data/
// and keeps them on disk until BoardStat publishes a newer build.
//
// What BoardStat publishes (BoardStat v2/README.md, and the live manifest):
//   manifest.json            build time (`generated_at`), data window, sources, and
//                            `files`: every published file with its size in bytes
//   agg/month_type.parquet   geo_kind, geo_id, year_month, complaint_type, n
//   detail/{cd,cc}/<id>.parquet  one row per request
//   addresses.parquet        address, zip, cd, cc, borough, n
//   boundaries/{cd,cc}.geojson
// All Parquet files are ZSTD-compressed (boardstat_build.py: COMPRESSION zstd).
//
// Parquet is read with hyparquet (https://github.com/hyparam/hyparquet). Its own
// README: "By default, hyparquet supports uncompressed and snappy-compressed parquet
// files. To support ... zstd ... use the hyparquet-compressors package", passed as
// `parquetReadObjects({ file, compressors })`. Local files are opened with
// `asyncBufferFromFile`, which reads only the byte ranges a query needs.
//
// Politeness (engineering standards §6): one request at a time per process, a
// timeout on every request, one bounded retry on 429/503 honoring Retry-After, a
// User-Agent naming this package, and the manifest re-checked at most every
// `manifestTtlMs`. A file is downloaded once per BoardStat build, not per question.
//
// ZIP codes never leave this module: every Parquet read drops any column whose
// name contains "zip" (Noel's decision, 2026-11-07, epic #12).

import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects, parquetSchema } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { retryAfterMs } from "./nyc-311.js";
import { PACKAGE_NAME, USER_AGENT } from "./version.js";

export const DEFAULT_DATA_URL = "https://www.beta.nyc/boardstat/data/";
export const ENV_DATA_URL = "BOARDSTAT_DATA_URL";
export const ENV_CACHE_DIR = "NYC_311_MCP_CACHE_DIR";

/** The parts of manifest.json this package relies on. Checked on every fetch. */
export type BoardStatManifest = {
  generated_at: string;
  window: { start: string; end: string; default_start?: string; first_created?: string; last_created?: string };
  sources: Record<string, { id?: string; name?: string; url?: string; rowsUpdatedAt_iso?: string }>;
  files: Record<string, number>;
  [key: string]: unknown;
};

export type ManifestResult = {
  manifest: BoardStatManifest;
  /** True when beta.nyc could not be reached and a cached build is being served. */
  stale: boolean;
  /** Plain-language reason, set when `stale` is true. */
  warning?: string;
};

export type Logger = (event: string, fields?: Record<string, unknown>) => void;

/** Structured one-line JSON logs to stderr. Never stdout: that is the MCP channel. */
export const stderrLogger: Logger = (event, fields = {}) => {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), pkg: PACKAGE_NAME, event, ...fields }) + "\n");
};

/**
 * Where the cache lives when NYC_311_MCP_CACHE_DIR is not set: the OS cache folder.
 * macOS ~/Library/Caches/nyc-311-mcp; Linux $XDG_CACHE_HOME or ~/.cache; Windows %LOCALAPPDATA%.
 */
export function defaultCacheDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  if (env[ENV_CACHE_DIR]) return path.resolve(env[ENV_CACHE_DIR] as string);
  if (platform === "darwin") return path.join(home, "Library", "Caches", "nyc-311-mcp");
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "nyc-311-mcp", "Cache");
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "nyc-311-mcp");
}

/** The data URL, from BOARDSTAT_DATA_URL or the default. https only, except localhost for testing. */
export function resolveDataUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[ENV_DATA_URL] || DEFAULT_DATA_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ENV_DATA_URL} is not a valid URL: '${raw}'.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`${ENV_DATA_URL} must be an https:// URL (got '${raw}').`);
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

/** Throws unless manifest.json has the shape this package depends on. */
export function validateManifest(value: unknown): BoardStatManifest {
  const m = value as Partial<BoardStatManifest> | null;
  const problems: string[] = [];
  if (!m || typeof m !== "object") problems.push("not a JSON object");
  else {
    if (typeof m.generated_at !== "string" || Number.isNaN(Date.parse(m.generated_at))) problems.push("generated_at");
    if (!m.window || typeof m.window.start !== "string" || typeof m.window.end !== "string") problems.push("window.start/end");
    if (!m.files || typeof m.files !== "object") problems.push("files");
    if (!m.sources || typeof m.sources !== "object") problems.push("sources");
  }
  if (problems.length) {
    throw new Error(`BoardStat manifest.json has an unexpected shape (missing or invalid: ${problems.join(", ")}).`);
  }
  return m as BoardStatManifest;
}

/** A filesystem-safe folder name for one build, e.g. 2026-11-07T10-36-39Z. */
export function buildKey(generatedAt: string): string {
  return generatedAt.replace(/[^0-9A-Za-z]+/g, "-").replace(/-+$/, "");
}

const BUILD_KEY = /^\d{4}-\d{2}-\d{2}T[0-9A-Za-z-]+$/;
const ZIP_COLUMN = /zip/i;

export type BoardStatDataOptions = {
  dataUrl?: string;
  cacheDir?: string;
  fetch?: typeof fetch;
  logger?: Logger;
  /** How long a fetched manifest is trusted before beta.nyc is asked again. Default 1 hour. */
  manifestTtlMs?: number;
  manifestTimeoutMs?: number;
  fileTimeoutMs?: number;
  now?: () => number;
};

type CacheState = { checked_at: number; manifest: BoardStatManifest };

export class BoardStatData {
  readonly dataUrl: string;
  readonly cacheDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly log: Logger;
  private readonly ttl: number;
  private readonly manifestTimeout: number;
  private readonly fileTimeout: number;
  private readonly now: () => number;
  private state: CacheState | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<string>>();

  constructor(opts: BoardStatDataOptions = {}) {
    this.dataUrl = opts.dataUrl ? resolveDataUrl({ [ENV_DATA_URL]: opts.dataUrl }) : resolveDataUrl();
    this.cacheDir = opts.cacheDir ?? defaultCacheDir();
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.log = opts.logger ?? stderrLogger;
    this.ttl = opts.manifestTtlMs ?? 60 * 60 * 1000;
    this.manifestTimeout = opts.manifestTimeoutMs ?? 15_000;
    this.fileTimeout = opts.fileTimeoutMs ?? 120_000;
    this.now = opts.now ?? Date.now;
  }

  /** The URL of BoardStat's site, one level above data/. */
  get siteUrl(): string {
    return new URL("../", this.dataUrl).toString();
  }

  private get statePath() {
    return path.join(this.cacheDir, "manifest-state.json");
  }

  private buildDir(m: BoardStatManifest) {
    return path.join(this.cacheDir, "builds", buildKey(m.generated_at));
  }

  /** Run network work one request at a time, in order. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async request(url: string, timeoutMs: number): Promise<Response> {
    const init: RequestInit = { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) };
    let res = await this.fetchImpl(url, init);
    if (res.status === 429 || res.status === 503) {
      const wait = retryAfterMs(res.headers.get("retry-after"));
      this.log("http_retry", { url, status: res.status, wait_ms: wait });
      await new Promise((r) => setTimeout(r, wait));
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    }
    if (!res.ok) throw new Error(`BoardStat data request failed: HTTP ${res.status} for ${url}`);
    return res;
  }

  private async loadState(): Promise<CacheState | null> {
    if (this.state) return this.state;
    try {
      const raw = JSON.parse(await readFile(this.statePath, "utf8"));
      this.state = { checked_at: Number(raw.checked_at) || 0, manifest: validateManifest(raw.manifest) };
    } catch {
      this.state = null;
    }
    return this.state;
  }

  private async saveState(state: CacheState) {
    await mkdir(this.cacheDir, { recursive: true });
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, this.statePath);
    this.state = state;
  }

  /**
   * The current manifest. Re-asks beta.nyc only after the TTL; switches to a new
   * build only when its `generated_at` is later than the cached one. If beta.nyc
   * cannot be reached, serves the cached build and says so (`stale: true`).
   */
  async manifest(): Promise<ManifestResult> {
    const cached = await this.loadState();
    if (cached && this.now() - cached.checked_at < this.ttl) {
      return { manifest: cached.manifest, stale: false };
    }
    const url = new URL("manifest.json", this.dataUrl).toString();
    let fresh: BoardStatManifest;
    try {
      fresh = await this.serial(async () => validateManifest(await (await this.request(url, this.manifestTimeout)).json()));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (cached) {
        this.log("manifest_stale", { reason, generated_at: cached.manifest.generated_at });
        return {
          manifest: cached.manifest,
          stale: true,
          warning: `Could not reach BoardStat to check for newer data (${reason}). Serving the cached build from ${cached.manifest.generated_at}.`,
        };
      }
      throw new Error(`Could not load BoardStat's manifest.json from ${url}: ${reason}`);
    }

    const keep =
      cached && Date.parse(cached.manifest.generated_at) >= Date.parse(fresh.generated_at) ? cached.manifest : fresh;
    if (keep === fresh && cached?.manifest.generated_at !== fresh.generated_at) {
      this.log("new_build", { generated_at: fresh.generated_at, previous: cached?.manifest.generated_at ?? null });
    }
    await this.saveState({ checked_at: this.now(), manifest: keep });
    if (keep === fresh) await this.pruneBuilds(buildKey(fresh.generated_at));
    return { manifest: keep, stale: false };
  }

  /** Keep the current build folder only. Touches nothing outside <cacheDir>/builds/. */
  private async pruneBuilds(current: string) {
    const root = path.join(this.cacheDir, "builds");
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return;
    }
    for (const name of names) {
      if (name !== current && BUILD_KEY.test(name)) {
        await rm(path.join(root, name), { recursive: true, force: true });
        this.log("pruned_build", { build: name });
      }
    }
  }

  /**
   * Local path to one published file for the current build, downloading it once.
   * Only files the manifest lists can be fetched, and the download must match the
   * size the manifest gives, or it is discarded.
   */
  async file(relPath: string): Promise<{ path: string; manifest: ManifestResult }> {
    const mr = await this.manifest();
    const expected = mr.manifest.files[relPath];
    if (typeof expected !== "number") {
      throw new Error(`BoardStat does not publish '${relPath}' in the current build (${mr.manifest.generated_at}).`);
    }
    const dest = path.join(this.buildDir(mr.manifest), ...relPath.split("/"));
    const have = await stat(dest).catch(() => null);
    if (have && have.size === expected) return { path: dest, manifest: mr };
    if (mr.stale) {
      throw new Error(`${mr.warning} '${relPath}' is not in the cache yet, so it cannot be read until BoardStat is reachable.`);
    }

    let pending = this.inflight.get(dest);
    if (!pending) {
      pending = this.serial(() => this.download(relPath, dest, expected)).finally(() => this.inflight.delete(dest));
      this.inflight.set(dest, pending);
    }
    return { path: await pending, manifest: mr };
  }

  private async download(relPath: string, dest: string, expected: number): Promise<string> {
    const url = new URL(relPath, this.dataUrl).toString();
    const started = this.now();
    const res = await this.request(url, this.fileTimeout);
    if (!res.body) throw new Error(`BoardStat returned an empty body for ${url}`);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.partial`;
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(tmp));
    const got = (await stat(tmp)).size;
    if (got !== expected) {
      await rm(tmp, { force: true });
      throw new Error(`Downloaded ${relPath} is ${got} bytes; BoardStat's manifest says ${expected}. Not cached.`);
    }
    await rename(tmp, dest);
    this.log("file_cached", { file: relPath, bytes: got, ms: this.now() - started });
    return dest;
  }

  /** Column names of a published Parquet file, ZIP columns removed. */
  async columns(relPath: string): Promise<string[]> {
    const { path: p } = await this.file(relPath);
    const md = await parquetMetadataAsync(await asyncBufferFromFile(p));
    return parquetSchema(md)
      .children.map((c) => c.element.name)
      .filter((n) => !ZIP_COLUMN.test(n));
  }

  /**
   * Rows of a published Parquet file as plain objects. 64-bit integers come back
   * as numbers (BoardStat's counts are far below 2^53). ZIP columns are never read.
   */
  async readParquet(
    relPath: string,
    opts: { columns?: string[]; rowStart?: number; rowEnd?: number; filter?: Record<string, unknown> } = {}
  ): Promise<{ rows: Record<string, unknown>[]; manifest: ManifestResult }> {
    const asked = opts.columns?.filter((c) => ZIP_COLUMN.test(c)) ?? [];
    if (asked.length) throw new Error(`ZIP code columns are not available (${asked.join(", ")}).`);
    const { path: p, manifest } = await this.file(relPath);
    const columns = opts.columns ?? (await this.columns(relPath));
    const rows = await parquetReadObjects({
      file: await asyncBufferFromFile(p),
      columns,
      rowStart: opts.rowStart,
      rowEnd: opts.rowEnd,
      // hyparquet's MongoDB-style filter ($eq, $in, $gte, ...). Typed loosely here
      // so callers do not depend on hyparquet's type names.
      filter: opts.filter as never,
      compressors,
    });
    return { rows: rows.map(plainRow), manifest };
  }

  /** A published JSON file (the boundaries GeoJSON). */
  async readJson(relPath: string): Promise<{ value: unknown; manifest: ManifestResult }> {
    const { path: p, manifest } = await this.file(relPath);
    return { value: JSON.parse(await readFile(p, "utf8")), manifest };
  }
}

function plainRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}

/**
 * BoardStat's own address normalization, so a lookup matches its `address`
 * column exactly: `upper(regexp_replace(trim(incident_address), '\s+', ' ', 'g'))`
 * (boardstat_build.py, column `address_norm`). It does NOT turn "5th Ave" into the
 * City's "5 AVENUE"; that is Phase 1 (#14).
 */
export function normalizeAddress(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

export type AddressMatch = { address: string; cd: number; cc: number; borough: string; requests: number };

/**
 * Exact lookup in BoardStat's addresses.parquet, after normalizeAddress. One
 * address string can exist in several boroughs ("100 BROADWAY"), so every match
 * is returned; pass `borough` to narrow. No ZIP code is read or returned.
 */
export async function lookupAddress(
  data: BoardStatData,
  address: string,
  borough?: string
): Promise<{ matches: AddressMatch[]; manifest: ManifestResult }> {
  const norm = normalizeAddress(address);
  const { rows, manifest } = await data.readParquet("addresses.parquet", {
    columns: ["address", "cd", "cc", "borough", "n"],
    filter: { address: { $eq: norm } },
  });
  const want = borough?.trim().toLowerCase();
  const matches = rows
    .filter((r) => !want || String(r.borough).toLowerCase() === want)
    .map((r) => ({
      address: String(r.address),
      cd: Number(r.cd),
      cc: Number(r.cc),
      borough: String(r.borough),
      requests: Number(r.n),
    }))
    .sort((a, b) => b.requests - a.requests);
  return { matches, manifest };
}
