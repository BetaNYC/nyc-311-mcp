import { USER_AGENT } from "./version.js";

export const BASE_URL = "https://api.nyc.gov/public/api";

// ─── Auth ────────────────────────────────────────────────────────────────────

export function getApiKey(): string {
  const key = process.env.NYC_311_API_KEY;
  if (!key) {
    throw new Error(
      "NYC_311_API_KEY environment variable is not set. Get a key at https://api-portal.nyc.gov/ — register, sign in, and subscribe to the 'NYC 311 Public Developers' product, then set NYC_311_API_KEY to your subscription key (primary or secondary)."
    );
  }
  return key;
}

// ─── Types ───────────────────────────────────────────────────────────────────

// Response shapes are not fully documented upstream, so every endpoint is typed
// loosely and returned as raw parsed JSON. (The calendar result used to carry
// CalendarItem/CalendarDay/CalendarResponse types, but no field was ever read;
// results are only serialized. #9.)
export type StatusType =
  | "CodeBlue"
  | "FireHydrant"
  | "OEM"
  | "SnowOnSidewalk"
  | "SnowOnStreet";

// ─── Fetch helper ──────────────────────────────────────────────────────────────

const MAX_ERROR_BODY_CHARS = 500;
const MAX_RETRY_AFTER_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a Retry-After header (seconds or HTTP-date) into a bounded wait in ms. */
export function retryAfterMs(header: string | null): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      // Delta-seconds form; negative or zero means retry immediately-ish.
      return Math.min(Math.max(seconds, 0) * 1000, MAX_RETRY_AFTER_MS);
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_AFTER_MS);
    }
  }
  return 1000;
}

/**
 * How long the API asked to wait, in seconds: the Retry-After header (seconds or an
 * HTTP-date), else its own body text ("Rate limit is exceeded. Try again in 163 seconds.",
 * seen 2026-11-08). Null when it said nothing.
 */
export function waitSecondsFrom(header: string | null, body: string): number | null {
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n)) return Math.max(0, Math.ceil(n));
    const d = Date.parse(header);
    if (!Number.isNaN(d)) return Math.max(0, Math.ceil((d - Date.now()) / 1000));
  }
  const m = /try again in (\d+) seconds?/i.exec(body);
  return m ? Number(m[1]) : null;
}

/**
 * Rate limits (HTTP 429). The API portal gives no numbers: the "NYC 311 Public Developers"
 * product is "Available for general public with rate limit in place" (read 2026-11-08).
 * A wait the API asks for is honored when it is short; a long one is not waited out (a
 * tool call should not hang for minutes), and the error says how long to wait.
 */
const MAX_429_WAIT_S = 20;
const MAX_429_RETRIES = 2;

export class RateLimitedError extends Error {
  constructor(readonly waitSeconds: number | null) {
    super(
      "The City's 311 API is limiting requests from this API key right now (HTTP 429, too many requests). " +
        (waitSeconds != null ? `It asked to wait about ${waitSeconds} seconds; try again after that. ` : "Wait a minute and try again. ") +
        "The limit counts every program that uses the same NYC_311_API_KEY, so other tools on this machine can use it up."
    );
  }
}

export async function errorFromResponse(res: Response): Promise<Error> {
  let bodyText = "";
  try {
    bodyText = (await res.text()).trim();
  } catch {
    // body unreadable; fall through with empty text
  }
  if (res.status === 429) return new RateLimitedError(waitSecondsFrom(res.headers.get("retry-after"), bodyText));
  if (bodyText.length > MAX_ERROR_BODY_CHARS) {
    bodyText = `${bodyText.slice(0, MAX_ERROR_BODY_CHARS)}… (truncated)`;
  }
  let message = `NYC 311 API error ${res.status}: ${res.statusText}`;
  if (res.status === 401) {
    message +=
      " — authentication failed; check that NYC_311_API_KEY is set to a valid subscription key from https://api-portal.nyc.gov/ (product: 'NYC 311 Public Developers').";
  }
  if (bodyText) {
    message += ` Response body: ${bodyText}`;
  }
  return new Error(message);
}

/**
 * Every request to the 311 Public API (#40): a 30 s timeout, so a hung connection cannot hold a
 * tool call open with no end (the other clients here already had one: content-311.ts 30 s,
 * soda.ts 120 s); the User-Agent naming this package; and one retry on 502, 503 or 504, which
 * honors Retry-After within the same 20 s budget as a 429. No background polling.
 */
export const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_5XX = new Set([502, 503, 504]);

/** A timeout or a network failure, as one plain sentence (no stack, first line of the cause only). */
function plainFetchError(err: unknown): Error {
  const name = (err as { name?: string } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new Error(`The City's 311 API sent no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again in a minute.`);
  }
  const first = (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0].trim();
  return new Error(`Could not reach the City's 311 API (${first}). Check the internet connection and try again in a minute.`);
}

