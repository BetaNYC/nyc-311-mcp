// The ten district tools (Phase 1, #14; epic #12). Every number is computed the way
// BoardStat's own district page computes it (BoardStat v2/site/js/district.js), over
// the same published files, so an answer can be checked on the page it links to.
//
// How the page counts, and so how these tools count:
//   - A request is in the period when created_date >= start AND created_date < end + 1 day
//     (district.js where()). Dates are New York local time, stored without a zone.
//   - "Not yet closed" is every status other than Closed, including a missing one
//     (NOT_CLOSED_SQL: status IS DISTINCT FROM 'Closed').
//   - Time to close counts only requests marked Closed with a usable close date
//     (CLOSED_DAYS: CASE WHEN status = 'Closed' THEN days_to_close END). The build leaves
//     days_to_close NULL when a request was closed before it was created, or "closed" in
//     the future (boardstat_build.py DAYS_TO_CLOSE_SQL).
//   - Medians are DuckDB's median(): the middle value, or the mean of the two middle values.
//   - "The same days a year earlier" is the same filters with the dates moved back 12
//     months; when the period reaches the newest data, it stops at the same minute a
//     year earlier (district.js renderMonthly).
//   - Days open are counted to the build time, in New York local time (district.js asOfSql).
//   - Borough and city comparisons use whole months from agg/month_type.parquet
//     (district.js renderCompare).

import { z } from "zod";
import { BoardStatData, dataWindow, type BoardStatManifest, type ManifestResult, type PinnedBoardStat } from "./boardstat-data.js";
import { citySpellings, isPlaceholderAddress } from "./address-spelling.js";
import { districtEnvelope, redactZip, type BoardStatLinkFilters, type DistrictEnvelope } from "./envelope.js";
import { SR_NUMBER_NOTE, explainStatus, statusMeanings } from "./service-requests.js";
import { PERIOD_ARG_SHAPE, PERIOD_JSON_PROPERTIES, resolvePeriod, type Period } from "./fiscal-year.js";

// ─── The data client ──────────────────────────────────────────────────────────

let shared: BoardStatData | null = null;

/** The one BoardStat data client this process uses. Built on first use; env is validated then. */
export function boardstatData(): BoardStatData {
  if (!shared) shared = new BoardStatData();
  return shared;
}

/** Tests and scripts point the tools at another client (fixtures, a local copy). */
export function setBoardStatData(data: BoardStatData | null): void {
  shared = data;
}

/** What the tools read through: one build, pinned for the whole call (BoardStatData.pinned()). */
export type Reader = PinnedBoardStat;
export type Source = BoardStatData | PinnedBoardStat;
export const pin = async (src: Source): Promise<Reader> => (src instanceof BoardStatData ? src.pinned() : src);

/** Plain code-unit order, as DuckDB and the BoardStat page sort text (not locale order). */
export const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ─── Districts ────────────────────────────────────────────────────────────────

export type Geo = "cd" | "cc";
export type DistrictEntry = {
  id: number;
  rows: number;
  file: string | null;
  label: string;
  borough: string | null;
  jia?: boolean;
};
export type District = { geo: Geo; id: number; label: string; borough: string | null; file: string; jia: boolean };

export const BOROUGHS = ["Manhattan", "Bronx", "Brooklyn", "Queens", "Staten Island"] as const;

export function manifestDistricts(m: BoardStatManifest): { cd: DistrictEntry[]; cc: DistrictEntry[] } {
  const d = m.districts as { cd?: DistrictEntry[]; cc?: DistrictEntry[] } | undefined;
  if (!d || !Array.isArray(d.cd) || !Array.isArray(d.cc)) {
    throw new Error("BoardStat's manifest.json has no district list (districts.cd / districts.cc), so district tools cannot run.");
  }
  return { cd: d.cd, cc: d.cc };
}

function toId(v: number | string, name: string): number {
  const s = String(v).trim();
  if (!/^\d{1,3}$/.test(s)) throw new Error(`Invalid ${name} '${v}': expected a number such as 101 or 4.`);
  return Number(s);
}

export function resolveDistrict(
  m: BoardStatManifest,
  args: { community_district?: number | string; council_district?: number | string }
): District {
  const hasCd = args.community_district !== undefined;
  const hasCc = args.council_district !== undefined;
  if (hasCd === hasCc) {
    throw new Error(
      "Give exactly one of community_district (e.g. 101 = Manhattan Community District 1) or council_district (1 to 51)."
    );
  }
  const all = manifestDistricts(m);
  const geo: Geo = hasCd ? "cd" : "cc";
  const id = toId((hasCd ? args.community_district : args.council_district) as number | string, hasCd ? "community_district" : "council_district");
  const entry = all[geo].find((e) => Number(e.id) === id);
  if (!entry) {
    if (geo === "cc") throw new Error(`There is no Council District ${id}. Council districts are numbered 1 to 51.`);
    const jias = all.cd.filter((e) => e.jia).map((e) => e.id).join(", ");
    throw new Error(
      `There is no community district ${id} in BoardStat. Community districts are numbered borough digit + district number: ` +
        `Manhattan 101-112, Bronx 201-212, Brooklyn 301-318, Queens 401-414, Staten Island 501-503 ` +
        `(so Brooklyn Community District 6 is 306). Joint Interest Areas (parks and other areas outside every community district): ${jias}.`
    );
  }
  if (!entry.file) throw new Error(`${entry.label} has no requests in BoardStat's data, so there is nothing to count.`);
  return { geo, id, label: entry.label, borough: entry.borough ?? null, file: entry.file, jia: Boolean(entry.jia) };
}

export function districtOut(d: District) {
  return {
    kind: d.geo === "cd" ? (d.jia ? "joint interest area" : "community district") : "council district",
    id: d.id,
    label: d.label,
    borough: d.borough,
  };
}

export function districtCaveats(d: District, m: BoardStatManifest): string[] {
  const out: string[] = [];
  if (d.jia) out.push(`${d.label} is a Joint Interest Area (a park or other area outside every community district), not a community district.`);
  if (d.geo === "cc") {
    const v = (m.sources?.council_districts as { version?: string } | undefined)?.version;
    out.push(
      `Requests are placed in council districts by BoardStat, by where they happened and the current Council district lines${v ? ` (DCP release ${v})` : ""}. ` +
        "This can differ from the council_district the City writes on each request."
    );
  }
  const unloc = (manifestDistricts(m).cd.find((e) => e.id === d.id) as { unlocated_city_assigned?: number } | undefined)
    ?.unlocated_city_assigned;
  if (d.geo === "cd" && unloc) {
    out.push(`${unloc.toLocaleString("en-US")} requests with no usable location are assigned to this district by the City's records; they are not counted here, as on the BoardStat page.`);
  }
  return out;
}

// ─── Dates ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Move a YYYY-MM-DD[ HH:MM:SS] back or forward by whole months, clamping the day as DuckDB does. */
export function shiftMonths(ts: string, months: number): string {
  const y = Number(ts.slice(0, 4));
  const m = Number(ts.slice(5, 7)) - 1 + months;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const d = Math.min(Number(ts.slice(8, 10)), last);
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}${ts.slice(10)}`;
}

/** A New York local date or timestamp as the Date hyparquet returns for BoardStat's zone-less TIMESTAMP. */
export function localAsDate(ts: string): Date {
  return new Date(ts.length === 10 ? `${ts}T00:00:00Z` : `${ts.replace(" ", "T")}Z`);
}

export function fmtLocal(d: unknown): string | null {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 19).replace("T", " ") : null;
}

/** The build time in New York local time, as BoardStat measures "days open" (district.js nycLocal). */
export function nycLocal(iso: string): string {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** The last calendar day with data: the newest request's date, or the window end (district.js lastDataDay). */
export function lastDataDay(m: BoardStatManifest): string {
  const lc = m.window.last_created;
  const d = lc ? lc.slice(0, 10) : m.window.end;
  return d < m.window.end ? d : m.window.end;
}

export const DISTRICT_PERIOD_SHAPE = {
  ...PERIOD_ARG_SHAPE,
  last_days: z.number().int().min(1).max(3660).optional(),
};

const DISTRICT_PERIOD_JSON = {
  ...PERIOD_JSON_PROPERTIES,
  last_days: {
    type: "integer",
    minimum: 1,
    maximum: 3660,
    description:
      "The last N days of data, ending on the day of the newest request (311 data is published with a delay of a few days, so this is not 'until today'). Do not combine with the other date parameters.",
  },
} as const;

type PeriodInput = { from_date?: string; to_date?: string; fiscal_year?: number | string; last_days?: number };

/**
 * One period for a tool. With no dates given, `fallback` decides: "view" is what the
 * BoardStat page opens with (manifest window.default_start to the end), "all" is every
 * request since 2020-01-01.
 */
export function toolPeriod(args: PeriodInput, m: BoardStatManifest, fallback: "view" | "all"): Period {
  // Periods are cut to the newest request's day (dataWindow), not the build date.
  const window = dataWindow(m);
  const extra: string[] = [];
  let period: Period;
  if (args.last_days !== undefined) {
    if (args.from_date !== undefined || args.to_date !== undefined || args.fiscal_year !== undefined) {
      throw new Error("Give last_days on its own, not with from_date, to_date or fiscal_year.");
    }
    const end = lastDataDay(m);
    const start = addDays(end, -(args.last_days - 1));
    period = resolvePeriod({ from_date: start, to_date: end }, window);
    period.label = `the last ${args.last_days} days of data (${period.start} to ${period.end})`;
    extra.push(`"The last ${args.last_days} days" ends on ${end}, the day of the newest request in the data, not today.`);
  } else {
    const fb = fallback === "view" ? { start: m.window.default_start ?? m.window.start, end: window.end } : window;
    period = resolvePeriod(args, window, fb);
    if (args.from_date === undefined && args.to_date === undefined && args.fiscal_year === undefined) {
      period.notes.push(
        fallback === "view"
          ? `No dates were given, so this uses the dates BoardStat's page opens with: ${period.start} to ${period.end}.`
          : `No dates were given, so this covers all of BoardStat's data: ${period.start} to ${period.end}.`
      );
    }
  }
  if (period.end === lastDataDay(m) && m.window.last_created) {
    extra.push(
      `The newest request in the data was created ${m.window.last_created}. The City publishes 311 data with a delay of a few days, so the last day is only partly in.`
    );
  }
  period.notes.push(...extra);
  return period;
}

