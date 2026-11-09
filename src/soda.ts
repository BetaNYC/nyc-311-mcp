// A small, polite client for one NYC Open Data dataset: the 311 Call Center Inquiry
// dataset (wewp-mm3p), used by ll47_directory_assistance_report (#15).
//
// Built against Socrata's own documentation (engineering standards §0):
//   - Dataset metadata: GET /api/views/<id>.json (columns, rowsUpdatedAt).
//   - Rows: GET /resource/<id>.json with SoQL parameters $select, $where, $group, $order,
//     $limit, $offset (https://dev.socrata.com/docs/queries/). Paging needs a stable
//     $order (https://dev.socrata.com/docs/queries/order, /docs/paging).
//   - Null values are left out of each JSON row, so a missing key means blank.
//   - An app token goes in the X-App-Token header (https://dev.socrata.com/docs/app-tokens).
//     It is optional: SOCRATA_APP_TOKEN, if set.
//   - 429 means throttled, even with a token (https://dev.socrata.com/docs/response-codes).
//
// Politeness (engineering standards §6): one request at a time, at least 2 s between
// request starts, the gap doubled after a 429 (to at most 60 s) and halved back after a
// success, Retry-After honored on 429 and 503 (capped), capped exponential backoff on
// 5xx, a timeout on every request, a User-Agent naming this package, and the fewest
// questions: one $group query per month, cached on disk until the dataset changes.
//
// ZIP codes: this dataset has no ZIP column, and no query here may name one
// (assertNoZipSoql), by decision (#12).

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultCacheDir, stderrLogger, type Logger } from "./boardstat-data.js";
import { retryAfterMs } from "./nyc-311.js";
import { USER_AGENT } from "./version.js";

export const SODA_PORTAL = "https://data.cityofnewyork.us";
export const CALL_CENTER_DATASET = "wewp-mm3p";
export const ENV_APP_TOKEN = "SOCRATA_APP_TOKEN";

/** SOCRATA_APP_TOKEN, checked: unset is fine; set but blank or with spaces is an error. */
export function resolveAppToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[ENV_APP_TOKEN];
  if (raw === undefined) return undefined;
  if (!/^\S+$/.test(raw)) {
    throw new Error(`${ENV_APP_TOKEN} is set but is empty or contains spaces. Unset it, or set it to your Socrata app token.`);
  }
  return raw;
}

/** Throws if any SoQL parameter names a ZIP code (as a column, alias or filter). */
export function assertNoZipSoql(params: Record<string, string>): void {
  for (const [k, v] of Object.entries(params)) {
    if (/zip/i.test(v)) throw new Error(`ZIP codes are not part of any query (found in ${k}).`);
  }
}