async function fetchOnce(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw plainFetchError(err);
  }
}

/**
 * A successful answer's body, read and parsed inside one try/catch: the 30 s timeout still runs
 * while the body arrives, and a body that is not JSON (an HTML error page sent with a 200) must
 * not surface as a raw SyntaxError. Either ends in a plain sentence.
 */
async function readJson(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw plainFetchError(err);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The City's 311 API sent an answer that could not be read (it was not JSON). Try again in a minute.");
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_429_RETRIES
): Promise<Response> {
  let res = await fetchOnce(url, init);
  let waited = 0;
  let tries5xx = 0;
  for (let attempt = 0; ; attempt++) {
    const limited = res.status === 429;
    if (limited ? attempt >= retries : !(RETRY_5XX.has(res.status) && tries5xx < 1)) break;
    if (!limited) tries5xx++;
    // Honor the wait the API asks for, backing off at least 0.5 s then 1 s; never more
    // than MAX_429_WAIT_S in all. A longer wait is reported, not waited out.
    const asked = waitSecondsFrom(res.headers.get("retry-after"), await res.clone().text().catch(() => ""));
    const wait = Math.max(asked ?? 1, 0.5 * 2 ** attempt);
    if (asked != null && asked > MAX_429_WAIT_S) break;
    if (waited + wait > MAX_429_WAIT_S) break;
    await sleep(wait * 1000);
    waited += wait;
    res = await fetchOnce(url, init);
  }
  return res;
}

/**
 * The one request helper (#9 merged apiGet/apiPost/buildUrl). A `body` makes it
 * a JSON POST; otherwise a GET with `params` as the query string. The request
 * that goes over the wire is unchanged; test/request-shape.test.mjs pins it.
 */
async function apiFetch(
  path: string,
  opts: { params?: Record<string, string>; body?: unknown; retries?: number } = {}
): Promise<unknown> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(key, value);
  }
  const init: RequestInit =
    opts.body === undefined
      ? { headers: { "Ocp-Apim-Subscription-Key": apiKey } }
      : {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(opts.body),
        };
  const res = await fetchWithRetry(url.toString(), init, opts.retries);
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  return readJson(res);
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