export function periodOut(p: Period) {
  return { start: p.start, end: p.end, label: p.label, ...(p.fiscal_year !== undefined ? { fiscal_year: p.fiscal_year } : {}) };
}

// ─── Filters ──────────────────────────────────────────────────────────────────

export type Status = "closed" | "not_closed";
const STATUS_TO_BOARDSTAT: Record<Status, string> = { closed: "Closed", not_closed: "not_closed" };

type Filters = {
  problems?: string[];
  descriptions?: string[];
  exclude_descriptions?: boolean;
  agency?: string;
  status?: Status;
};

export type Row = Record<string, unknown>;

const isClosed = (r: Row) => r.status === "Closed";
const descOf = (r: Row) => (r.descriptor == null ? "(none)" : String(r.descriptor));

/** The problem names BoardStat uses (its grouped complaint_type), from the city rows of the month file. */
let typeCache: { build: string; types: string[] } | null = null;
async function problemNames(data: Reader): Promise<string[]> {
  const { manifest } = await data.manifest();
  if (typeCache?.build === manifest.generated_at) return typeCache.types;
  const { rows } = await data.readParquet("agg/month_type.parquet", {
    columns: ["geo_kind", "complaint_type"],
    filter: { geo_kind: { $eq: "city" } },
  });
  const types = [...new Set(rows.map((r) => String(r.complaint_type)))].sort();
  typeCache = { build: manifest.generated_at, types };
  return types;
}

/** Map each requested problem to BoardStat's exact name (case-insensitive), or fail with suggestions. */
export async function canonicalProblems(data: Reader, asked: string[] | undefined): Promise<string[] | undefined> {
  if (!asked?.length) return undefined;
  const names = await problemNames(data);
  const out: string[] = [];
  for (const a of asked) {
    const want = a.trim().toLowerCase();
    const hit = names.find((n) => n.toLowerCase() === want);
    if (hit) {
      if (!out.includes(hit)) out.push(hit);
      continue;
    }
    const words = want.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const close = names.filter((n) => words.some((w) => n.toLowerCase().includes(w))).slice(0, 12);
    throw new Error(
      `'${a}' is not one of BoardStat's problem names.` +
        (close.length ? ` Close matches: ${close.map((c) => `'${c}'`).join(", ")}.` : "") +
        " Some problems are a description under a broader problem: a blocked bike lane is the description 'Blocked Bike Lane' under 'Illegal Parking'."
    );
  }
  return out;
}

/** Canonical descriptions, matched case-insensitively against the requests read (as the page does). */
function canonicalDescriptions(rows: Row[], f: Filters): string[] | undefined {
  if (!f.descriptions?.length) return undefined;
  const scope = f.problems?.length ? rows.filter((r) => f.problems!.includes(String(r.complaint_type))) : rows;
  const counts = new Map<string, number>();
  for (const r of scope) counts.set(descOf(r), (counts.get(descOf(r)) ?? 0) + 1);
  return canonicalDescriptionsCounted(counts, f);
}

