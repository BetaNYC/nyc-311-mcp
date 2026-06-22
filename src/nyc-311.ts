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

async function apiGet<T = unknown>(
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const apiKey = getApiKey();
  const res = await fetch(buildUrl(path, params), {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`NYC 311 API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T = unknown>(
  path: string,
  body: unknown
): Promise<T> {
  const apiKey = getApiKey();
  const res = await fetch(buildUrl(path), {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`NYC 311 API error ${res.status}: ${res.statusText}`);
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

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
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
  return apiGet<unknown>("/GetServiceRequest", { srnumber: srNumber });
}

export async function getServiceRequestList(
  srNumbers: string[]
): Promise<unknown> {
  return apiPost<unknown>("/GetServiceRequestList", { SRNumbers: srNumbers });
}