export type SodaOptions = {
  portal?: string;
  token?: string;
  fetch?: typeof fetch;
  logger?: Logger;
  /** Least time between request starts. Default 2000 ms (standards §6). */
  minIntervalMs?: number;
  maxIntervalMs?: number;
  /** Per request. Default 120 s: a month's $group query takes about 13 s. */
  timeoutMs?: number;
  maxTries?: number;
  cacheDir?: string;
  /** How long fetched metadata is trusted. Default 1 hour. */
  metadataTtlMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type SodaMetadata = {
  id: string;
  name: string;
  rowsUpdatedAt: number;
  rowsUpdatedAt_iso: string;
  columns: { fieldName: string; dataTypeName: string; description: string | null; non_null: number | null; null: number | null }[];
};

const RETRY_AFTER_CAP_MS = 60_000;

export class SodaClient {
  readonly portal: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly log: Logger;
  private readonly minGap: number;
  private readonly maxGap: number;
  private readonly timeout: number;
  private readonly maxTries: number;
  readonly cacheDir: string;
  private readonly metaTtl: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private gap: number;
  private lastStart: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private meta = new Map<string, { at: number; value: SodaMetadata }>();

  constructor(opts: SodaOptions = {}) {
    this.portal = (opts.portal ?? SODA_PORTAL).replace(/\/+$/, "");
    this.token = opts.token ?? resolveAppToken();
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.log = opts.logger ?? stderrLogger;
    this.minGap = opts.minIntervalMs ?? 2000;
    this.maxGap = Math.max(opts.maxIntervalMs ?? 60_000, this.minGap);
    this.timeout = opts.timeoutMs ?? 120_000;
    this.maxTries = opts.maxTries ?? 4;
    this.cacheDir = opts.cacheDir ?? path.join(defaultCacheDir(), "soda");
    this.metaTtl = opts.metadataTtlMs ?? 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.gap = this.minGap;
  }

  /** One request at a time, in order, for the whole process. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pace() {
    if (this.lastStart !== null) {
      const wait = this.lastStart + this.gap - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastStart = this.now();
  }

  /** The client's clock (injectable for tests). */
  clock(): number {
    return this.now();
  }

  /**
   * GET a JSON document from the portal, politely. `pathname` starts with "/".
   * `deadline` (epoch ms) bounds the whole call, retries and waits included: an
   * interactive tool must answer, not wait four timeouts (QA on #21).
   */
  async getJson(pathname: string, params: Record<string, string> = {}, opts: RequestOpts = {}): Promise<unknown> {
    assertNoZipSoql(params);
    const url = new URL(pathname, this.portal + "/");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
    if (this.token) headers["X-App-Token"] = this.token;
    return this.serial(async () => {
      let lastErr: unknown;
      let tried = 0;
      const left = () => (opts.deadline === undefined ? Infinity : opts.deadline - this.now());
      const tries = opts.maxTries ?? this.maxTries;
      for (let attempt = 1; attempt <= tries; attempt++) {
        if (left() <= 0) throw new DeadlineError(url.pathname, lastErr);
        await this.pace();
        const limit = Math.min(opts.timeoutMs ?? this.timeout, left());
        if (limit <= 0) throw new DeadlineError(url.pathname, lastErr);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(new SodaTimeoutError(limit, url.pathname)), limit);
        let status: number | null = null;
        let retryAfter: string | null = null;
        const started = this.now();
        tried = attempt;
        try {
          const res = await this.fetchImpl(url.toString(), { headers, signal: ac.signal });
          status = res.status;
          retryAfter = res.headers.get("retry-after");
          if (res.ok) {
            const body = await res.json();
            this.gap = Math.max(this.minGap, this.gap / 2);
            return body;
          }
          const text = (await res.text().catch(() => "")).slice(0, 300);
          lastErr = new Error(`NYC Open Data returned HTTP ${res.status} for ${url.pathname}: ${text}`);
          if (res.status !== 429 && res.status < 500) throw lastErr;
        } catch (err) {
          if (status !== null && status !== 429 && status < 500) throw err;
          lastErr = ac.signal.aborted && ac.signal.reason instanceof Error ? ac.signal.reason : err;
        } finally {
          clearTimeout(timer);
        }
        if (status === 429) {
          this.gap = Math.min(this.maxGap, Math.max(this.gap * 2, this.minGap));
          this.log("soda_slow_down", { gap_ms: this.gap });
        }
        if (attempt === tries) break;
        // A request that got no answer in time is not tried again: the portal is overloaded,
        // and a second wait would only double the time before the person hears so.
        if (lastErr instanceof SodaTimeoutError) break;
        if (opts.noRetryAfterMs !== undefined && this.now() - started >= opts.noRetryAfterMs) break;
        const wait =
          (status === 429 || status === 503) && retryAfter
            ? Math.min(RETRY_AFTER_CAP_MS, retryAfterMs(retryAfter))
            : Math.min(60_000, 2 ** attempt * 1000);
        if (wait >= left()) throw new DeadlineError(url.pathname, lastErr);
        this.log("soda_retry", { path: url.pathname, attempt, status, wait_ms: wait });
        await this.sleep(wait);
      }
      throw new Error(`Gave up on NYC Open Data after ${tried === 1 ? "1 try" : `${tried} tries`}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, { cause: lastErr });
    });
  }

  /** Dataset metadata (/api/views/<id>.json), trusted for an hour, and saved to disk. */
  async metadata(id: string, opts: RequestOpts = {}): Promise<SodaMetadata> {
    const hit = this.meta.get(id);
    if (hit && this.now() - hit.at < this.metaTtl) return hit.value;
    const raw = (await this.getJson(`/api/views/${id}.json`, {}, opts)) as Record<string, unknown>;
    const value = validateMetadata(id, raw);
    this.meta.set(id, { at: this.now(), value });
    await this.writeCache(`meta/${id}`, value.rowsUpdatedAt, value);
    return value;
  }

  /**
   * Metadata, or, when the portal cannot be reached, the last copy saved to disk with
   * `stale: true` and a plain warning. Throws only when there is no saved copy either.
   */
  async metadataOrCached(id: string, opts: RequestOpts = {}): Promise<{ meta: SodaMetadata; stale: boolean; warning?: string }> {
    try {
      return { meta: await this.metadata(id, opts), stale: false };
    } catch (err) {
      const saved = await this.readCache<SodaMetadata>(`meta/${id}`);
      if (!saved) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      this.log("soda_stale", { id, reason });
      return {
        meta: saved.value,
        stale: true,
        warning: `NYC Open Data could not be reached (${reason}). Answering from the saved copy, as of ${saved.value.rowsUpdatedAt_iso}.`,
      };
    }
  }

  /**
   * Every row of one SoQL query, paged with $limit/$offset. `params` must include an
   * $order, so pages do not overlap or skip rows.
   */
  async queryAll(id: string, params: Record<string, string>, opts: RequestOpts & { pageSize?: number } = {}): Promise<Record<string, unknown>[]> {
    const pageSize = opts.pageSize ?? 50_000;
    if (!params.$order) throw new Error("A paged SoQL query needs an $order (https://dev.socrata.com/docs/paging).");
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.getJson(`/resource/${id}.json`, { ...params, $limit: String(pageSize), $offset: String(offset) }, opts);
      if (!Array.isArray(page)) throw new Error(`NYC Open Data returned something other than a list of rows for ${id}.`);
      out.push(...(page as Record<string, unknown>[]));
      if (page.length < pageSize) return out;
    }
  }

  private cacheFile(key: string): string {
    if (!/^[A-Za-z0-9/_-]+$/.test(key) || key.includes("..")) throw new Error(`Bad cache key '${key}'.`);
    return path.join(this.cacheDir, ...key.split("/")) + ".json";
  }

  /** A saved result: the dataset version it was computed from, when, and the value. Null if none. */
  async readCache<T>(key: string): Promise<{ version: number; fetched_at_ms: number; value: T } | null> {
    try {
      const raw = JSON.parse(await readFile(this.cacheFile(key), "utf8"));
      const at = Date.parse(raw?.fetched_at);
      if (!raw || typeof raw.version !== "number" || Number.isNaN(at) || !("value" in raw)) return null;
      return { version: raw.version, fetched_at_ms: at, value: raw.value as T };
    } catch {
      return null;
    }
  }

  /** Save a result atomically (a unique temporary name, then rename). */
  async writeCache(key: string, version: number, value: unknown): Promise<void> {
    const file = this.cacheFile(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify({ version, fetched_at: new Date(this.now()).toISOString(), value }));
    await rename(tmp, file);
  }
}

/** The call's time budget ran out before NYC Open Data answered. */
/**
 * Per-call limits: `deadline` (epoch ms) bounds the whole call; `maxTries` and `timeoutMs`
 * override the client's defaults for one call (an interactive report fails fast).
 */
export type RequestOpts = {
  deadline?: number;
  maxTries?: number;
  timeoutMs?: number;
  /** A failed try that took at least this long is not retried: a slow failure is an overloaded portal. */
  noRetryAfterMs?: number;
};

/** How long a wait was, in words: "55 seconds", never a bare five-digit millisecond count. */
export function waitInWords(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  return s === 1 ? "1 second" : `${s} seconds`;
}

/** NYC Open Data sent no answer within the time one request is allowed. Slow, not down. */
export class SodaTimeoutError extends Error {
  constructor(
    readonly waitedMs: number,
    readonly where: string
  ) {
    super(`NYC Open Data sent no answer within ${waitInWords(waitedMs)} (${where}).`);
    this.name = "SodaTimeoutError";
  }
}

/**
 * What went wrong with NYC Open Data, in two kinds the person can act on: "slow" (it was
 * asked and did not answer in time) or "down" (an HTTP 5xx or no connection). Null for
 * anything else, such as a 400, which is our mistake rather than the City's.
 */
export function sodaTrouble(err: unknown): "slow" | "down" | null {
  for (let e: unknown = err, i = 0; e && i < 5; i++) {
    if (e instanceof SodaTimeoutError) return "slow";
    const msg = e instanceof Error ? e.message : String(e);
    if (/HTTP 5\d\d|fetch failed|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(msg) && !(e instanceof DeadlineError)) return "down";
    if (e instanceof DeadlineError) {
      if (!e.last) return "slow";
      e = e.last;
      continue;
    }
    e = e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined;
  }
  return err instanceof DeadlineError ? "slow" : null;
}

/** How long the request that timed out was allowed, if `err` is (or wraps) a SodaTimeoutError. */
export function timedOutAfter(err: unknown): number | null {
  for (let e: unknown = err, i = 0; e && i < 5; i++) {
    if (e instanceof SodaTimeoutError) return e.waitedMs;
    e = e instanceof DeadlineError ? e.last : e instanceof Error ? (e as Error & { cause?: unknown }).cause : undefined;
  }
  return null;
}

export class DeadlineError extends Error {
  constructor(
    readonly where: string,
    readonly last?: unknown
  ) {
    super(
      `Ran out of time waiting for NYC Open Data (${where})` +
        (last instanceof Error ? `; last problem: ${last.message}` : "") +
        ". What was fetched so far is saved; ask again to continue."
    );
    this.name = "DeadlineError";
  }
}

function validateMetadata(id: string, raw: Record<string, unknown>): SodaMetadata {
  const cols = raw?.columns;
  if (!raw || typeof raw.name !== "string" || typeof raw.rowsUpdatedAt !== "number" || !Array.isArray(cols)) {
    throw new Error(`NYC Open Data's metadata for ${id} has an unexpected shape (name, rowsUpdatedAt, columns).`);
  }
  return {
    id,
    name: raw.name,
    rowsUpdatedAt: raw.rowsUpdatedAt,
    rowsUpdatedAt_iso: new Date(raw.rowsUpdatedAt * 1000).toISOString(),
    columns: (cols as Record<string, unknown>[]).map((c) => {
      const cc = (c.cachedContents ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (v === undefined || v === null || Number.isNaN(Number(v)) ? null : Number(v));
      return {
        fieldName: String(c.fieldName),
        dataTypeName: String(c.dataTypeName),
        description: typeof c.description === "string" && c.description ? c.description : null,
        non_null: num(cc.non_null),
        null: num(cc.null),
      };
    }),
  };
}

let sharedSoda: SodaClient | null = null;

/** The one Socrata client this process uses. SOCRATA_APP_TOKEN is checked when it is built. */
export function sodaClient(): SodaClient {
  if (!sharedSoda) sharedSoda = new SodaClient();
  return sharedSoda;
}

/** Tests point the report at a client with a fake fetch. */
export function setSodaClient(c: SodaClient | null): void {
  sharedSoda = c;
}