/** canonicalDescriptions over counts already taken (description → requests, within the problems asked for). */
function canonicalDescriptionsCounted(counts: Map<string, number>, f: Filters): string[] | undefined {
  if (!f.descriptions?.length) return undefined;
  const out: string[] = [];
  for (const a of f.descriptions) {
    const hit = [...counts.keys()].find((k) => k.toLowerCase() === a.trim().toLowerCase());
    if (!hit) {
      const top = [...counts].sort((x, y) => y[1] - x[1] || byText(x[0], y[0])).slice(0, 15).map(([k]) => `'${redactZip(k)}'`);
      throw new Error(
        `No request${f.problems?.length ? ` for ${f.problems.join(", ")}` : ""} in this district and period has the description '${a}'.` +
          (top.length ? ` The descriptions used are: ${top.join(", ")}.` : "")
      );
    }
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

function canonicalAgency(rows: Row[], agency: string | undefined): string | undefined {
  if (!agency) return undefined;
  const want = agency.trim().toUpperCase();
  const agencies = [...new Set(rows.map((r) => String(r.agency)))];
  if (!agencies.includes(want)) {
    throw new Error(`No request in this district and period was handled by agency '${agency}'. Agencies here: ${agencies.sort().join(", ")}.`);
  }
  return want;
}

/** The predicate for every filter except dates. Descriptions and agency must already be canonical. */
function rowMatcher(f: Filters): (r: Row) => boolean {
  const types = f.problems?.length ? new Set(f.problems) : null;
  const descs = f.descriptions?.length ? new Set(f.descriptions) : null;
  return (r) => {
    if (types && !types.has(String(r.complaint_type))) return false;
    if (f.agency && r.agency !== f.agency) return false;
    if (descs && descs.has(descOf(r)) === Boolean(f.exclude_descriptions)) return false;
    if (f.status === "closed" && !isClosed(r)) return false;
    if (f.status === "not_closed" && isClosed(r)) return false;
    return true;
  };
}

function linkFilters(d: District, p: Period | null, f: Filters): BoardStatLinkFilters {
  return {
    geo: d.geo,
    id: d.id,
    ...(p ? { start: p.start, end: p.end } : {}),
    types: f.problems,
    descs: f.descriptions,
    descExclude: f.exclude_descriptions,
    agency: f.agency,
    status: f.status ? STATUS_TO_BOARDSTAT[f.status] : undefined,
  };
}

// ─── Reading and counting ─────────────────────────────────────────────────────

/** Rows of a district's detail file created in [from, toExclusive), or all of them. */
async function readDetail(
  data: Reader,
  d: District,
  columns: string[],
  range: { from?: Date; toExclusive?: Date; openOnly?: boolean; addresses?: string[] } = {}
): Promise<{ rows: Row[]; manifest: ManifestResult }> {
  const filter: Record<string, unknown> = {};
  const cols = new Set(columns);
  if (range.from || range.toExclusive) {
    filter.created_date = {
      ...(range.from ? { $gte: range.from } : {}),
      ...(range.toExclusive ? { $lt: range.toExclusive } : {}),
    };
    cols.add("created_date");
  }
  if (range.openOnly) {
    filter.is_closed = { $eq: false };
    cols.add("is_closed");
  }
  if (range.addresses) {
    filter.address_norm = { $in: range.addresses };
    cols.add("address_norm");
  }
  return data.readParquet(d.file, { columns: [...cols], filter: Object.keys(filter).length ? filter : undefined });
}

/** The descriptor column only when a description filter needs it: it is the widest text read. */
const descCol = (args: { descriptions?: string[] }) => (args.descriptions?.length ? ["descriptor"] : []);

export function closedDays(r: Row): number | null {
  return isClosed(r) && typeof r.days_to_close === "number" ? r.days_to_close : null;
}

/** DuckDB median(): the middle value, or the mean of the two middle values. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : s[mid - 1] + (s[mid] - s[mid - 1]) / 2;
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Days with one decimal, as the BoardStat page shows them (toFixed(1)). */
export function days1(v: number | null): number | null {
  return v == null ? null : Number(v.toFixed(1));
}

function share(n: number, total: number): number | null {
  return total ? Number((n / total).toFixed(4)) : null;
}

function inPeriod(p: Period) {
  const from = localAsDate(p.start);
  const to = localAsDate(addDays(p.end, 1));
  return (r: Row) => {
    const t = (r.created_date as Date).getTime();
    return t >= from.getTime() && t < to.getTime();
  };
}

/**
 * The "same days a year earlier" window for a period, as the page's monthly chart
 * builds it, or null (with the reason) when the data does not reach back that far.
 */
export function priorWindow(p: Period, m: BoardStatManifest): { from: Date; toExclusive?: Date; toInclusive?: Date; label: string } | { none: string } {
  const startPrior = shiftMonths(p.start, -12);
  if (startPrior < m.window.start) {
    return { none: `The same days a year earlier (from ${startPrior}) start before BoardStat's data (${m.window.start}), so there is no comparison.` };
  }
  const effEnd = p.end < lastDataDay(m) ? p.end : lastDataDay(m);
  const lc = m.window.last_created;
  if (lc && effEnd === lastDataDay(m)) {
    const until = shiftMonths(lc, -12);
    return { from: localAsDate(startPrior), toInclusive: localAsDate(until), label: `${startPrior} to ${until}` };
  }
  const endExcl = shiftMonths(addDays(effEnd, 1), -12);
  return { from: localAsDate(startPrior), toExclusive: localAsDate(endExcl), label: `${startPrior} to ${addDays(endExcl, -1)}` };
}

function inPrior(w: { from: Date; toExclusive?: Date; toInclusive?: Date }) {
  return (r: Row) => {
    const t = (r.created_date as Date).getTime();
    if (t < w.from.getTime()) return false;
    if (w.toExclusive && t >= w.toExclusive.getTime()) return false;
    if (w.toInclusive && t > w.toInclusive.getTime()) return false;
    return true;
  };
}

function countBy<T extends string>(rows: Row[], key: (r: Row) => T): Map<T, Row[]> {
  const m = new Map<T, Row[]>();
  for (const r of rows) {
    const k = key(r);
    let a = m.get(k);
    if (!a) m.set(k, (a = []));
    a.push(r);
  }
  return m;
}

/** List cap: `limit`, and whether more rows were left out. */
export function capped<T>(items: T[], limit: number) {
  return { items: items.slice(0, limit), truncated: items.length > limit, total_items: items.length };
}

// ─── Shared argument shapes ───────────────────────────────────────────────────

export const DISTRICT_SHAPE = {
  community_district: z.union([z.number().int(), z.string()]).optional(),
  council_district: z.union([z.number().int(), z.string()]).optional(),
};
export const DISTRICT_JSON = {
  community_district: {
    type: ["integer", "string"],
    description:
      "BoardStat community district id: borough digit + district number. Manhattan 101-112, Bronx 201-212, Brooklyn 301-318, Queens 401-414, Staten Island 501-503 (Brooklyn Community District 6 is 306). Joint Interest Areas (parks and areas outside every community district): 164, 226, 227, 228, 355, 356, 480-484, 595. Give this or council_district, not both.",
  },
  council_district: {
    type: ["integer", "string"],
    description: "City Council district, 1 to 51. Give this or community_district, not both.",
  },
} as const;

const FILTER_SHAPE = {
  problems: z.array(z.string()).max(20).optional(),
  descriptions: z.array(z.string()).max(20).optional(),
  exclude_descriptions: z.boolean().optional(),
  agency: z.string().optional(),
  status: z.enum(["closed", "not_closed"]).optional(),
};
const FILTER_JSON = {
  problems: {
    type: "array",
    items: { type: "string" },
    description: "BoardStat problem names (its grouped 311 complaint types), e.g. ['HEAT/HOT WATER'] or ['Illegal Parking']. Matched without regard to case.",
  },
  descriptions: {
    type: "array",
    items: { type: "string" },
    description: "311 descriptions (the descriptor field), e.g. ['Blocked Bike Lane'] under 'Illegal Parking'. A missing description is '(none)'.",
  },
  exclude_descriptions: { type: "boolean", description: "If true, leave out the given descriptions instead of keeping only them." },
  agency: { type: "string", description: "Agency code as 311 writes it, e.g. 'NYPD', 'HPD', 'DSNY', 'DOT'." },
  status: {
    type: "string",
    enum: ["closed", "not_closed"],
    description: "'closed' = marked Closed; 'not_closed' = any other status, as BoardStat's 'Not yet closed'.",
  },
} as const;

export const LIMIT = (max: number) => z.number().int().min(1).max(max).optional();
export const LIMIT_JSON = (def: number, max: number) => ({
  type: "integer",
  minimum: 1,
  maximum: max,
  description: `How many rows to list (default ${def}, at most ${max}). The answer says when more were left out.`,
});

const OFFSET_JSON = { type: "integer", minimum: 0, description: "How many rows to skip, for the next page (default 0). Pass next_page.offset, with next_page.data_as_of." } as const;

// Plain-language sentence shared by every description.
const ABOUT =
  "Read from files built nightly from NYC Open Data by BoardStat (BetaNYC; 311 requests from 2020 on), so the numbers match the BoardStat page it links to. It is not an official City report. 311 counts are reports, not problems, and 'closed' does not mean fixed.";

// ─── 1. find_district ─────────────────────────────────────────────────────────

const FIND_SHAPE = {
  address: z.string().min(1).max(200),
  borough: z.enum(BOROUGHS).optional(),
};

type AddressHit = { address: string; borough: string; cd: number; cc: number; requests: number };

async function findAddress(data: Reader, address: string, borough?: string) {
  const sp = citySpellings(address);
  if (!sp.spellings.length) {
    throw new Error(
      "That address has no street name once a ZIP code or city is set aside, only a house number. Give the street too, for example '350 5th Ave'."
    );
  }
  const { rows, manifest } = await data.readParquet("addresses.parquet", {
    columns: ["address", "cd", "cc", "borough", "n"],
    filter: { address: { $in: sp.spellings } },
  });
  // addresses.parquet has one row per address and ZIP code; the ZIP is never read, so
  // rows that differ only by ZIP are added together here.
  const collect = (only?: string) => {
    const merged = new Map<string, AddressHit>();
    for (const r of rows) {
      if (only && String(r.borough) !== only) continue;
      const key = `${r.address}|${r.borough}|${r.cd}|${r.cc}`;
      const prev = merged.get(key);
      if (prev) prev.requests += Number(r.n);
      else merged.set(key, { address: String(r.address), borough: String(r.borough), cd: Number(r.cd), cc: Number(r.cc), requests: Number(r.n) });
    }
    return [...merged.values()].sort((a, b) => b.requests - a.requests || byText(a.address, b.address));
  };
  // A borough the person named in the address ("… Ave, Brooklyn") narrows the match,
  // unless nothing is there, in which case every borough is shown.
  let hits = collect(borough ?? sp.borough_hint ?? undefined);
  let boroughFromText: string | null = !borough && sp.borough_hint ? sp.borough_hint : null;
  if (!hits.length && boroughFromText) {
    hits = collect();
    boroughFromText = null;
  }
  return { spelling: sp, hits, manifest, boroughFromText };
}

/** Closest City spellings when nothing matched: same house number and first street word, BoardStat-style prefix search. */
async function suggestAddresses(data: Reader, spelling: string, borough?: string) {
  const words = spelling.split(" ");
  const prefix = /^\d/.test(words[0]) && words.length > 1 ? `${words[0]} ${words[1].slice(0, 1)}` : words.slice(0, 2).join(" ");
  if (prefix.length < 3) return [];
  const { rows } = await data.readParquet("addresses.parquet", {
    columns: ["address", "borough", "n"],
    filter: { address: { $gte: prefix, $lt: `${prefix}￿` } },
  });
  const sum = new Map<string, number>();
  for (const r of rows) {
    if (borough && r.borough !== borough) continue;
    if (isPlaceholderAddress(String(r.address))) continue;
    const k = `${r.address}|${r.borough}`;
    sum.set(k, (sum.get(k) ?? 0) + Number(r.n));
  }
  const want = new Set(words.slice(1));
  return [...sum]
    .map(([k, n]) => {
      const [address, b] = k.split("|");
      const overlap = address.split(" ").slice(1).filter((w) => want.has(w)).length;
      return { address, borough: b, requests: n, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || b.requests - a.requests)
    .slice(0, 5)
    .map(({ address, borough: b, requests }) => ({ address: redactZip(address), borough: b, requests }));
}

function label(m: BoardStatManifest, geo: Geo, id: number): string {
  return manifestDistricts(m)[geo].find((e) => e.id === id)?.label ?? `${geo.toUpperCase()} ${id}`;
}

export async function findDistrict(src: Source, args: z.infer<z.ZodObject<typeof FIND_SHAPE>>) {
  const data = await pin(src);
  const { spelling, hits, manifest, boroughFromText } = await findAddress(data, args.address, args.borough);
  const m = manifest.manifest;
  const caveats = [
    "This looks the address up in the list of addresses that appear in 311 requests since 2020, as the City spelled them. It is not a geocoder: an address with no 311 request is not in the list.",
    "The district is where BoardStat placed most requests at this address, using today's boundary lines.",
  ];
  if (spelling.ignored_text) caveats.push(`Ignored '${spelling.ignored_text}' (a city, borough or state name, or the part after a comma).`);
  if (boroughFromText) caveats.push(`Only ${boroughFromText} was searched, because the address named it.`);
  if (spelling.dropped_zip) caveats.push("A ZIP code was ignored. This server does not use ZIP codes.");
  const distinctSpellings = [...new Set(hits.map((h) => h.address))];
  if (distinctSpellings.length > 1) {
    caveats.push(`The City spells this address more than one way (${distinctSpellings.map(redactZip).join("; ")}). BoardStat treats each spelling as a separate address.`);
  }
  const matches = hits.map((h) => ({
    address: redactZip(h.address),
    borough: h.borough,
    community_district: { id: h.cd, label: label(m, "cd", h.cd) },
    council_district: { id: h.cc, label: label(m, "cc", h.cc) },
    requests_at_this_address: h.requests,
  }));
  let suggestions: { address: string; borough: string; requests: number }[] = [];
  let message: string;
  if (matches.length) {
    const boroughs = new Set(hits.map((h) => h.borough));
    message =
      boroughs.size > 1 && !args.borough && !boroughFromText
        ? `This address exists in ${boroughs.size} boroughs (${[...boroughs].join(", ")}). Give a borough to pick one.`
        : `Found as ${distinctSpellings.map(redactZip).join(" and ")}.`;
  } else {
    suggestions = await suggestAddresses(data, spelling.spellings[0], args.borough);
    message =
      `No 311 request in BoardStat's data uses this address as the City spells it (tried: ${spelling.spellings.join("; ")}). ` +
      (suggestions.length ? "These City spellings are close; check one is the right place before using it." : "Try the City's spelling, for example 5 AVENUE or WEST 4 STREET.");
  }
  const first = hits[0];
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: first && new Set(hits.map((h) => h.cd)).size === 1 ? { geo: "cd", id: first.cd } : {},
    data: { query_spellings: spelling.spellings, found: matches.length > 0, message, matches, suggestions },
    extraCaveats: caveats,
  });
}

// ─── 2. district_summary ──────────────────────────────────────────────────────

const SUMMARY_SHAPE = { ...DISTRICT_SHAPE, ...DISTRICT_PERIOD_SHAPE, limit: LIMIT(50) };

type AggPair = [kind: string, id: string | null];

/** Month-file counts by problem for each (geo_kind, geo_id), whole months ymStart..ymEnd. */
async function aggCounts(data: Reader, ymStart: string, ymEnd: string, pairs: AggPair[]) {
  const out = new Map<string, Map<string, number>>();
  for (const [kind, id] of pairs) {
    const filter: Record<string, unknown> = { geo_kind: { $eq: kind }, year_month: { $gte: ymStart, $lte: ymEnd } };
    if (id !== null) filter.geo_id = { $eq: id };
    const { rows } = await data.readParquet("agg/month_type.parquet", { columns: ["geo_kind", "geo_id", "year_month", "complaint_type", "n"], filter });
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r.complaint_type), (m.get(String(r.complaint_type)) ?? 0) + Number(r.n));
    out.set(kind, m);
  }
  return out;
}

