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

  /** GET a JSON document from the portal, politely. `pathAndQuery` starts with "/". */
  async getJson(pathname: string, params: Record<string, string> = {}): Promise<unknown> {
    assertNoZipSoql(params);
    const url = new URL(pathname, this.portal + "/");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
    if (this.token) headers["X-App-Token"] = this.token;
    return this.serial(async () => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= this.maxTries; attempt++) {
        await this.pace();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(new Error(`NYC Open Data sent no answer within ${this.timeout} ms (${url.pathname}).`)), this.timeout);
        let status: number | null = null;
        let retryAfter: string | null = null;
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
        if (attempt === this.maxTries) break;
        const wait =
          (status === 429 || status === 503) && retryAfter
            ? Math.min(RETRY_AFTER_CAP_MS, retryAfterMs(retryAfter))
            : Math.min(60_000, 2 ** attempt * 1000);
        this.log("soda_retry", { path: url.pathname, attempt, status, wait_ms: wait });
        await this.sleep(wait);
      }
      throw new Error(`Gave up on NYC Open Data after ${this.maxTries} tries: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
    });
  }

  /** Dataset metadata (/api/views/<id>.json), trusted for an hour. */
  async metadata(id: string): Promise<SodaMetadata> {
    const hit = this.meta.get(id);
    if (hit && this.now() - hit.at < this.metaTtl) return hit.value;
    const raw = (await this.getJson(`/api/views/${id}.json`)) as Record<string, unknown>;
    const value = validateMetadata(id, raw);
    this.meta.set(id, { at: this.now(), value });
    return value;
  }

  /**
   * Every row of one SoQL query, paged with $limit/$offset. `params` must include an
   * $order, so pages do not overlap or skip rows.
   */
  async queryAll(id: string, params: Record<string, string>, pageSize = 50_000): Promise<Record<string, unknown>[]> {
    if (!params.$order) throw new Error("A paged SoQL query needs an $order (https://dev.socrata.com/docs/paging).");
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.getJson(`/resource/${id}.json`, { ...params, $limit: String(pageSize), $offset: String(offset) });
      if (!Array.isArray(page)) throw new Error(`NYC Open Data returned something other than a list of rows for ${id}.`);
      out.push(...(page as Record<string, unknown>[]));
      if (page.length < pageSize) return out;
    }
  }

  /**
   * A cached query result, kept on disk until the dataset's rowsUpdatedAt changes.
   * `key` names the cache file (e.g. "wewp-mm3p/2026-10"); only [A-Za-z0-9/_-].
   */
  async cached<T>(key: string, version: number, compute: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    if (!/^[A-Za-z0-9/_-]+$/.test(key) || key.includes("..")) throw new Error(`Bad cache key '${key}'.`);
    const file = path.join(this.cacheDir, ...key.split("/")) + ".json";
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (raw && raw.version === version) return { value: raw.value as T, cached: true };
    } catch {
      // no cache yet, or unreadable: compute it
    }
    const value = await compute();
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify({ version, fetched_at: new Date(this.now()).toISOString(), value }));
    await rename(tmp, file);
    return { value, cached: false };
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
