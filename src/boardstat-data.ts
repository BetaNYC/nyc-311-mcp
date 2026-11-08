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
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { Transform } from "node:stream";
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

let tmpCounter = 0;
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
  /**
   * File downloads fail only if NO bytes arrive for this long (an idle timeout,
   * reset on every chunk), so a 28 MB district file on a slow link still
   * completes. Default 30 s. (Before QA round 1 this bounded the whole download.)
   */
  fileTimeoutMs?: number;
  /** After a failed manifest check, how long to serve the cache without asking again. Default 5 minutes. */
  offlineBackoffMs?: number;
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
  private readonly offlineBackoff: number;
  private readonly now: () => number;
  private lastFailure: { at: number; reason: string } | null = null;
  private state: CacheState | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private inflight = new Map<string, Promise<string>>();
  /** Build folders in use (a download or a read in progress), by build key, with a count. */
  private leases = new Map<string, number>();
  /** Old build folders whose pruning waited for a lease to end. */
  private prunePending = new Set<string>();

  constructor(opts: BoardStatDataOptions = {}) {
    this.dataUrl = opts.dataUrl ? resolveDataUrl({ [ENV_DATA_URL]: opts.dataUrl }) : resolveDataUrl();
    this.cacheDir = opts.cacheDir ?? defaultCacheDir();
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.log = opts.logger ?? stderrLogger;
    this.ttl = opts.manifestTtlMs ?? 60 * 60 * 1000;
    this.manifestTimeout = opts.manifestTimeoutMs ?? 15_000;
    this.fileTimeout = opts.fileTimeoutMs ?? 30_000;
    this.offlineBackoff = opts.offlineBackoffMs ?? 5 * 60 * 1000;
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

  /**
   * One GET with a timer that aborts it after `timeoutMs` without progress. The
   * caller must call `idle.clear()` when done, and `idle.touch()` on each chunk
   * of a streamed body.
   */
  private async request(url: string, timeoutMs: number): Promise<{ res: Response; idle: IdleTimer }> {
    const attempt = async () => {
      const idle = new IdleTimer(timeoutMs, url);
      try {
        const res = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: idle.signal });
        return { res, idle };
      } catch (err) {
        idle.clear();
        throw err;
      }
    };
    let { res, idle } = await attempt();
    if (res.status === 429 || res.status === 503) {
      idle.clear();
      const wait = retryAfterMs(res.headers.get("retry-after"));
      this.log("http_retry", { url, status: res.status, wait_ms: wait });
      await new Promise((r) => setTimeout(r, wait));
      ({ res, idle } = await attempt());
    }
    if (!res.ok) {
      idle.clear();
      throw new Error(`BoardStat data request failed: HTTP ${res.status} for ${url}`);
    }
    return { res, idle };
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
    // A name no other writer can share: parallel refreshes in one process, or two
    // processes on one cache folder, each rename their own file (last one wins).
    const tmp = `${this.statePath}.${process.pid}.${++tmpCounter}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(state));
    await rename(tmp, this.statePath);
    this.state = state;
  }

  /**
   * The current manifest. Re-asks beta.nyc only after the TTL (or when `force`
   * is set). Whatever build the server publishes is the build used, newer or
   * older: a rollback on BoardStat's side is followed, not ignored, because files
   * are only ever cached per `generated_at`. If beta.nyc cannot be reached, the
   * cached build answers with `stale: true`, and the network is not tried again
   * for `offlineBackoffMs`.
   */
  async manifest(opts: { force?: boolean } = {}): Promise<ManifestResult> {
    const cached = await this.loadState();
    if (!opts.force && cached && this.now() - cached.checked_at < this.ttl) {
      return { manifest: cached.manifest, stale: false };
    }
    // Single flight: every caller that needs a refresh while one is running waits
    // for that one, instead of asking beta.nyc again and racing on the state file.
    // A forced call may have learned something the running refresh had not (a size
    // mismatch), so it waits for that one to end and then asks again.
    if (opts.force && this.refreshing) await this.refreshing.catch(() => undefined);
    if (!this.refreshing || opts.force) {
      this.refreshing = this.refreshManifest(opts).finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private refreshing: Promise<ManifestResult> | null = null;

  private async refreshManifest(opts: { force?: boolean }): Promise<ManifestResult> {
    const cached = await this.loadState();
    if (!opts.force && cached && this.now() - cached.checked_at < this.ttl) {
      return { manifest: cached.manifest, stale: false };
    }
    const staleResult = (reason: string): ManifestResult => ({
      manifest: (cached as CacheState).manifest,
      stale: true,
      warning: `Could not reach BoardStat to check for newer data (${reason}). Serving the cached build from ${(cached as CacheState).manifest.generated_at}.`,
    });
    if (!opts.force && cached && this.lastFailure && this.now() - this.lastFailure.at < this.offlineBackoff) {
      return staleResult(this.lastFailure.reason);
    }

    const url = new URL("manifest.json", this.dataUrl).toString();
    let fresh: BoardStatManifest;
    try {
      fresh = await this.serial(async () => {
        const { res, idle } = await this.request(url, this.manifestTimeout);
        try {
          return validateManifest(await res.json());
        } finally {
          idle.clear();
        }
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.lastFailure = { at: this.now(), reason };
      if (cached) {
        this.log("manifest_stale", { reason, generated_at: cached.manifest.generated_at });
        return staleResult(reason);
      }
      throw new Error(`Could not load BoardStat's manifest.json from ${url}: ${reason}`);
    }
    this.lastFailure = null;

    const previous = cached?.manifest.generated_at ?? null;
    if (previous !== fresh.generated_at) {
      const older = previous !== null && Date.parse(fresh.generated_at) < Date.parse(previous);
      this.log(older ? "build_rolled_back" : "new_build", { generated_at: fresh.generated_at, previous });
    }
    await this.saveState({ checked_at: this.now(), manifest: fresh });
    if (previous !== fresh.generated_at) await this.pruneBuilds(buildKey(fresh.generated_at));
    return { manifest: fresh, stale: false };
  }

  /** Keep the current build folder only. Touches nothing outside <cacheDir>/builds/. */
  private async pruneBuilds(current: string) {
    const root = path.join(this.cacheDir, "builds");
    // A build in use may not have a folder yet (its download has not started writing),
    // so readdir alone would miss it and leave the folder behind once it is written.
    for (const key of this.leases.keys()) {
      if (key !== current && !this.prunePending.has(key)) {
        this.prunePending.add(key);
        this.log("prune_deferred", { build: key });
      }
    }
    let names: string[];
    try {
      names = await readdir(root);
    } catch {
      return;
    }
    for (const name of names) {
      if (name !== current && BUILD_KEY.test(name)) {
        // A download or read still using this folder would fail mid-way (ENOENT on its
        // rename or its next slice read), so it is removed when the last one finishes.
        if (this.leases.get(name)) continue; // deferred above
        await rm(path.join(root, name), { recursive: true, force: true });
        this.log("pruned_build", { build: name });
      }
    }
  }

  /** Run `fn` while holding the build folder `key`, so pruning leaves it alone until it ends. */
  private async leased<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.leases.set(key, (this.leases.get(key) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      const left = (this.leases.get(key) ?? 1) - 1;
      if (left > 0) this.leases.set(key, left);
      else {
        this.leases.delete(key);
        if (this.prunePending.delete(key) && BUILD_KEY.test(key)) {
          await rm(path.join(this.cacheDir, "builds", key), { recursive: true, force: true });
          this.log("pruned_build", { build: key, deferred: true });
        }
      }
    }
  }

  /**
   * Local path to one published file for the current build, downloading it once.
   * Only files the manifest lists can be fetched, and the download must match the
   * size the manifest gives, or it is discarded. A mismatch usually means BoardStat
   * published a new build since the manifest was last checked, so the manifest is
   * re-read at once (ignoring the TTL) and the download tried one more time.
   */
  async file(relPath: string): Promise<{ path: string; manifest: ManifestResult }> {
    return this.withFile(relPath, async (p, manifest) => ({ path: p, manifest }));
  }

  /**
   * `file()`, then `use` the local path while the build folder is held, so a newer
   * build arriving meanwhile (and pruning the old folder) cannot pull it away mid-read.
   */
  private async withFile<T>(
    relPath: string,
    use: (p: string, mr: ManifestResult) => Promise<T>,
    pinned?: ManifestResult
  ): Promise<T> {
    const mr = pinned ?? (await this.manifest());
    const attempt = (m: ManifestResult) =>
      this.leased(buildKey(m.manifest.generated_at), async () => {
        const { path: p } = await this.fileFor(relPath, m);
        return use(p, m);
      });
    try {
      return await attempt(mr);
    } catch (err) {
      if (!(err instanceof SizeMismatchError)) throw err;
      if (pinned) {
        // One answer must come from one build, so it is not retried on a newer one.
        throw new Error(
          `BoardStat published a new build while this answer was being put together (${relPath} changed since ${pinned.manifest.generated_at}). Ask again to use the new build.`
        );
      }
      const again = await this.manifest({ force: true });
      const unchanged =
        again.manifest.generated_at === mr.manifest.generated_at && again.manifest.files[relPath] === err.expected;
      if (again.stale || unchanged) throw err;
      this.log("retry_after_new_build", { file: relPath, generated_at: again.manifest.generated_at });
      return await attempt(again);
    }
  }

  private async fileFor(relPath: string, mr: ManifestResult): Promise<{ path: string; manifest: ManifestResult }> {
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
    const { res, idle } = await this.request(url, this.fileTimeout);
    const tmp = `${dest}.${process.pid}.partial`;
    try {
      if (!res.body) throw new Error(`BoardStat returned an empty body for ${url}`);
      await mkdir(path.dirname(dest), { recursive: true });
      const progress = new Transform({
        transform(chunk, _enc, cb) {
          idle.touch();
          cb(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
        progress,
        createWriteStream(tmp),
        // The idle timer's signal also ends the stream itself: a server (or fetch
        // implementation) that ignores the request's abort signal cannot stall a download.
        { signal: idle.signal }
      );
    } catch (err) {
      await rm(tmp, { force: true });
      throw idle.signal.aborted && idle.signal.reason instanceof Error ? idle.signal.reason : err;
    } finally {
      idle.clear();
    }
    const got = (await stat(tmp)).size;
    if (got !== expected) {
      await rm(tmp, { force: true });
      throw new SizeMismatchError(relPath, got, expected);
    }
    await rename(tmp, dest);
    this.log("file_cached", { file: relPath, bytes: got, ms: this.now() - started });
    return dest;
  }

  /** Column names of a published Parquet file, ZIP columns removed. */
  async columns(relPath: string, pinned?: ManifestResult): Promise<string[]> {
    return this.withFile(
      relPath,
      async (p) => {
        const md = await parquetMetadataAsync(await asyncBufferFromFile(p));
        return parquetSchema(md)
          .children.map((c) => c.element.name)
          .filter((n) => !ZIP_COLUMN.test(n));
      },
      pinned
    );
  }

  /**
   * A view of this client fixed to one build: every read through it uses the same
   * manifest, so one answer never mixes two builds. A tool takes one per call.
   */
  async pinned(): Promise<PinnedBoardStat> {
    const mr = await this.manifest();
    return {
      siteUrl: this.siteUrl,
      manifest: async () => mr,
      readParquet: (relPath, opts = {}) => this.readParquet(relPath, { ...opts, manifest: mr }),
    };
  }

  /**
   * Rows of a published Parquet file as plain objects. 64-bit integers come back
   * as numbers (BoardStat's counts are far below 2^53). ZIP columns are never read.
   */
  async readParquet(
    relPath: string,
    opts: ReadParquetOptions & { manifest?: ManifestResult } = {}
  ): Promise<{ rows: Record<string, unknown>[]; manifest: ManifestResult }> {
    const asked = opts.columns?.filter((c) => ZIP_COLUMN.test(c)) ?? [];
    if (asked.length) throw new Error(`ZIP code columns are not available (${asked.join(", ")}).`);
    // A filter on a ZIP column would answer a ZIP question without returning the column.
    if (opts.filter !== undefined) assertNoZipFilter(opts.filter);
    const columns = opts.columns ?? (await this.columns(relPath, opts.manifest));
    return this.withFile(relPath, async (p, manifest) => {
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
    }, opts.manifest);
  }

  /** A published JSON file (the boundaries GeoJSON). */
  async readJson(relPath: string): Promise<{ value: unknown; manifest: ManifestResult }> {
    return this.withFile(relPath, async (p, manifest) => ({ value: JSON.parse(await readFile(p, "utf8")), manifest }));
  }
}

export type ReadParquetOptions = { columns?: string[]; rowStart?: number; rowEnd?: number; filter?: Record<string, unknown> };

/** BoardStatData fixed to one build (`BoardStatData.pinned()`). */
export type PinnedBoardStat = {
  readonly siteUrl: string;
  manifest(): Promise<ManifestResult>;
  readParquet(relPath: string, opts?: ReadParquetOptions): Promise<{ rows: Record<string, unknown>[]; manifest: ManifestResult }>;
};

/** Thrown when a download's size disagrees with the manifest. */
export class SizeMismatchError extends Error {
  constructor(
    readonly relPath: string,
    readonly got: number,
    readonly expected: number
  ) {
    super(`Downloaded ${relPath} is ${got} bytes; BoardStat's manifest says ${expected}. Not cached.`);
    this.name = "SizeMismatchError";
  }
}

/** Aborts a request after `ms` with no progress; `touch()` restarts the clock. */
class IdleTimer {
  private readonly ac = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly ms: number,
    private readonly url: string
  ) {
    this.touch();
  }
  get signal(): AbortSignal {
    return this.ac.signal;
  }
  touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.ac.abort(new Error(`BoardStat sent nothing for ${this.ms} ms (${this.url}); request abandoned.`)),
      this.ms
    );
  }
  clear() {
    clearTimeout(this.timer);
  }
}

/**
 * Rejects any filter that names a ZIP column, at any depth ($and / $or / $nor /
 * $not included). Operator keys start with "$"; every other key is a column.
 */
export function assertNoZipFilter(filter: unknown, where = "filter"): void {
  if (Array.isArray(filter)) {
    filter.forEach((f, i) => assertNoZipFilter(f, `${where}[${i}]`));
  } else if (filter && typeof filter === "object") {
    for (const [k, v] of Object.entries(filter)) {
      if (!k.startsWith("$") && ZIP_COLUMN.test(k)) {
        throw new Error(`ZIP code columns are not available, including as a filter ('${k}' at ${where}).`);
      }
      assertNoZipFilter(v, `${where}.${k}`);
    }
  }
}

/**
 * The window to pass to resolvePeriod: from the data start to the day of the
 * newest request (`window.last_created`), not the build date (`window.end`), so
 * "fiscal year to date" says how far the requests actually reach. Falls back to
 * `window.end` for a manifest without `last_created`.
 */
export function dataWindow(m: BoardStatManifest): { start: string; end: string } {
  const last = typeof m.window.last_created === "string" ? m.window.last_created.slice(0, 10) : "";
  return { start: m.window.start, end: /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : m.window.end };
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