const total = (m: Map<string, number> | undefined) => [...(m?.values() ?? [])].reduce((a, b) => a + b, 0);

export async function districtSummary(src: Source, args: z.infer<z.ZodObject<typeof SUMMARY_SHAPE>>) {
  const data = await pin(src);
  const mr = await data.manifest();
  const m = mr.manifest;
  const d = resolveDistrict(m, args);
  const p = toolPeriod(args, m, "view");
  const limit = args.limit ?? 10;
  const { rows, manifest } = await readDetail(data, d, ["complaint_type", "status", "days_to_close"], {
    from: localAsDate(p.start),
    toExclusive: localAsDate(addDays(p.end, 1)),
  });
  const closed = rows.map(closedDays).filter((v): v is number => v !== null);
  const byType = [...countBy(rows, (r) => String(r.complaint_type))]
    .map(([t, rs]) => ({ problem: t, requests: rs.length, share: share(rs.length, rows.length) }))
    .sort((a, b) => b.requests - a.requests || byText(a.problem, b.problem));
  const top = capped(byType, limit);

  // Compare panel: whole months, located requests, district vs borough vs city.
  const ymStart = p.start.slice(0, 7);
  const ymEnd = p.end.slice(0, 7);
  const agg = await aggCounts(data, ymStart, ymEnd, [[d.geo, String(d.id)], ["borough", d.borough ?? ""], ["city", null]]);
  const dT = total(agg.get(d.geo));
  const bT = total(agg.get("borough"));
  const cT = total(agg.get("city"));
  const cmp = [...(agg.get(d.geo) ?? new Map<string, number>())]
    .map(([t, n]) => ({
      problem: t,
      district_share: share(n, dT),
      borough_share: share(agg.get("borough")?.get(t) ?? 0, bT),
      city_share: share(agg.get("city")?.get(t) ?? 0, cT),
      _n: n,
    }))
    .sort((a, b) => b._n - a._n || byText(a.problem, b.problem))
    .slice(0, 10)
    .map(({ _n, ...rest }) => rest);

  const extra = [...p.notes, ...districtCaveats(d, m)];
  extra.push(
    `The comparison uses whole months, ${ymStart} to ${ymEnd}, from BoardStat's month file, as BoardStat's Compare panel does` +
      (d.geo === "cc" ? `; the borough is ${d.borough}, where most of this council district's requests are.` : ".") +
      " Shares are of all located requests. Districts differ in size and in who reports, so compare shares, not raw counts."
  );
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, {}),
    data: {
      district: districtOut(d),
      period: periodOut(p),
      requests: rows.length,
      not_closed: rows.filter((r) => !isClosed(r)).length,
      median_days_to_close: days1(median(closed)),
      average_days_to_close: days1(mean(closed)),
      top_problems: top.items,
      top_problems_truncated: top.truncated,
      problem_count: top.total_items,
      comparison: {
        months: { from: ymStart, to: ymEnd },
        district_requests: dT,
        borough: { name: d.borough, requests: bT },
        city_requests: cT,
        top_problems_by_share: cmp,
      },
    },
    extraCaveats: extra,
  });
}

// ─── 3. top_problems ──────────────────────────────────────────────────────────

const TOP_SHAPE = {
  ...DISTRICT_SHAPE,
  ...DISTRICT_PERIOD_SHAPE,
  agency: FILTER_SHAPE.agency,
  status: FILTER_SHAPE.status,
  limit: LIMIT(100),
};

export async function topProblems(src: Source, args: z.infer<z.ZodObject<typeof TOP_SHAPE>>) {
  const data = await pin(src);
  const m = (await data.manifest()).manifest;
  const d = resolveDistrict(m, args);
  const p = toolPeriod(args, m, "view");
  const limit = args.limit ?? 10;
  const prior = priorWindow(p, m);
  const from = "none" in prior ? localAsDate(p.start) : prior.from;
  const { rows, manifest } = await readDetail(data, d, ["complaint_type", "status", "days_to_close", "agency"], {
    from,
    toExclusive: localAsDate(addDays(p.end, 1)),
  });
  const f: Filters = { agency: canonicalAgency(rows, args.agency), status: args.status };
  const keep = rowMatcher(f);
  const cur = rows.filter((r) => keep(r) && inPeriod(p)(r));
  const prev = "none" in prior ? null : rows.filter((r) => keep(r) && inPrior(prior)(r));
  const prevBy = prev ? countBy(prev, (r) => String(r.complaint_type)) : null;
  const list = [...countBy(cur, (r) => String(r.complaint_type))]
    .map(([t, rs]) => {
      const before = prevBy ? prevBy.get(t)?.length ?? 0 : null;
      return {
        problem: t,
        requests: rs.length,
        median_days_to_close: days1(median(rs.map(closedDays).filter((v): v is number => v !== null))),
        same_days_a_year_earlier: before,
        change: before === null ? null : rs.length - before,
        change_pct: before ? Number((((rs.length - before) / before) * 100).toFixed(1)) : null,
      };
    })
    .sort((a, b) => b.requests - a.requests || byText(a.problem, b.problem));
  const top = capped(list, limit);
  const extra = [...p.notes, ...districtCaveats(d, m)];
  if ("none" in prior) extra.push(prior.none);
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, f),
    data: {
      district: districtOut(d),
      period: periodOut(p),
      year_earlier: "none" in prior ? null : prior.label,
      requests: cur.length,
      requests_year_earlier: prev ? prev.length : null,
      problems: top.items,
      truncated: top.truncated,
      problem_count: top.total_items,
    },
    extraCaveats: extra,
  });
}

// ─── 4. problem_trend ─────────────────────────────────────────────────────────

const TREND_SHAPE = {
  ...DISTRICT_SHAPE,
  ...DISTRICT_PERIOD_SHAPE,
  problem: z.string().min(1),
  descriptions: FILTER_SHAPE.descriptions,
  exclude_descriptions: FILTER_SHAPE.exclude_descriptions,
  agency: FILTER_SHAPE.agency,
  status: FILTER_SHAPE.status,
};

export function lastOfMonth(ym: string): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

export async function problemTrend(src: Source, args: z.infer<z.ZodObject<typeof TREND_SHAPE>>) {
  const data = await pin(src);
  const m = (await data.manifest()).manifest;
  const d = resolveDistrict(m, args);
  const p = toolPeriod(args, m, "view");
  const problems = (await canonicalProblems(data, [args.problem])) as string[];
  const prior = priorWindow(p, m);
  const effEnd = p.end < lastDataDay(m) ? p.end : lastDataDay(m);
  const startPrior = shiftMonths(p.start, -12);
  const from = startPrior >= m.window.start ? localAsDate(startPrior) : localAsDate(m.window.start);
  const { rows, manifest } = await readDetail(data, d, ["complaint_type", ...descCol(args), "status", "agency", "year_month"], {
    from,
    toExclusive: localAsDate(addDays(p.end, 1)),
  });
  const typed = rows.filter((r) => problems.includes(String(r.complaint_type)));
  const f: Filters = {
    problems,
    descriptions: canonicalDescriptions(typed, { problems, descriptions: args.descriptions }),
    exclude_descriptions: args.exclude_descriptions,
    agency: canonicalAgency(rows, args.agency),
    status: args.status,
  };
  const keep = rowMatcher(f);
  const cur = countBy(typed.filter((r) => keep(r) && inPeriod(p)(r)), (r) => String(r.year_month));
  // The year-earlier series: the page's prev_year CTE, bounded as priorWindow says.
  const lc = m.window.last_created;
  const prevEnd =
    lc && effEnd === lastDataDay(m)
      ? { toInclusive: localAsDate(shiftMonths(lc, -12)) }
      : { toExclusive: localAsDate(shiftMonths(addDays(effEnd, 1), -12)) };
  const prevRows = typed.filter(
    (r) =>
      keep(r) &&
      (r.created_date as Date).getTime() >= localAsDate(startPrior).getTime() &&
      (r.created_date as Date).getTime() >= localAsDate(m.window.start).getTime() &&
      inPrior({ from: localAsDate(startPrior), ...prevEnd })(r)
  );
  const prev = countBy(prevRows, (r) => shiftMonths(fmtLocal(r.created_date) as string, 12).slice(0, 7));

  const months: { month: string; requests: number; partial_month: string | null; same_days_a_year_earlier: number | null }[] = [];
  for (let ym = p.start.slice(0, 7); ym <= effEnd.slice(0, 7); ym = shiftMonths(`${ym}-01`, 1).slice(0, 7)) {
    const first = `${ym}-01`;
    const a = p.start > first ? p.start : first;
    const b = effEnd < lastOfMonth(ym) ? effEnd : lastOfMonth(ym);
    const partial = a === first && b === lastOfMonth(ym) ? null : `${a} to ${b}`;
    const priorStart = `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}-${a.slice(8)}`;
    months.push({
      month: ym,
      requests: cur.get(ym)?.length ?? 0,
      partial_month: partial,
      same_days_a_year_earlier: priorStart >= m.window.start ? prev.get(ym)?.length ?? 0 : null,
    });
  }
  const extra = [...p.notes, ...districtCaveats(d, m)];
  if (months.some((x) => x.partial_month)) {
    extra.push("A month marked partial_month covers only some days, so it is lower than a full month would be. Year-earlier values cover the same days, up to the same time.");
  }
  if ("none" in prior) extra.push("Months whose same days a year earlier fall before 2020-01-01 have no comparison (null).");
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, f),
    data: {
      district: districtOut(d),
      period: periodOut(p),
      problem: problems[0],
      descriptions: f.descriptions ?? null,
      exclude_descriptions: Boolean(f.exclude_descriptions && f.descriptions),
      requests: months.reduce((s, x) => s + x.requests, 0),
      months,
    },
    extraCaveats: extra,
  });
}