// The GetCalendar endpoint expects ISO YYYY-MM-DD dates — the SAME format the
// tool interface uses, so no conversion is needed. NOTE: the response's
// `today_id` field is YYYYMMDD, but the request params are not; passing YYYYMMDD
// returns HTTP 500 "String '...' was not recognized as a valid DateTime".
// (Verified against the live API, 2026-06-22.)
function assertIsoDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date '${date}': expected YYYY-MM-DD format.`);
  }
  return date;
}

// "Today" in New York, not UTC — toISOString() would roll to tomorrow after
// 8pm ET (EDT) / 7pm ET (EST). en-CA formats as YYYY-MM-DD.
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(now);
}

// Service request numbers look like "311-17323508".
const SR_NUMBER_PATTERN = /^311-\d+$/i;

export function assertSrNumber(srNumber: string): string {
  if (!SR_NUMBER_PATTERN.test(srNumber)) {
    throw new Error(
      `Invalid service request number '${srNumber}': expected format '311-XXXXXXXX' (the literal prefix '311-' followed by digits, e.g. '311-17323508').`
    );
  }
  return srNumber;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

// ─── Operations ────────────────────────────────────────────────────────────────

export async function getCalendar(opts: {
  date?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<unknown> {
  // A missing end falls back to `date`, then to the other end, then to today.
  // Same result as the old four-branch ladder for all eight combinations
  // (test/request-shape.test.mjs). Note: the shorter form suggested in #9,
  // `from = from ?? date ?? today`, is NOT equivalent: with only to_date set it
  // would start the range today instead of on to_date.
  const fromIso = opts.fromDate ?? opts.date ?? opts.toDate ?? todayIso();
  const toIso = opts.toDate ?? opts.date ?? fromIso;

  const span = daysBetween(fromIso, toIso);
  if (span < 0) {
    throw new Error(
      `Invalid date range: from_date (${fromIso}) is after to_date (${toIso}).`
    );
  }
  if (span > 90) {
    throw new Error(
      `Date range too large: ${span} days requested, maximum is 90 days.`
    );
  }

  return apiFetch("/GetCalendar", {
    params: { fromdate: assertIsoDate(fromIso), todate: assertIsoDate(toIso) },
  });
}

export async function getStatus(type: StatusType): Promise<unknown> {
  // The StatusType union (and the tool's zod enum) already constrains `type`,
  // so the path is built directly; there is no lookup table to drift (#9).
  return apiFetch(`/Status/${type}`);
}

/**
 * One request by its 311 number. On a rate limit (429) it asks GetServiceRequestList for
 * the same number instead of waiting: the portal documents that each request in that list
 * "is the same as /GetServiceRequest/" (operation api-GetServiceRequestList-post, read
 * 2026-11-08), and in the beta test the list answered while the single lookup was limited.
 */
export async function getServiceRequest(srNumber: string): Promise<unknown> {
  const sr = assertSrNumber(srNumber);
  try {
    return await apiFetch("/GetServiceRequest", { params: { srnumber: sr }, retries: 0 });
  } catch (err) {
    if (!(err instanceof RateLimitedError)) throw err;
  }
  const list = (await getServiceRequestList([sr])) as { SRResponses?: unknown[] } | null;
  const found = list?.SRResponses?.find((r) => (r as { SRNumber?: string })?.SRNumber === sr) ?? list?.SRResponses?.[0];
  if (!found) throw new Error(`NYC 311 API error 404: no service request ${sr} was found.`);
  return found;
}

export async function getServiceRequestList(
  srNumbers: string[]
): Promise<unknown> {
  return apiFetch("/GetServiceRequestList", {
    body: { SRNumbers: srNumbers.map(assertSrNumber) },
  });
}

// ─── Long lists, in batches ────────────────────────────────────────────────────

/**
 * get_service_request_list sends at most this many numbers to GetServiceRequestList per request.
 * The City documents no limit (portal, operation api-GetServiceRequestList-post); 20 keeps each
 * request and its answer small and matches the 20-a-time pages of list_311_categories.
 */
export const SR_BATCH_SIZE = 20;
/** Most different 311 numbers in one get_service_request_list call: 10 batches (owner's decision, #43 review). */
export const MAX_SR_NUMBERS = 200;

export interface SrBatchesResult {
  /** Every request the API returned, in the order the batches were sent. */
  SRResponses: unknown[];
  /** How many numbers the caller gave, duplicates included. */
  asked_for: number;
  /** The different numbers, in the order given: what was (or would have been) sent. */
  unique: string[];
  /** The numbers whose batch was answered (found or not). */
  looked_up: string[];
  /** The numbers never sent, because an earlier batch failed. */
  not_looked_up: string[];
  batches_sent: number;
  batches_needed: number;
  /** Why the lookups stopped early, in plain words; null when every batch was answered. */
  stopped_because: string | null;
}

/**
 * A list of 311 numbers of any length up to MAX_SR_NUMBERS different ones. Duplicates are
 * dropped first and never count toward the cap. Every number is checked, and the cap applied,
 * before anything is sent. Then batches of SR_BATCH_SIZE go out one at a time, never in
 * parallel, each through apiFetch, so the timeout, the 5xx retry and the 429 wait apply to each.
 * A batch the API answers with 404 (none of its numbers found) counts as answered: its numbers
 * are not found. Any other failure stops the lookups at once (a 429 above all: another request
 * would only spend more of the key's limit): what earlier batches got is kept and the rest are
 * listed as not looked up. When the first batch fails nothing was found, so the error is thrown.
 */
export async function getServiceRequestBatches(srNumbers: string[]): Promise<SrBatchesResult> {
  const unique = [...new Set(srNumbers.map(assertSrNumber))];
  if (unique.length > MAX_SR_NUMBERS) {
    throw new Error(
      `get_service_request_list takes at most ${MAX_SR_NUMBERS} different 311 numbers in one call; this list has ${unique.length}. Split it into calls of ${MAX_SR_NUMBERS} or fewer.`
    );
  }
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += SR_BATCH_SIZE) batches.push(unique.slice(i, i + SR_BATCH_SIZE));
  const out: SrBatchesResult = {
    SRResponses: [],
    asked_for: srNumbers.length,
    unique,
    looked_up: [],
    not_looked_up: [],
    batches_sent: 0,
    batches_needed: batches.length,
    stopped_because: null,
  };
  let missed404: Error | null = null;
  for (const [i, batch] of batches.entries()) {
    out.batches_sent++;
    try {
      const raw = (await getServiceRequestList(batch)) as { SRResponses?: unknown } | null;
      if (Array.isArray(raw?.SRResponses)) out.SRResponses.push(...raw.SRResponses);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/ error 404/.test(message) && !(err instanceof RateLimitedError)) {
        missed404 = err instanceof Error ? err : new Error(message);
        out.looked_up.push(...batch);
        continue;
      }
      if (i === 0) throw err;
      out.not_looked_up = batches.slice(i).flat();
      out.stopped_because = message;
      break;
    }
    out.looked_up.push(...batch);
  }
  // Every batch answered 404: the City found none of the numbers. Same error as one 404 call.
  if (missed404 && out.SRResponses.length === 0 && out.not_looked_up.length === 0) throw missed404;
  return out;
}
