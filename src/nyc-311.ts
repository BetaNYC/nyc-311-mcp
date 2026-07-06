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

// Response shapes are not fully documented upstream, so all endpoints are
// typed loosely and returned as raw parsed JSON.
export type StatusType =
  | "CodeBlue"
  | "FireHydrant"
  | "OEM"
  | "SnowOnSidewalk"
  | "SnowOnStreet";

// ─── Fetch helper ──────────────────────────────────────────────────────────────

async function apiFetch(
  path: string,
  opts: { params?: Record<string, string>; body?: unknown } = {}
): Promise<unknown> {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(opts.params ?? {})) {
    url.searchParams.set(key, value);
  }
  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": apiKey,
  };
  let init: RequestInit = { headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init = { ...init, method: "POST", body: JSON.stringify(opts.body) };
  }
  const res = await fetch(url.toString(), init);
  if (!res.ok) {
    throw new Error(`NYC 311 API error ${res.status}: ${res.statusText}`);
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
}): Promise<unknown> {
  const fromIso = opts.fromDate ?? opts.date ?? todayIso();
  const toIso = opts.toDate ?? fromIso;

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
    params: {
      fromdate: assertIsoDate(fromIso),
      todate: assertIsoDate(toIso),
    },
  });
}

export async function getStatus(type: StatusType): Promise<unknown> {
  return apiFetch(`/Status/${type}`);
}

export async function getServiceRequest(srNumber: string): Promise<unknown> {
  return apiFetch("/GetServiceRequest", { params: { srnumber: srNumber } });
}

export async function getServiceRequestList(
  srNumbers: string[]
): Promise<unknown> {
  return apiFetch("/GetServiceRequestList", { body: { SRNumbers: srNumbers } });
}