// ─── 5. agency_response ───────────────────────────────────────────────────────

const AGENCY_SHAPE = {
  ...DISTRICT_SHAPE,
  ...DISTRICT_PERIOD_SHAPE,
  problems: FILTER_SHAPE.problems,
  descriptions: FILTER_SHAPE.descriptions,
  exclude_descriptions: FILTER_SHAPE.exclude_descriptions,
  limit: LIMIT(100),
};

export async function agencyResponse(src: Source, args: z.infer<z.ZodObject<typeof AGENCY_SHAPE>>) {
  const data = await pin(src);
  const m = (await data.manifest()).manifest;
  const d = resolveDistrict(m, args);
  const p = toolPeriod(args, m, "view");
  const problems = await canonicalProblems(data, args.problems);
  const { rows, manifest } = await readDetail(data, d, ["agency", "agency_name", "complaint_type", ...descCol(args), "status", "days_to_close"], {
    from: localAsDate(p.start),
    toExclusive: localAsDate(addDays(p.end, 1)),
  });
  const f: Filters = {
    problems,
    descriptions: canonicalDescriptions(rows, { problems, descriptions: args.descriptions }),
    exclude_descriptions: args.exclude_descriptions,
  };
  const keep = rowMatcher(f);
  const list = [...countBy(rows.filter(keep), (r) => String(r.agency))]
    .map(([agency, rs]) => {
      const closed = rs.map(closedDays).filter((v): v is number => v !== null);
      return {
        agency,
        agency_name: (rs.find((r) => r.agency_name)?.agency_name as string | undefined) ?? null,
        requests: rs.length,
        not_closed: rs.filter((r) => !isClosed(r)).length,
        closed: rs.filter(isClosed).length,
        median_days_to_close: days1(median(closed)),
        average_days_to_close: days1(mean(closed)),
      };
    })
    .sort((a, b) => b.requests - a.requests || byText(a.agency, b.agency));
  const out = capped(list, args.limit ?? 25);
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, f),
    data: { district: districtOut(d), period: periodOut(p), agencies: out.items, truncated: out.truncated, agency_count: out.total_items },
    extraCaveats: [
      ...p.notes,
      ...districtCaveats(d, m),
      "Days to close count only requests marked Closed, from when the request was created to when the agency closed it. Requests closed before they were created, or with a close date in the future, are left out of the time (City data errors).",
      "A median is the middle request; the average is pulled up by a few very slow ones. Agencies handle different problems, so compare an agency with itself over time, or for the same problem.",
    ],
  });
}

// ─── 6. still_open ────────────────────────────────────────────────────────────

const OPEN_SHAPE = {
  ...DISTRICT_SHAPE,
  ...DISTRICT_PERIOD_SHAPE,
  problems: FILTER_SHAPE.problems,
  descriptions: FILTER_SHAPE.descriptions,
  exclude_descriptions: FILTER_SHAPE.exclude_descriptions,
  agency: FILTER_SHAPE.agency,
  limit: LIMIT(200),
};

export function addressOf(r: Row): string | null {
  if (r.incident_address) return String(r.incident_address);
  if (r.intersection_street_1 && r.intersection_street_2) return `${r.intersection_street_1} & ${r.intersection_street_2}`;
  return null;
}

export async function stillOpen(src: Source, args: z.infer<z.ZodObject<typeof OPEN_SHAPE>>) {
  const data = await pin(src);
  const m = (await data.manifest()).manifest;
  const d = resolveDistrict(m, args);
  const p = toolPeriod(args, m, "all");
  const problems = await canonicalProblems(data, args.problems);
  const { rows, manifest } = await readDetail(
    data,
    d,
    ["unique_key", "created_date", "agency", "agency_name", "complaint_type", "descriptor", "status", "incident_address", "intersection_street_1", "intersection_street_2"],
    { from: localAsDate(p.start), toExclusive: localAsDate(addDays(p.end, 1)), openOnly: true }
  );
  const f: Filters = {
    problems,
    descriptions: canonicalDescriptions(rows, { problems, descriptions: args.descriptions }),
    exclude_descriptions: args.exclude_descriptions,
    agency: canonicalAgency(rows, args.agency),
    status: "not_closed",
  };
  const keep = rowMatcher(f);
  const open = rows
    .filter(keep)
    .sort((a, b) => (a.created_date as Date).getTime() - (b.created_date as Date).getTime() || byText(String(a.unique_key), String(b.unique_key)));
  const asOf = localAsDate(nycLocal(m.generated_at)).getTime();
  const byAgency = [...countBy(open, (r) => String(r.agency))]
    .map(([agency, rs]) => ({
      agency,
      agency_name: (rs.find((r) => r.agency_name)?.agency_name as string | undefined) ?? null,
      not_closed: rs.length,
      oldest_created: (fmtLocal(rs[0].created_date) as string).slice(0, 10),
    }))
    .sort((a, b) => b.not_closed - a.not_closed || byText(a.agency, b.agency));
  const list = capped(
    open.map((r) => ({
      unique_key: String(r.unique_key),
      created: fmtLocal(r.created_date),
      problem: String(r.complaint_type),
      description: r.descriptor == null ? null : redactZip(String(r.descriptor)),
      agency: String(r.agency),
      status: r.status == null ? null : String(r.status),
      address: redactZip(addressOf(r)),
      days_open: Number((Math.max(0, asOf - (r.created_date as Date).getTime()) / DAY).toFixed(1)),
    })),
    args.limit ?? 25
  );
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, f),
    data: {
      district: districtOut(d),
      period: periodOut(p),
      not_closed: open.length,
      by_agency: byAgency,
      oldest_first: list.items,
      truncated: list.truncated,
      status_meanings_source: "BetaNYC",
      status_meanings: statusMeanings(open.map((r) => (r.status == null ? null : String(r.status)))),
    },
    extraCaveats: [
      ...p.notes,
      ...districtCaveats(d, m),
      `Not closed means any status other than Closed (Open, In Progress, Pending, Assigned, Started, or none), as BoardStat's "Not yet closed". Days open are counted to when this data was built (${m.generated_at}), not to today.`,
      "Requests created in the period that are still not closed. unique_key is NYC Open Data's id for the request; it is not the 311 number (311-XXXXXXXX) the person who reported was given, and get_service_request cannot look it up.",
    ],
  });
}

// ─── 7. top_addresses ─────────────────────────────────────────────────────────

const ADDR_SHAPE = {
  ...DISTRICT_SHAPE,
  ...DISTRICT_PERIOD_SHAPE,
  ...FILTER_SHAPE,
  limit: LIMIT(100),
};

export async function topAddresses(src: Source, args: z.infer<z.ZodObject<typeof ADDR_SHAPE>>) {
  const data = await pin(src);
  const m = (await data.manifest()).manifest;
  const d = resolveDistrict(m, args);
  const p = toolPeriod(args, m, "view");
  const problems = await canonicalProblems(data, args.problems);
  const { rows, manifest } = await readDetail(data, d, ["address_norm", "complaint_type", ...descCol(args), "agency", "status"], {
    from: localAsDate(p.start),
    toExclusive: localAsDate(addDays(p.end, 1)),
  });
  const f: Filters = {
    problems,
    descriptions: canonicalDescriptions(rows, { problems, descriptions: args.descriptions }),
    exclude_descriptions: args.exclude_descriptions,
    agency: canonicalAgency(rows, args.agency),
    status: args.status,
  };
  const keep = rowMatcher(f);
  const matched = rows.filter(keep);
  const located = matched.filter((r) => r.address_norm != null);
  const list = [...countBy(located, (r) => String(r.address_norm))]
    .map(([address, rs]) => {
      const types = [...countBy(rs, (r) => String(r.complaint_type))].sort((a, b) => b[1].length - a[1].length || byText(a[0], b[0]));
      return {
        address: redactZip(address),
        requests: rs.length,
        most_common_problem: types[0][0],
        not_closed: rs.filter((r) => !isClosed(r)).length,
        placeholder_address: isPlaceholderAddress(address) || undefined,
      };
    })
    .sort((a, b) => b.requests - a.requests || byText(a.address, b.address));
  const out = capped(list, args.limit ?? 15);
  const extra = [
    ...p.notes,
    ...districtCaveats(d, m),
    "Addresses are as the City spelled them; one building can appear under more than one spelling. Many complaints come from one or two neighbors, so a long list at one address is not proof of a worse problem there.",
  ];
  if (out.items.some((a) => a.placeholder_address)) extra.push("An address marked placeholder_address (such as '-999 …') is a placeholder in the City's data, not a real building.");
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, f),
    data: {
      district: districtOut(d),
      period: periodOut(p),
      requests: matched.length,
      requests_without_street_address: matched.length - located.length,
      addresses: out.items,
      truncated: out.truncated,
      address_count: out.total_items,
    },
    extraCaveats: extra,
  });
}

// ─── 8. address_history ───────────────────────────────────────────────────────

const HISTORY_SHAPE = {
  address: z.string().min(1).max(200),
  borough: z.enum(BOROUGHS).optional(),
  community_district: z.union([z.number().int(), z.string()]).optional(),
  ...DISTRICT_PERIOD_SHAPE,
  problems: FILTER_SHAPE.problems,
  status: FILTER_SHAPE.status,
  limit: LIMIT(200),
  offset: z.number().int().min(0).optional(),
  data_as_of: z.string().optional(),
};

