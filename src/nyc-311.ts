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

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_429_RETRIES
): Promise<Response> {
  let res = await fetch(url, init);
  let waited = 0;
  for (let attempt = 0; res.status === 429 && attempt < retries; attempt++) {
    // Honor the wait the API asks for, backing off at least 0.5 s then 1 s; never more
    // than MAX_429_WAIT_S in all. A longer wait is reported, not waited out.
    const asked = waitSecondsFrom(res.headers.get("retry-after"), await res.clone().text().catch(() => ""));
    const wait = Math.max(asked ?? 1, 0.5 * 2 ** attempt);
    if (asked != null && asked > MAX_429_WAIT_S) break;
    if (waited + wait > MAX_429_WAIT_S) break;
    await sleep(wait * 1000);
    waited += wait;
    res = await fetch(url, init);
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
  return res.json();
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
