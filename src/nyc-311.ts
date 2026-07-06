const BASE_URL = "https://api.nyc.gov/public/api";

// ─── Auth ────────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.NYC_311_API_KEY;
  if (!key) {
    throw new Error(
      "NYC_311_API_KEY environment variable is not set. Get a key at https://api-portal.nyc.gov/ — register, sign in, and subscribe to the 'NYC 311 Public Developers' product, then set NYC_311_API_KEY to your subscription key (primary or secondary)."
    );
  }
  return key;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CalendarItem = {
  type?: string;
  status?: string;
  exceptionName?: string;
  details?: string;
};

export type CalendarDay = {
  today_id?: string;
  items?: CalendarItem[];
};

export type CalendarResponse = {
  days?: CalendarDay[];
};

// Status and service-request response shapes are not fully documented upstream,
// so they are typed loosely and returned as raw parsed JSON.
export type StatusType =
  | "CodeBlue"
  | "FireHydrant"
  | "OEM"
  | "SnowOnSidewalk"
  | "SnowOnStreet";

// ─── Fetch helpers ─────────────────────────────────────────────────────────────

function buildUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

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

async function errorFromResponse(res: Response): Promise<Error> {
  let bodyText = "";
  try {
    bodyText = (await res.text()).trim();
  } catch {
    // body unreadable; fall through with empty text
  }
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
  init: RequestInit
): Promise<Response> {
  let res = await fetch(url, init);
  if (res.status === 429) {
    // One bounded retry, honoring Retry-After when present.
    await sleep(retryAfterMs(res.headers.get("retry-after")));
    res = await fetch(url, init);
  }
  return res;
}

async function apiGet<T = unknown>(
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const apiKey = getApiKey();
  const res = await fetchWithRetry(buildUrl(path, params), {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T = unknown>(
  path: string,
  body: unknown
): Promise<T> {
  const apiKey = getApiKey();
  const res = await fetchWithRetry(buildUrl(path), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  return res.json() as Promise<T>;
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
}): Promise<CalendarResponse> {
  let fromIso = opts.fromDate;
  let toIso = opts.toDate;

  if (!fromIso && !toIso) {
    const single = opts.date ?? todayIso();
    fromIso = single;
    toIso = single;
  } else {
    // If a range is partially provided, fall back to date / each other.
    fromIso = fromIso ?? opts.date ?? toIso ?? todayIso();
    toIso = toIso ?? opts.date ?? fromIso;
  }

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

  return apiGet<CalendarResponse>("/GetCalendar", {
    fromdate: assertIsoDate(fromIso),
    todate: assertIsoDate(toIso),
  });
}

const STATUS_PATHS: Record<StatusType, string> = {
  CodeBlue: "/Status/CodeBlue",
  FireHydrant: "/Status/FireHydrant",
  OEM: "/Status/OEM",
  SnowOnSidewalk: "/Status/SnowOnSidewalk",
  SnowOnStreet: "/Status/SnowOnStreet",
};

export async function getStatus(type: StatusType): Promise<unknown> {
  return apiGet<unknown>(STATUS_PATHS[type]);
}

export async function getServiceRequest(srNumber: string): Promise<unknown> {
  return apiGet<unknown>("/GetServiceRequest", {
    srnumber: assertSrNumber(srNumber),
  });
}

export async function getServiceRequestList(
  srNumbers: string[]
): Promise<unknown> {
  return apiPost<unknown>("/GetServiceRequestList", {
    SRNumbers: srNumbers.map(assertSrNumber),
  });
}