export async function addressHistory(src: Source, args: z.infer<z.ZodObject<typeof HISTORY_SHAPE>>) {
  const data = await pin(src);
  const { spelling, hits: found, manifest: mr0 } = await findAddress(data, args.address, args.borough);
  const m = mr0.manifest;
  assertSameBuild(args.data_as_of, m);
  if (!found.length) {
    const sug = await suggestAddresses(data, spelling.spellings[0], args.borough);
    throw new Error(
      `No 311 request in BoardStat's data uses this address as the City spells it (tried: ${spelling.spellings.join("; ")}).` +
        (sug.length ? ` Close City spellings: ${sug.map((s) => `${redactZip(s.address)} (${s.borough})`).join("; ")}.` : "")
    );
  }
  let hits = found;
  if (args.community_district !== undefined) {
    const want = resolveDistrict(m, { community_district: args.community_district }).id;
    hits = found.filter((h) => h.cd === want);
    if (!hits.length) {
      throw new Error(`This address is not in ${label(m, "cd", want)} in BoardStat's data. It is in: ${[...new Set(found.map((h) => label(m, "cd", h.cd)))].join(", ")}.`);
    }
  }
  const boroughs = [...new Set(hits.map((h) => h.borough))];
  if (boroughs.length > 1) {
    throw new Error(
      `This address exists in more than one borough: ${hits.map((h) => `${redactZip(h.address)}, ${h.borough} (${label(m, "cd", h.cd)})`).join("; ")}. Give a borough.`
    );
  }
  // One address can straddle a district line: BoardStat places each request by its own
  // point. Use the district with the most requests, and say where the rest are.
  const byCd = new Map<number, number>();
  for (const h of hits) byCd.set(h.cd, (byCd.get(h.cd) ?? 0) + h.requests);
  const perCd = [...byCd].map(([cd, requests]) => ({ cd, requests })).sort((a, b) => b.requests - a.requests || a.cd - b.cd);
  const chosen = perCd[0].cd;
  const others = perCd.slice(1);
  hits = hits.filter((h) => h.cd === chosen);
  const d = resolveDistrict(m, { community_district: hits[0].cd });
  const p = toolPeriod(args, m, "all");
  const problems = await canonicalProblems(data, args.problems);
  const spellings = [...new Set(hits.map((h) => h.address))];
  const { rows, manifest } = await readDetail(
    data,
    d,
    ["unique_key", "created_date", "closed_date", "agency", "complaint_type", "descriptor", "status", "days_to_close", "resolution_description", "address_norm"],
    { from: localAsDate(p.start), toExclusive: localAsDate(addDays(p.end, 1)), addresses: spellings }
  );
  const keep = rowMatcher({ problems, status: args.status });
  const matched = rows
    .filter(keep)
    .sort((a, b) => (b.created_date as Date).getTime() - (a.created_date as Date).getTime() || byText(String(a.unique_key), String(b.unique_key)));
  const asOf = localAsDate(nycLocal(m.generated_at)).getTime();
  const byProblem = [...countBy(matched, (r) => String(r.complaint_type))]
    .map(([problem, rs]) => ({ problem, requests: rs.length, not_closed: rs.filter((r) => !isClosed(r)).length }))
    .sort((a, b) => b.requests - a.requests || byText(a.problem, b.problem));
  const historyOffset = args.offset ?? 0;
  const list = capped(
    matched.slice(historyOffset).map((r) => ({
      unique_key: String(r.unique_key),
      created: fmtLocal(r.created_date),
      closed: fmtLocal(r.closed_date),
      problem: String(r.complaint_type),
      description: r.descriptor == null ? null : redactZip(String(r.descriptor)),
      agency: String(r.agency),
      status: r.status == null ? null : String(r.status),
      days_to_close: days1(closedDays(r)),
      days_open: isClosed(r) ? null : Number((Math.max(0, asOf - (r.created_date as Date).getTime()) / DAY).toFixed(1)),
      // Agency text can carry an address with a ZIP code ("…, New York, NY 10010").
      resolution: redactZip(r.resolution_description == null ? null : String(r.resolution_description)),
    })),
    args.limit ?? 50
  );
  const extra = [
    ...p.notes,
    "Only requests whose address matches exactly, as the City spelled it, in this address's community district. Requests that gave only a cross street are not included.",
    "The resolution is the agency's own words. It says what the agency recorded, not whether the problem was fixed.",
    "unique_key is NYC Open Data's id for each request, not the 311 number (311-XXXXXXXX) the person who reported was given.",
    "To page, pass next_page.offset and next_page.data_as_of; a page from another build is refused.",
    "Talk about the address, not the people who reported: 311 data does not say who called, and this server does not try to.",
    "The BoardStat link opens the district page; to see this one address on BoardStat, search for it on BoardStat's home page.",
  ];
  if (spellings.length > 1) extra.push(`Requests under every spelling found are included: ${spellings.map(redactZip).join("; ")}.`);
  if (others.length) {
    // Exact counts for the other districts, same period and filters, from their own files.
    const counts: string[] = [];
    for (const o of others) {
      const od = resolveDistrict(m, { community_district: o.cd });
      const { rows: orows } = await readDetail(data, od, ["complaint_type", "status"], {
        from: localAsDate(p.start),
        toExclusive: localAsDate(addDays(p.end, 1)),
        addresses: spellings,
      });
      counts.push(`${od.label} (${orows.filter(keep).length.toLocaleString("en-US")})`);
    }
    extra.push(
      `BoardStat placed some requests at this address in another district, by where each was reported: ${counts.join(", ")}. ` +
        `This answer covers ${d.label}, which has the most; pass community_district to see another.`
    );
  }
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, { problems, status: args.status }),
    data: {
      address: spellings.length === 1 ? redactZip(spellings[0]) : spellings.map(redactZip),
      borough: hits[0].borough,
      community_district: { id: d.id, label: d.label },
      council_district: { id: hits[0].cc, label: label(m, "cc", hits[0].cc) },
      period: periodOut(p),
      requests: matched.length,
      not_closed: matched.filter((r) => !isClosed(r)).length,
      by_problem: byProblem,
      newest_first: list.items,
      truncated: list.truncated,
      offset: historyOffset,
      next_offset: list.truncated ? historyOffset + list.items.length : null,
      next_page: list.truncated ? { offset: historyOffset + list.items.length, data_as_of: m.generated_at } : null,
      status_meanings_source: "BetaNYC",
      status_meanings: statusMeanings(matched.map((r) => (r.status == null ? null : String(r.status)))),
    },
    extraCaveats: extra,
  });
}

// ─── 11. find_requests ────────────────────────────────────────────────────────
// The request list for a district (#16). still_open lists only requests not yet closed,
// and address_history only one address; this is the one list of every request in a
// district, with any status, paged. For one address, address_history stays the tool.

const FIND_REQUESTS_SHAPE = {
  ...DISTRICT_SHAPE,
  ...DISTRICT_PERIOD_SHAPE,
  ...FILTER_SHAPE,
  statuses: z.array(z.string().min(1)).max(10).optional(),
  limit: LIMIT(200),
  offset: z.number().int().min(0).optional(),
  data_as_of: z.string().optional(),
};

/** Refuse `status` + `statuses` that cannot both hold (closed + Pending, not_closed + Closed). */
function assertStatusesAgree(status: Status | undefined, statuses: string[] | undefined): void {
  if (!status || !statuses?.length) return;
  const bad = statuses.filter((s) => (s.trim().toLowerCase() === "closed") !== (status === "closed"));
  if (bad.length) {
    throw new Error(
      `status '${status}' and statuses ${bad.map((b) => `'${b}'`).join(", ")} cannot both hold, so the answer would always be empty. ` +
        "Give one of the two: status for closed / not_closed, or statuses for the City's own values."
    );
  }
}

/** Heavy text columns, read only for the rows of the page (#22 QA: reading them for a whole district peaked at about 1 GB). */
const PAGE_TEXT_COLUMNS = ["closed_date", "descriptor", "resolution_description", "incident_address", "intersection_street_1", "intersection_street_2"];

/**
 * The heavy columns for the given requests, read one row-group-sized window at a time with a
 * created_date range around the page, so row groups outside it are skipped and memory stays
 * bounded by one window, not the district.
 */
async function readPageText(data: Reader, d: District, page: Row[], totalRows: number): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  if (!page.length) return out;
  const keys = page.map((r) => String(r.unique_key));
  const times = page.map((r) => (r.created_date as Date).getTime());
  const filter = {
    unique_key: { $in: keys },
    created_date: { $gte: new Date(Math.min(...times)), $lte: new Date(Math.max(...times)) },
  };
  const WINDOW = 51_200;
  for (let start = 0; start < totalRows && out.size < keys.length; start += WINDOW) {
    const { rows } = await data.readParquet(d.file, {
      columns: ["unique_key", ...PAGE_TEXT_COLUMNS],
      filter,
      rowStart: start,
      rowEnd: Math.min(start + WINDOW, totalRows),
    });
    for (const r of rows) out.set(String(r.unique_key), r);
  }
  return out;
}

/** Refuse a later page asked for against another build than the first page (as cb_monthly_list does). */
export function assertSameBuild(dataAsOf: string | undefined, m: BoardStatManifest): void {
  if (dataAsOf !== undefined && dataAsOf !== m.generated_at) {
    throw new Error(
      `BoardStat published new data since the first page (that page was from ${dataAsOf}; the data is now from ${m.generated_at}), ` +
        "so later pages would not line up with earlier ones. Start again at offset 0, without data_as_of."
    );
  }
}

/** Map each requested City status to the exact value in the rows read (case-insensitive), or fail listing the values there. */
function canonicalStatuses(rows: Row[], asked: string[] | undefined): string[] | undefined {
  if (!asked?.length) return undefined;
  const present = [...new Set(rows.map((r) => (r.status == null ? "(none)" : String(r.status))))].sort(byText);
  const out: string[] = [];
  for (const a of asked) {
    const hit = present.find((p) => p.toLowerCase() === a.trim().toLowerCase());
    if (!hit) {
      throw new Error(
        `No request in this district and period has the status '${a}'. Statuses here: ${present.map((p) => `'${p}'`).join(", ")}. ` +
          "For every status other than Closed at once, use status: 'not_closed'."
      );
    }
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

/** One row-group-sized window of a detail file at a time (BoardStat writes 51,200-row groups), so memory is bounded by a window. */
const SCAN_WINDOW = 51_200;

/** Calls `each` with the rows of every window, in file order, with the same created_date filter readDetail uses. */
async function scanDetail(data: Reader, d: District, totalRows: number, columns: string[], p: Period, each: (rows: Row[]) => void): Promise<ManifestResult> {
  const filter = { created_date: { $gte: localAsDate(p.start), $lt: localAsDate(addDays(p.end, 1)) } };
  const cols = [...new Set([...columns, "created_date"])];
  let manifest: ManifestResult | undefined;
  // The manifest's row count bounds the windows; one open-ended read after them catches any rows beyond it.
  for (let at = 0; ; at += SCAN_WINDOW) {
    const last = at >= totalRows;
    const r = await data.readParquet(d.file, { columns: cols, filter, rowStart: at, ...(last ? {} : { rowEnd: Math.min(at + SCAN_WINDOW, totalRows) }) });
    manifest = r.manifest;
    each(r.rows);
    if (last) break;
  }
  return manifest as ManifestResult;
}

const statusOf = (r: Row) => (r.status == null ? "(none)" : String(r.status));
const newestFirst = (a: Row, b: Row) => (b.created_date as Date).getTime() - (a.created_date as Date).getTime() || byText(String(a.unique_key), String(b.unique_key));

export async function findRequests(src: Source, args: z.infer<z.ZodObject<typeof FIND_REQUESTS_SHAPE>>) {
  const data = await pin(src);
  const m = (await data.manifest()).manifest;
  assertSameBuild(args.data_as_of, m);
  assertStatusesAgree(args.status, args.statuses);
  const d = resolveDistrict(m, args);
  const p = toolPeriod(args, m, "view");
  const problems = await canonicalProblems(data, args.problems);
  const totalRows = Number(manifestDistricts(m)[d.geo].find((e) => Number(e.id) === d.id)?.rows ?? 0);

  // Pass 1, only when a filter needs it: the agencies, descriptions and statuses present, so
  // each asked-for value is matched to the City's exact spelling as the other tools do.
  let descriptions: string[] | undefined;
  let agency: string | undefined;
  let statuses: string[] | undefined;
  if (args.descriptions?.length || args.agency || args.statuses?.length) {
    const descCounts = new Map<string, number>();
    const agencies = new Set<string>();
    const present = new Set<string>();
    const inScope = problems?.length ? (r: Row) => problems.includes(String(r.complaint_type)) : () => true;
    await scanDetail(data, d, totalRows, ["complaint_type", ...descCol(args), "agency", "status"], p, (rows) => {
      for (const r of rows) {
        agencies.add(String(r.agency));
        present.add(statusOf(r));
        if (args.descriptions?.length && inScope(r)) descCounts.set(descOf(r), (descCounts.get(descOf(r)) ?? 0) + 1);
      }
    });
    // The same checks and messages as the other tools (canonicalDescriptions, canonicalAgency).
    if (args.descriptions?.length) {
      descriptions = canonicalDescriptionsCounted(descCounts, { problems, descriptions: args.descriptions });
    }
    agency = canonicalAgency([...agencies].map((a) => ({ agency: a })), args.agency);
    statuses = canonicalStatuses([...present].map((s) => ({ status: s === "(none)" ? null : s })), args.statuses);
  }
  const f: Filters = { problems, descriptions, exclude_descriptions: args.exclude_descriptions, agency, status: args.status };
  const keepFilters = rowMatcher(f);
  const statusSet = statuses ? new Set(statuses) : null;
  const keep = (r: Row) => keepFilters(r) && (!statusSet || statusSet.has(statusOf(r)));

  // Pass 2: light columns, window by window. Keep the counts and only the newest offset + limit
  // rows; the text columns are then read for the page alone (#22 QA: reading every column for
  // Council District 11 since 2020 peaked at about 1 GB).
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 25;
  const want = offset + limit;
  let top: Row[] = [];
  let matchedCount = 0;
  const statusCounts = new Map<string, number>();
  const manifest = await scanDetail(
    data, d, totalRows,
    ["unique_key", "agency", "complaint_type", ...descCol(args), "status", "days_to_close"],
    p,
    (rows) => {
      for (const r of rows) {
        if (!keep(r)) continue;
        matchedCount++;
        statusCounts.set(statusOf(r), (statusCounts.get(statusOf(r)) ?? 0) + 1);
        top.push(r);
      }
      if (top.length > want) top = top.sort(newestFirst).slice(0, want);
    }
  );
  top.sort(newestFirst);
  const page = top.slice(offset, want);
  const text = await readPageText(data, d, page, totalRows);
  const asOf = localAsDate(nycLocal(m.generated_at)).getTime();
  const byStatus = [...statusCounts]
    .map(([status, n]) => {
      const ex = explainStatus(status === "(none)" ? null : status);
      return { status, requests: n, closed: ex.closed, meaning: ex.meaning, meaning_source: ex.meaning_source };
    })
    .sort((a, b) => b.requests - a.requests || byText(a.status, b.status));
  const link = linkFilters(d, p, f);
  // BoardStat's page takes one status; with exactly one City status asked for, pass it on.
  if (statuses?.length === 1 && !f.status && statuses[0] !== "(none)") link.status = statuses[0];
  const extra = [
    ...p.notes,
    ...districtCaveats(d, m),
    "Newest first. Each request's status is the City's current one; status meanings are in by_status. The resolution is the agency's own words, not proof the problem was fixed.",
    `unique_key is NYC Open Data's id for each request, not the 311 number (311-XXXXXXXX) the person who reported was given. ${SR_NUMBER_NOTE}`,
    "For every request at one address, use address_history.",
    "To page, pass next_page.offset and next_page.data_as_of. A page asked for with an older data_as_of is refused, so a list is never stitched from two builds.",
  ];
  if (statuses && statuses.length > 1) extra.push("BoardStat's page filters on one status at a time, so the link does not carry the statuses asked for.");
  return districtEnvelope({
    manifest,
    siteUrl: data.siteUrl,
    link,
    data: {
      district: districtOut(d),
      period: periodOut(p),
      filters: { problems: f.problems ?? null, descriptions: f.descriptions ?? null, exclude_descriptions: f.exclude_descriptions ?? null, agency: f.agency ?? null, status: f.status ?? null, statuses: statuses ?? null },
      requests: matchedCount,
      by_status: byStatus,
      offset,
      limit,
      next_offset: want < matchedCount ? want : null,
      next_page: want < matchedCount ? { offset: want, data_as_of: m.generated_at } : null,
      newest_first: page.map((r) => {
        const t = text.get(String(r.unique_key)) ?? {};
        return {
          unique_key: String(r.unique_key),
          created: fmtLocal(r.created_date),
          closed: fmtLocal(t.closed_date),
          problem: String(r.complaint_type),
          description: t.descriptor == null ? null : redactZip(String(t.descriptor)),
          agency: String(r.agency),
          status: r.status == null ? null : String(r.status),
          days_to_close: days1(closedDays(r)),
          days_open: isClosed(r) ? null : Number((Math.max(0, asOf - (r.created_date as Date).getTime()) / DAY).toFixed(1)),
          address: redactZip(addressOf(t)),
          resolution: redactZip(t.resolution_description == null ? null : String(t.resolution_description)),
        };
      }),
    },
    extraCaveats: extra,
  });
}

// ─── 9. boardstat_link ────────────────────────────────────────────────────────

const LINK_SHAPE = { ...DISTRICT_SHAPE, ...DISTRICT_PERIOD_SHAPE, ...FILTER_SHAPE };

export async function boardstatLink(src: Source, args: z.infer<z.ZodObject<typeof LINK_SHAPE>>) {
  const data = await pin(src);
  const mr = await data.manifest();
  const m = mr.manifest;
  const d = resolveDistrict(m, args);
  const anyDate = args.from_date !== undefined || args.to_date !== undefined || args.fiscal_year !== undefined || args.last_days !== undefined;
  const p = anyDate ? toolPeriod(args, m, "view") : null;
  const problems = await canonicalProblems(data, args.problems);
  let descriptions: string[] | undefined;
  if (args.descriptions?.length) {
    const { rows } = await readDetail(data, d, ["complaint_type", "descriptor"]);
    descriptions = canonicalDescriptions(rows, { problems, descriptions: args.descriptions });
  }
  const f: Filters = {
    problems,
    descriptions,
    exclude_descriptions: args.exclude_descriptions,
    agency: args.agency?.trim().toUpperCase(),
    status: args.status,
  };
  const notes = p ? p.notes : [`No dates were given, so the page opens with its own default dates (${m.window.default_start ?? m.window.start} to ${m.window.end}).`];
  if (f.agency) notes.push("The agency code is passed as given; BoardStat shows nothing if no request in the district has that agency.");
  return districtEnvelope({
    manifest: mr,
    siteUrl: data.siteUrl,
    link: linkFilters(d, p, f),
    data: { district: districtOut(d), period: p ? periodOut(p) : null, filters: { ...f, status: f.status ?? null } },
    extraCaveats: notes,
  });
}

// ─── 10. boardstat_status ─────────────────────────────────────────────────────

/** BoardStat's own nightly check calls the data late after this many hours (pipeline/check/freshness.py MAX_AGE_H). */
export const NIGHTLY_LATE_HOURS = 26;
/** The BoardStat page shows its "data may be out of date" banner after this many hours (site/js/lib.js STALE_HOURS). */
export const PAGE_STALE_HOURS = 48;

export async function boardstatStatus(from: Source, now: number = Date.now()) {
  const data = await pin(from);
  const mr = await data.manifest();
  const m = mr.manifest;
  const hours = Number(((now - Date.parse(m.generated_at)) / 3_600_000).toFixed(1));
  const src = (k: string) => m.sources?.[k] as { id?: string; name?: string; url?: string; rowsUpdatedAt_iso?: string; version?: string } | undefined;
  const counts = (m.counts ?? {}) as Record<string, number>;
  const agreement = (m.agreement as { council?: { share?: number } } | undefined)?.council?.share ?? null;
  return districtEnvelope({
    manifest: mr,
    siteUrl: data.siteUrl,
    data: {
      built_at: m.generated_at,
      hours_since_build: hours,
      nightly_run_late: hours > NIGHTLY_LATE_HOURS,
      newest_request: m.window.last_created ?? null,
      data_window: { start: m.window.start, end: m.window.end, page_opens_from: m.window.default_start ?? null },
      city_dataset_updated: src("service_requests")?.rowsUpdatedAt_iso ?? null,
      boundaries: {
        community_districts: src("community_districts")?.version ?? null,
        council_districts: src("council_districts")?.version ?? null,
      },
      requests: {
        total: counts.total ?? null,
        without_usable_location: counts.without_coords ?? null,
        not_in_any_community_district: counts.not_in_any_cd ?? null,
        closed_before_created: counts.closed_before_created ?? null,
        closed_in_the_future: counts.closed_in_future ?? null,
        no_close_date: counts.no_close_date ?? null,
      },
      council_district_agreement:
        agreement === null ? null : { share: agreement, meaning: "Share of located requests where BoardStat's council district equals the council_district the City wrote on the request." },
    },
    extraCaveats: [
      `BoardStat rebuilds every night. Its own check calls the data late after ${NIGHTLY_LATE_HOURS} hours, and its page warns readers after ${PAGE_STALE_HOURS}.`,
      "The newest request trails the build time because the City publishes 311 data with a delay of a few days.",
    ],
  });
}

// ─── Tool table ───────────────────────────────────────────────────────────────

export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});

const PERIOD_DESC = "Dates: from_date/to_date, a City fiscal_year (July to June), or last_days.";

export const DISTRICT_TOOLS = [
  {
    name: "find_district",
    description:
      "Which community district and City Council district an address is in. Type the address as you would ('350 5th Ave'); it is converted to the City's spelling ('350 5 AVENUE') and looked up in the addresses that appear in 311 requests since 2020. If it is not found, says so and suggests close City spellings. Not a geocoder. ZIP codes are ignored. " + ABOUT,
    inputSchema: obj(
      {
        address: { type: "string", description: "Street address, e.g. '350 5th Ave' or '10 W 42nd St'. Anything after a comma is ignored." },
        borough: { type: "string", enum: BOROUGHS, description: "Optional, to choose when the same address exists in several boroughs." },
      },
      ["address"]
    ),
  },
  {
    name: "district_summary",
    description:
      "Totals for a community or council district and period: requests, how many are not yet closed, median and average days to close, the top problems, and each top problem's share compared with the borough and the whole city. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj({ ...DISTRICT_JSON, ...DISTRICT_PERIOD_JSON, limit: LIMIT_JSON(10, 50) }),
  },
  {
    name: "top_problems",
    description:
      "The most-reported problems in a community or council district for a period, each with the count for the same days a year earlier and the median days to close. Optional agency and status filters. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj({ ...DISTRICT_JSON, ...DISTRICT_PERIOD_JSON, agency: FILTER_JSON.agency, status: FILTER_JSON.status, limit: LIMIT_JSON(10, 100) }),
  },
  {
    name: "problem_trend",
    description:
      "Requests per month for one problem in one district, with the same days a year earlier. Optional description, agency and status filters. Months only partly covered are marked. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj(
      {
        ...DISTRICT_JSON,
        ...DISTRICT_PERIOD_JSON,
        problem: { type: "string", description: "One BoardStat problem name, e.g. 'HEAT/HOT WATER', 'Noise - Residential', 'Rodent'." },
        descriptions: FILTER_JSON.descriptions,
        exclude_descriptions: FILTER_JSON.exclude_descriptions,
        agency: FILTER_JSON.agency,
        status: FILTER_JSON.status,
      },
      ["problem"]
    ),
  },
  {
    name: "agency_response",
    description:
      "For each agency in a district and period: requests, how many are closed and not yet closed, and the median and average days to close (closed requests only). Optional problem and description filters. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj({
      ...DISTRICT_JSON,
      ...DISTRICT_PERIOD_JSON,
      problems: FILTER_JSON.problems,
      descriptions: FILTER_JSON.descriptions,
      exclude_descriptions: FILTER_JSON.exclude_descriptions,
      limit: LIMIT_JSON(25, 100),
    }),
  },
  {
    name: "still_open",
    description:
      "Requests in a district that are not yet closed, oldest first, with days open, plus a count and the oldest date for each agency. With no dates, covers every request since 2020. Optional problem, description and agency filters. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj({
      ...DISTRICT_JSON,
      ...DISTRICT_PERIOD_JSON,
      problems: FILTER_JSON.problems,
      descriptions: FILTER_JSON.descriptions,
      exclude_descriptions: FILTER_JSON.exclude_descriptions,
      agency: FILTER_JSON.agency,
      limit: LIMIT_JSON(25, 200),
    }),
  },
  {
    name: "top_addresses",
    description:
      "The addresses in a district with the most requests for a period, optionally for given problems or descriptions (for example HEAT/HOT WATER, or 'Blocked Bike Lane' under Illegal Parking). Addresses are as the City spelled them. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj({ ...DISTRICT_JSON, ...DISTRICT_PERIOD_JSON, ...FILTER_JSON, limit: LIMIT_JSON(15, 100) }),
  },
  {
    name: "address_history",
    description:
      "Every request at one address, newest first, with its status, days to close or days open, and the agency's resolution text, plus counts by problem. The address is converted to the City's spelling as in find_district. With no dates, covers every request since 2020. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj(
      {
        address: { type: "string", description: "Street address, e.g. '1000 5th Ave'." },
        borough: { type: "string", enum: BOROUGHS, description: "Needed when the same address exists in several boroughs." },
        community_district: {
          type: ["integer", "string"],
          description: "Optional. When an address straddles a district line, the district to use (BoardStat id, e.g. 205). Without it, the district with the most requests at the address is used, and the answer names the other.",
        },
        ...DISTRICT_PERIOD_JSON,
        problems: FILTER_JSON.problems,
        status: FILTER_JSON.status,
        limit: LIMIT_JSON(50, 200),
        offset: OFFSET_JSON,
        data_as_of: { type: "string", description: "For the next page: the data_as_of from next_page. A page from a newer build is refused, so pages always line up." },
      },
      ["address"]
    ),
  },
  {
    name: "find_requests",
    description:
      "List the requests in a community or council district, newest first, with any status, paged with limit and offset. Each has its status, days to close or days open, address and the agency's resolution text; by_status counts each status and says in plain words what it means. Filters: problems, descriptions, agency, status ('closed' / 'not_closed'), or statuses (the City's own values, such as 'Pending' or 'Assigned'). With no dates, BoardStat's opening view (about the last year). For one address use address_history; for only what is still open, still_open. " + PERIOD_DESC + " " + ABOUT,
    inputSchema: obj({
      ...DISTRICT_JSON,
      ...DISTRICT_PERIOD_JSON,
      ...FILTER_JSON,
      statuses: {
        type: "array",
        items: { type: "string" },
        description: "The City's status values to keep, e.g. ['Pending', 'Assigned']. Values seen: Closed, Open, In Progress, Pending, Assigned, Started, Unspecified. Matched without regard to case; a value no request has is refused with the list of values present.",
      },
      limit: LIMIT_JSON(25, 200),
      offset: OFFSET_JSON,
      data_as_of: { type: "string", description: "For the next page: the data_as_of from next_page. A page from a newer build is refused, so pages always line up." },
    }),
  },
  {
    name: "boardstat_link",
    description:
      "A link to BoardStat's district page with the given district, dates, problems, descriptions, agency and status already set, so a person can see and check the numbers. Problem and description names are checked against BoardStat's data. " + PERIOD_DESC,
    inputSchema: obj({ ...DISTRICT_JSON, ...DISTRICT_PERIOD_JSON, ...FILTER_JSON }),
  },
  {
    name: "boardstat_status",
    description:
      "How fresh BoardStat's data is: when it was last built, the newest request in it, whether the nightly run is late, the boundary versions, and counts of known City data problems (such as requests closed before they were created).",
    inputSchema: obj({}),
  },
];

export const DISTRICT_ARG_SHAPES = {
  find_district: FIND_SHAPE,
  district_summary: SUMMARY_SHAPE,
  top_problems: TOP_SHAPE,
  problem_trend: TREND_SHAPE,
  agency_response: AGENCY_SHAPE,
  still_open: OPEN_SHAPE,
  top_addresses: ADDR_SHAPE,
  address_history: HISTORY_SHAPE,
  find_requests: FIND_REQUESTS_SHAPE,
  boardstat_link: LINK_SHAPE,
  boardstat_status: {},
};

export type DistrictToolName = keyof typeof DISTRICT_ARG_SHAPES;

export async function runDistrictTool(name: DistrictToolName, args: Record<string, unknown>, data: BoardStatData = boardstatData()): Promise<DistrictEnvelope<unknown>> {
  switch (name) {
    case "find_district":
      return findDistrict(data, args as never);
    case "district_summary":
      return districtSummary(data, args as never);
    case "top_problems":
      return topProblems(data, args as never);
    case "problem_trend":
      return problemTrend(data, args as never);
    case "agency_response":
      return agencyResponse(data, args as never);
    case "still_open":
      return stillOpen(data, args as never);
    case "top_addresses":
      return topAddresses(data, args as never);
    case "address_history":
      return addressHistory(data, args as never);
    case "find_requests":
      return findRequests(data, args as never);
    case "boardstat_link":
      return boardstatLink(data, args as never);
    case "boardstat_status":
      return boardstatStatus(data);
  }
}
