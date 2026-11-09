// Phase 2 (#15, epic #12): BetaNYC rebuilds of the three monthly reports that Local Law 47
// of 2005 (Int 0174-2004, Gale A. Brewer) put in Charter § 1075.
//
//   ll47_service_request_report       former § 1075(b), repealed by Local Law 69 of 2023
//   ll47_directory_assistance_report  former § 1075(c), repealed by Local Law 69 of 2023
//   cb_monthly_list                   § 1075(d), current law
//
// The service-request report and the community board list read BoardStat's published
// files, through the Phase 0/1 modules (boardstat-data.ts, district-tools.ts, envelope.ts,
// fiscal-year.ts), so they count exactly as BoardStat does:
//   - a request belongs to a month by its created_date (New York local time);
//   - "closed" means status = 'Closed'; every other status, or none, is "not closed";
//   - days to close count only Closed requests with a usable close date (days_to_close);
//   - a request is in a district by BoardStat's own placement (current boundary lines);
//     requests with no usable location are in no district file.
// The category is the City's own complaint type as published (complaint_type_raw), because
// that is what the law and the City's dashboards count. BoardStat's grouped problem names
// are used only where only its month file is read, and are labeled so.
//
// The directory-assistance report reads the 311 Call Center Inquiry dataset (wewp-mm3p)
// through soda.ts: one $group query per month, cached until the dataset changes (the month in
// progress, and the one before it for 7 days, also after an hour: OPEN_MONTH_TTL_MS).

import { z } from "zod";
import type { BoardStatManifest } from "./boardstat-data.js";
import {
  addDays,
  addressOf,
  BOROUGHS,
  boardstatData,
  byText,
  capped,
  days1,
  DISTRICT_JSON,
  DATA_AS_OF_JSON,
  DISTRICT_SHAPE,
  districtCaveats,
  districtOut,
  fmtLocal,
  lastDataDay,
  lastOfMonth,
  LIMIT,
  localAsDate,
  manifestDistricts,
  mean,
  median,
  obj,
  pin,
  resolveDistrict,
  type District,
  type DistrictEntry,
  type Reader,
  type Row,
  type Source,
} from "./district-tools.js";
import { assertNoZip, boardstatUrl, scrubZipValues, districtEnvelope, redactZip, type DistrictEnvelope } from "./envelope.js";
import { DATA_START, fiscalYearOf, fiscalYearRange, parseFiscalYear, resolvePeriod, type Period } from "./fiscal-year.js";
import { CALL_CENTER_DATASET, DeadlineError, sodaClient, sodaTrouble, timedOutAfter, waitInWords, type RequestOpts, type SodaClient, type SodaMetadata } from "./soda.js";

// ─── The mandate block every report carries ───────────────────────────────────

const NOT_OFFICIAL =
  "This is a BetaNYC rebuild from NYC Open Data, not the City's official report. Only the City can meet § 1075.";

const OMISSIONS = [
  "ZIP code breakdown: omitted by BetaNYC's decision. ZIP codes are postal delivery areas, not City districts, so this server does not use them.",
  "Data before 2020-01-01 is not included. The law counted from April 1, 2004.",
];

export type Mandate = {
  charter_section: string;
  rebuilds: string;
  law: string;
  status: "current" | "repealed";
  repealed_by?: string;
  text: string;
  note: string;
  omissions: string[];
};

export const MANDATES = {
  service_requests: {
    charter_section: "Charter § 1075(b) (former)",
    rebuilds: "The monthly report on requests for service",
    law: "Local Law 47 of 2005 (Int 0174-2004, Gale A. Brewer), https://intro.nyc/0174-2004",
    status: "repealed",
    repealed_by: "Local Law 69 of 2023 (Int 1004-2023), § 4, https://intro.nyc/1004-2023. § 1075(b) now reads \"Reserved.\"",
    text:
      "A monthly report on requests for service, \"disaggregated on a month-by-month and fiscal year-by-year basis\": totals by category and agency; totals by resolution status; \"the average resolution time for each request for service category by the agency\"; \"provided citywide and disaggregated by zip code, community district, council district and borough.\"",
    note: NOT_OFFICIAL,
    omissions: OMISSIONS,
  },
  directory_assistance: {
    charter_section: "Charter § 1075(c) (former)",
    rebuilds: "The monthly report on directory assistance calls",
    law: "Local Law 47 of 2005 (Int 0174-2004, Gale A. Brewer), https://intro.nyc/0174-2004",
    status: "repealed",
    repealed_by: "Local Law 69 of 2023 (Int 1004-2023), § 4, https://intro.nyc/1004-2023. § 1075(c) now reads \"Reserved.\"",
    text:
      "The same monthly report for directory assistance calls, by category and agency. § 1075(a) defines a directory assistance call as \"any call received by the 311 citizen service center that is entered into the 311 computer system in the directory assistance category.\"",
    note: NOT_OFFICIAL,
    omissions: OMISSIONS,
  },
  cb_list: {
    charter_section: "Charter § 1075(d)",
    rebuilds: "The monthly list to each community board",
    law: "Local Law 47 of 2005 (Int 0174-2004, Gale A. Brewer), https://intro.nyc/0174-2004; amended by Local Law 69 of 2023",
    status: "current",
    text:
      "\"Within seven business days from the end of each month, the department shall submit in electronic format to each community board a list setting forth all requests for service that were identified to have occurred in the respective community district received by the 311 citizen service center during the immediately preceding month, as well as all unresolved requests for service from prior months.\" For each: \"(1) the request for service category; (2) the agency or agencies to which the request for service was directed; and, (3) the current status of the request for service\".",
    note: NOT_OFFICIAL,
    omissions: OMISSIONS,
  },
} satisfies Record<string, Mandate>;

export type ReportEnvelope<T> = DistrictEnvelope<T> & { mandate: Mandate };

/** Adds the mandate and re-runs both ZIP checks over the finished answer. */
function withMandate<T>(env: DistrictEnvelope<T>, mandate: Mandate): ReportEnvelope<T> {
  const out = { ...env, mandate };
  assertNoZip(out);
  return scrubZipValues(out);
}

// ─── Report months ────────────────────────────────────────────────────────────

const MONTH = /^(\d{4})-(\d{2})$/;

export function parseMonth(s: string): string {
  const m = MONTH.exec(s.trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`Invalid month '${s}': expected YYYY-MM, e.g. 2026-10.`);
  return `${m[1]}-${m[2]}`;
}

function prevMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const mo = Number(ym.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

/** The newest calendar month that is complete in data ending on `lastDay`. */
export function lastCompleteMonth(lastDay: string): string {
  const ym = lastDay.slice(0, 7);
  return lastDay === lastOfMonth(ym) ? ym : prevMonth(ym);
}

export type ReportPeriods = {
  /** The calendar month, when the report is for a month. */
  month: (Period & { month: string }) | null;
  /** The fiscal year to date through the month's end, or the fiscal year asked for. */
  fiscal_year: Period;
  notes: string[];
};

/**
 * A month (and its fiscal year to date) or a fiscal year, inside `window`. With neither,
 * the newest complete month. The FY to date runs from July 1 to the end of the month,
 * as the 2005 law's "fiscal year-by-year basis" and the City's own FYTD columns do.
 */
export function reportPeriods(
  args: { month?: string; fiscal_year?: number | string },
  window: { start: string; end: string },
  defaultMonth: string
): ReportPeriods {
  if (args.month !== undefined && args.fiscal_year !== undefined) {
    throw new Error("Give month or fiscal_year, not both. A month's answer also gives its fiscal year to date, from saved months.");
  }
  const notes: string[] = [];
  if (args.fiscal_year !== undefined) {
    const fy = parseFiscalYear(args.fiscal_year);
    const p = resolvePeriod({ fiscal_year: fy }, window);
    return { month: null, fiscal_year: p, notes: [...p.notes] };
  }
  const ym = args.month !== undefined ? parseMonth(args.month) : defaultMonth;
  if (args.month === undefined) notes.push(`No month was given, so this is the newest complete month in the data, ${ym}.`);
  const first = `${ym}-01`;
  const last = lastOfMonth(ym);
  if (last < DATA_START) throw new Error(`${ym} is before the data begins (${DATA_START}). This rebuild covers 2020 on.`);
  const m = resolvePeriod({ from_date: first, to_date: last }, window);
  const fy = fiscalYearOf(first);
  const fyr = fiscalYearRange(fy);
  const f = resolvePeriod({ from_date: fyr.start, to_date: last }, window);
  f.fiscal_year = fy;
  f.label = `FY${fy} to date (${f.start} to ${f.end})`;
  if (m.end !== last) notes.push(`${ym} is not complete in the data: it runs to ${m.end}.`);
  notes.push(...m.notes.filter((n) => !notes.includes(n)));
  for (const n of f.notes) if (!notes.includes(n)) notes.push(n);
  return { month: { ...m, month: ym, label: `${ym} (${m.start} to ${m.end})` }, fiscal_year: f, notes };
}

const periodOut = (p: Period) => ({ start: p.start, end: p.end, label: p.label, ...(p.fiscal_year !== undefined ? { fiscal_year: p.fiscal_year } : {}) });

// ─── 1. ll47_service_request_report (former § 1075(b)) ────────────────────────

const GEO_KINDS = ["community_district", "council_district", "borough"] as const;

const SR_SHAPE = {
  month: z.string().optional(),
  fiscal_year: z.union([z.number().int(), z.string()]).optional(),
  ...DISTRICT_SHAPE,
  borough: z.enum(BOROUGHS).optional(),
  by_district: z.enum(GEO_KINDS).optional(),
  read_every_district: z.boolean().optional(),
  limit: LIMIT(1000),
};

const SR_COLUMNS = ["created_date", "complaint_type_raw", "agency", "agency_name", "status", "days_to_close"];

type CatAgency = { category: string; agency: string; requests: number; closed: number; days: number[] };

/** Running totals for one period, filled one district file at a time. */
class Tally {
  requests = 0;
  byCategory = new Map<string, number>();
  byAgency = new Map<string, { name: string | null; n: number }>();
  byStatus = new Map<string, number>();
  byCatAgency = new Map<string, CatAgency>();
  closedDays: number[] = [];

  add(r: Row) {
    const cat = r.complaint_type_raw == null ? "(none)" : String(r.complaint_type_raw);
    const agency = r.agency == null ? "(none)" : String(r.agency);
    const status = r.status == null ? "(none)" : String(r.status);
    this.requests += 1;
    this.byCategory.set(cat, (this.byCategory.get(cat) ?? 0) + 1);
    const a = this.byAgency.get(agency);
    if (a) {
      a.n += 1;
      if (!a.name && r.agency_name) a.name = String(r.agency_name);
    } else this.byAgency.set(agency, { name: r.agency_name ? String(r.agency_name) : null, n: 1 });
    this.byStatus.set(status, (this.byStatus.get(status) ?? 0) + 1);
    const key = `${cat}\u0000${agency}`;
    let ca = this.byCatAgency.get(key);
    if (!ca) this.byCatAgency.set(key, (ca = { category: cat, agency, requests: 0, closed: 0, days: [] }));
    ca.requests += 1;
    if (r.status === "Closed") {
      ca.closed += 1;
      if (typeof r.days_to_close === "number") {
        ca.days.push(r.days_to_close);
        this.closedDays.push(r.days_to_close);
      }
    }
  }

  out(limit: number) {
    const desc = <T extends { requests: number }>(k: (x: T) => string) => (a: T, b: T) => b.requests - a.requests || byText(k(a), k(b));
    const cats = capped(
      [...this.byCategory].map(([category, requests]) => ({ category: redactZip(category), requests })).sort(desc((x) => x.category)),
      limit
    );
    const agencies = [...this.byAgency]
      .map(([agency, v]) => ({ agency, agency_name: v.name, requests: v.n }))
      .sort(desc((x) => x.agency));
    const statuses = [...this.byStatus].map(([status, requests]) => ({ status, requests })).sort(desc((x) => x.status));
    const rt = capped(
      [...this.byCatAgency.values()]
        .map((c) => ({
          category: redactZip(c.category),
          agency: c.agency,
          requests: c.requests,
          closed: c.closed,
          average_days_to_close: days1(mean(c.days)),
          median_days_to_close: days1(median(c.days)),
        }))
        .sort((a, b) => b.requests - a.requests || byText(a.category, b.category) || byText(a.agency, b.agency)),
      limit
    );
    return {
      requests: this.requests,
      closed: this.byStatus.get("Closed") ?? 0,
      not_closed: this.requests - (this.byStatus.get("Closed") ?? 0),
      average_days_to_close: days1(mean(this.closedDays)),
      median_days_to_close: days1(median(this.closedDays)),
      by_category: cats.items,
      by_category_truncated: cats.truncated,
      category_count: cats.total_items,
      by_agency: agencies,
      by_status: statuses,
      resolution_time_by_category_and_agency: rt.items,
      resolution_time_truncated: rt.truncated,
      category_agency_pairs: rt.total_items,
    };
  }
}

type Scope =
  | { kind: "citywide" }
  | { kind: "borough"; borough: (typeof BOROUGHS)[number] }
  | { kind: "district"; district: District };

function scopeOf(m: BoardStatManifest, args: z.infer<z.ZodObject<typeof SR_SHAPE>>): Scope {
  const given = [args.community_district, args.council_district, args.borough].filter((v) => v !== undefined).length;
  if (given > 1) throw new Error("Give at most one of community_district, council_district or borough. With none, the report is citywide.");
  if (args.borough) return { kind: "borough", borough: args.borough };
  if (args.community_district !== undefined || args.council_district !== undefined) return { kind: "district", district: resolveDistrict(m, args) };
  return { kind: "citywide" };
}

/** The community-district files that make up the city or one borough (Joint Interest Areas included). */
function filesFor(m: BoardStatManifest, scope: Scope): DistrictEntry[] {
  return manifestDistricts(m).cd.filter((e) => e.file && (scope.kind === "citywide" || (scope.kind === "borough" && e.borough === scope.borough)));
}

function mb(bytes: number) {
  return Math.round(bytes / 1e6);
}

/** Month-file counts (BoardStat's grouped problem names) by geo_id for the given months. */
async function aggByGeo(data: Reader, kind: string, months: { from: string; to: string }, geoId?: string) {
  const filter: Record<string, unknown> = { geo_kind: { $eq: kind }, year_month: { $gte: months.from, $lte: months.to } };
  if (geoId !== undefined) filter.geo_id = { $eq: geoId };
  const { rows } = await data.readParquet("agg/month_type.parquet", { columns: ["geo_kind", "geo_id", "year_month", "complaint_type", "n"], filter });
  return rows;
}

function sumTypes(rows: Row[], ym?: string) {
  const m = new Map<string, number>();
  for (const r of rows) if (!ym || r.year_month === ym) m.set(String(r.complaint_type), (m.get(String(r.complaint_type)) ?? 0) + Number(r.n));
  return m;
}

const ymOf = (p: Period) => ({ from: p.start.slice(0, 7), to: p.end.slice(0, 7) });

export async function serviceRequestReport(src: Source, args: z.infer<z.ZodObject<typeof SR_SHAPE>>) {
  const data = await pin(src);
  const mr = await data.manifest();
  const m = mr.manifest;
  const window = { start: m.window.start, end: lastDataDay(m) };
  const periods = reportPeriods(args, window, lastCompleteMonth(lastDataDay(m)));
  const limit = args.limit ?? 50;
  const list = periods.month ? [periods.month, periods.fiscal_year] : [periods.fiscal_year];
  const caveats = [
    ...periods.notes,
    "A request is counted in the month it was created (New York time). Its status and close date are as of when this data was built, not as of the month's end.",
    "Category is the City's own complaint type, as written on each request. Average and median days to close count only requests marked Closed with a usable close date; the median is a BetaNYC addition, not in the law.",
    "Requests closed before they were created, or with a close date in the future, are left out of the time (City data errors).",
    "Only requests with a usable location are in BoardStat's district files, so totals here leave out requests the City could not place. The City's own dashboards count those too.",
  ];

  // The table of every district: BoardStat's month file, which is small.
  if (args.by_district) {
    if (args.community_district !== undefined || args.council_district !== undefined) {
      throw new Error("by_district lists every district, so it cannot be combined with community_district or council_district. borough may narrow it.");
    }
    if (args.read_every_district) throw new Error("by_district always uses BoardStat's month file; read_every_district does not apply.");
    const kind = args.by_district === "community_district" ? "cd" : args.by_district === "council_district" ? "cc" : "borough";
    const fy = periods.fiscal_year;
    const rows = await aggByGeo(data, kind, ymOf(fy));
    const entries =
      kind === "borough"
        ? BOROUGHS.map((b) => ({ id: b as string | number, label: b as string, borough: b as string | null, jia: false }))
        : manifestDistricts(m)[kind as "cd" | "cc"].map((e) => ({ id: e.id as string | number, label: e.label, borough: e.borough, jia: Boolean(e.jia) }));
    const kept = entries.filter((e) => !args.borough || e.borough === args.borough);
    const table = kept
      .map((e) => {
        const mine = rows.filter((r) => String(r.geo_id) === String(e.id));
        const monthTypes = periods.month ? sumTypes(mine, periods.month.month) : null;
        const fyTypes = sumTypes(mine);
        const top = [...(monthTypes ?? fyTypes)].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0];
        const total = (x: Map<string, number>) => [...x.values()].reduce((a, b) => a + b, 0);
        return {
          id: e.id,
          label: e.label,
          borough: e.borough,
          ...(monthTypes ? { requests_month: total(monthTypes) } : {}),
          requests_fiscal_year: total(fyTypes),
          top_problem: top ? { problem: top[0], requests: top[1] } : null,
        };
      });
    const shown = Math.min(limit, 100);
    const out = capped(table, shown);
    // Said in words, not only as truncated: true (beta test 2026-11-08: limit 5 showed 5 of
    // 18 Brooklyn districts with no clear signal, and limit read as a category count).
    // Brooklyn's 20 rows are 18 community districts and 2 Joint Interest Areas (parks and
    // other areas outside every community district); the count says so (beta retest 1).
    const jias = kept.filter((e) => e.jia).length;
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const what =
      kind === "borough"
        ? "boroughs"
        : kind === "cc"
          ? "Council districts"
          : jias
            ? `areas (${plural(out.total_items - jias, "community district", "community districts")} and ${plural(jias, "Joint Interest Area", "Joint Interest Areas")})`
            : "community districts";
    const cut = out.truncated
      ? `Showing ${out.items.length} of ${out.total_items} ${what}, because limit is ${shown}: with by_district, limit counts rows of this table. Give limit ${out.total_items} to see every one.`
      : null;
    const env = districtEnvelope({
      manifest: mr,
      siteUrl: data.siteUrl,
      data: {
        geography: `every ${args.by_district.replace("_", " ")}${args.borough ? ` in ${args.borough}` : ""}`,
        month: periods.month ? periodOut(periods.month) : null,
        fiscal_year: periodOut(fy),
        districts: out.items,
        truncated: out.truncated,
        district_count: out.total_items,
        ...(cut ? { truncation_note: cut } : {}),
      },
      extraCaveats: [
        ...(cut ? [cut] : []),
        ...caveats,
        "This table comes from BoardStat's month file: whole months, and BoardStat's grouped problem names (top_problem), which have not yet been reviewed. Ask for one district to get agencies, statuses and days to close.",
        ...(kind === "cc" ? ["Council districts are placed by BoardStat, by where each request happened and today's Council lines."] : []),
      ],
    });
    return withMandate(env, MANDATES.service_requests);
  }

  const scope = scopeOf(m, args);
  const geography =
    scope.kind === "citywide"
      ? { kind: "citywide", label: "New York City" }
      : scope.kind === "borough"
        ? { kind: "borough", label: scope.borough }
        : districtOut(scope.district);
  const extra = scope.kind === "district" ? districtCaveats(scope.district, m) : [];

  // Citywide or one borough, without reading every district file: totals by problem from the month file.
  if (scope.kind !== "district" && !args.read_every_district) {
    const files = filesFor(m, scope);
    const bytes = files.reduce((a, e) => a + (m.files[e.file as string] ?? 0), 0);
    const rows = await aggByGeo(data, scope.kind === "citywide" ? "city" : "borough", ymOf(periods.fiscal_year), scope.kind === "borough" ? scope.borough : undefined);
    const section = (ym?: string) => {
      const t = sumTypes(rows, ym);
      const list = capped(
        [...t].map(([problem, requests]) => ({ problem, requests })).sort((a, b) => b.requests - a.requests || byText(a.problem, b.problem)),
        limit
      );
      return {
        requests: [...t.values()].reduce((a, b) => a + b, 0),
        by_problem: list.items,
        by_problem_truncated: list.truncated,
        problem_count: list.total_items,
        by_agency: null,
        by_status: null,
        resolution_time_by_category_and_agency: null,
      };
    };
    const env = districtEnvelope({
      manifest: mr,
      siteUrl: data.siteUrl,
      data: {
        geography,
        complete: false,
        how_to_get_the_rest: `Totals by agency, by status and days to close need every ${scope.kind === "citywide" ? "" : `${scope.borough} `}community district file: ${files.length} files, about ${mb(bytes)} MB, downloaded once per nightly build and kept in the cache. Ask again with read_every_district: true, or ask for one community or council district.`,
        month: periods.month ? { ...periodOut(periods.month), ...section(periods.month.month) } : null,
        fiscal_year: { ...periodOut(periods.fiscal_year), ...section() },
      },
      extraCaveats: [
        ...caveats,
        "This answer comes from BoardStat's month file: whole months, and BoardStat's grouped problem names (not the City's exact complaint types), which have not yet been reviewed.",
      ],
    });
    return withMandate(env, MANDATES.service_requests);
  }

  // Full report: read the district file(s), one at a time, and tally each period.
  const files = scope.kind === "district" ? [scope.district.file] : filesFor(m, scope).map((e) => e.file as string);
  const from = list.reduce((a, p) => (p.start < a ? p.start : a), list[0].start);
  const to = list.reduce((a, p) => (p.end > a ? p.end : a), list[0].end);
  const tallies = list.map(() => new Tally());
  const bounds = list.map((p) => [localAsDate(p.start).getTime(), localAsDate(addDays(p.end, 1)).getTime()] as const);
  for (const file of files) {
    const { rows } = await data.readParquet(file, {
      columns: SR_COLUMNS,
      filter: { created_date: { $gte: localAsDate(from), $lt: localAsDate(addDays(to, 1)) } },
    });
    for (const r of rows) {
      const t = (r.created_date as Date).getTime();
      bounds.forEach(([a, b], i) => {
        if (t >= a && t < b) tallies[i].add(r);
      });
    }
  }
  const section = (i: number) => ({ ...periodOut(list[i]), ...tallies[i].out(limit) });
  const env = districtEnvelope({
    manifest: mr,
    siteUrl: data.siteUrl,
    link: scope.kind === "district" ? { geo: scope.district.geo, id: scope.district.id, start: list[0].start, end: list[0].end } : {},
    data: {
      geography,
      complete: true,
      ...(scope.kind !== "district" ? { district_files_read: files.length } : {}),
      month: periods.month ? section(0) : null,
      fiscal_year: section(periods.month ? 1 : 0),
    },
    extraCaveats: [...caveats, ...extra],
  });
  return withMandate(env, MANDATES.service_requests);
}

// ─── 2. ll47_directory_assistance_report (former § 1075(c)) ───────────────────

const DA_SHAPE = {
  month: z.string().optional(),
  fiscal_year: z.union([z.number().int(), z.string()]).optional(),
  limit: LIMIT(2000),
};

/** One month's calls, grouped server-side. Missing keys are blanks (Socrata leaves nulls out). */
export type CallGroup = { inquiry_name: string; agency: string | null; agency_name: string | null; call_resolution: string | null; n: number };

function monthWhere(ym: string): string {
  const next = ym.endsWith("-12") ? `${Number(ym.slice(0, 4)) + 1}-01` : `${ym.slice(0, 5)}${String(Number(ym.slice(5, 7)) + 1).padStart(2, "0")}`;
  return `date >= '${ym}-01T00:00:00' AND date < '${next}-01T00:00:00'`;
}

/**
 * The light query, asked first for every month: calls by topic, plus how many of them have an
 * agency and a call_resolution (SoQL count(column) counts non-null values,
 * https://dev.socrata.com/docs/functions/count). Grouping by one column instead of four is
 * cheaper for the portal (beta retest 2, 2026-11-09: October took 40 to 58 s this way, 74 s
 * with the four-column group). Columns checked in the dataset's metadata, /api/views/wewp-mm3p.json.
 */
function monthLightQuery(ym: string): Record<string, string> {
  return {
    $select: "inquiry_name, count(*) AS n, count(agency) AS with_agency, count(call_resolution) AS with_resolution",
    $where: monthWhere(ym),
    $group: "inquiry_name",
    $order: "inquiry_name",
  };
}

/** The full breakdown, asked only for a month whose calls do carry an agency or a call_resolution. */
function monthQuery(ym: string): Record<string, string> {
  return {
    $select: "inquiry_name, agency, agency_name, call_resolution, count(*) AS n",
    $where: monthWhere(ym),
    $group: "inquiry_name, agency, agency_name, call_resolution",
    $order: "inquiry_name, agency, agency_name, call_resolution",
  };
}

/** One month's call groups: the light query, and the full one only when it is needed. */
async function fetchMonth(soda: SodaClient, ym: string, opts: RequestOpts): Promise<CallGroup[]> {
  const light = await soda.queryAll(CALL_CENTER_DATASET, monthLightQuery(ym), opts);
  const filled = light.reduce((a, r) => a + (Number(r.with_agency) || 0) + (Number(r.with_resolution) || 0), 0);
  if (filled === 0) return light.map((r) => toGroup({ inquiry_name: r.inquiry_name, n: r.n }));
  return (await soda.queryAll(CALL_CENTER_DATASET, monthQuery(ym), opts)).map(toGroup);
}

function toGroup(r: Record<string, unknown>): CallGroup {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const n = Number(r.n);
  if (!Number.isFinite(n)) throw new Error("NYC Open Data returned a call count that is not a number.");
  return { inquiry_name: s(r.inquiry_name) ?? "(none)", agency: s(r.agency), agency_name: s(r.agency_name), call_resolution: s(r.call_resolution), n };
}

/** A month is settled once it ended more than this many days ago: late records have landed. */
export const SETTLED_AFTER_DAYS = 7;
/** A settled month's saved answer is re-asked after this long, whatever the dataset version. */
export const SETTLED_TTL_DAYS = 30;
/**
 * A month not yet settled (the month in progress, and the month before it until it is
 * SETTLED_AFTER_DAYS days over) is re-asked once its saved copy is older than this, even when
 * the dataset's rowsUpdatedAt has not moved: rows keep arriving without it moving. Beta retest
 * 6, 2026-11-09: November grew by 4,861 calls under the same rowsUpdatedAt, so an older saved
 * copy answered 1,264,433 for FY2027 and a fresh one 1,269,294. One hour keeps a busy
 * conversation to one query per hour for that month.
 */
export const OPEN_MONTH_TTL_MS = 60 * 60_000;

/** A month is settled once it ended more than SETTLED_AFTER_DAYS ago. */
function isSettled(ym: string, today: string): boolean {
  return addDays(lastOfMonth(ym), SETTLED_AFTER_DAYS) < today;
}

/**
 * Whether a saved month may answer now without asking NYC Open Data. A settled month: for
 * SETTLED_TTL_DAYS, whatever the dataset version (its rowsUpdatedAt moves every night; QA on
 * #21). A month not settled: while the dataset version is the same AND the copy is younger
 * than OPEN_MONTH_TTL_MS.
 */
export function savedIsFresh(saved: { version: number; fetched_at_ms: number }, ym: string, today: string, rowsUpdatedAt: number, now: number): boolean {
  const age = now - saved.fetched_at_ms;
  if (isSettled(ym, today)) return age < SETTLED_TTL_DAYS * 86_400_000;
  return saved.version === rowsUpdatedAt && age < OPEN_MONTH_TTL_MS;
}
/**
 * One call's time budget for NYC Open Data, waits and retries included. Kept under a minute,
 * the time many MCP clients wait for a tool before they give up themselves.
 */
export const DA_BUDGET_MS = 58_000;
/**
 * Each request to NYC Open Data in this report: up to 55 s (the City's dataset answered a
 * month in 40 to 74 s on 2026-11-09, slow but up), two tries at most, no retry after a
 * timeout or after a failure that took 5 s or more. When the portal is failing outright, the
 * answer still comes in seconds (beta retest 1, 2026-11-08: slow 503s used the whole budget).
 */
export const DA_REQUEST = { maxTries: 2, timeoutMs: 55_000, noRetryAfterMs: 5_000 } as const;

/**
 * A fiscal-year call answers within this long (real time). Saved months answer at once;
 * months not saved are fetched, and any not done by then are listed as still loading.
 * Beta retest 4, 2026-11-09: the first FY2027 call waited ~55 s on one slow month.
 */
export const DA_ANSWER_WAIT_MS = 12_000;
/**
 * Months fetched at once: one. Engineering standards §6: "Never run requests to the same
 * portal in parallel." (The SodaClient also sends one request at a time.)
 */
export const DA_CONCURRENT_MONTHS = 1;
/**
 * A month a fiscal-year call started keeps loading after the answer, and is saved when done,
 * for up to this long in all. Each request still has its own DA_REQUEST limits.
 */
export const DA_BACKGROUND_MS = 4 * 60_000;
/**
 * After a month fails in the background (an error from NYC Open Data, or no answer in time),
 * the load goes on to the next month, and the failed one is asked again later, at most
 * DA_MONTH_TRIES times in all. Before each request after a failure it pauses, starting at
 * DA_RETRY_PAUSE_MS and doubling with each failure in a row, up to DA_RETRY_PAUSE_MAX_MS; a
 * success resets it. Still one request at a time (standards §6), and within DA_BACKGROUND_MS.
 * Beta retest 6, 2026-11-09: one 503 on October stopped the load, November was "not tried",
 * and the next call had to start it again (5 of 16 calls were spent that way).
 */
export const DA_MONTH_TRIES = 4;
export const DA_RETRY_PAUSE_MS = 3_000;
export const DA_RETRY_PAUSE_MAX_MS = 30_000;
/**
 * The tries are counted per month for the life of the server, across calls and background
 * loads, and cleared when the month answers. After DA_MONTH_TRIES failures in a row the month
 * rests this long, asking NYC Open Data nothing, then a new round of tries starts. Beta retest
 * 7, 2026-11-09: the count lived in each load and restarted at 1 with every new one, so July
 * failed six times and every answer said "try 1 of 4", and the limit never applied.
 */
export const DA_REST_MS = 10 * 60_000;
/** Why a month is missing while it waits to be asked again. */
export function retryingWhy(trouble: Trouble, tries: number): string {
  return `retrying: NYC Open Data ${trouble === "slow" ? "was too slow to answer" : "returned an error or could not be reached"} for this month (try ${tries} of ${DA_MONTH_TRIES} failed). It is asked again in the background after a pause, and saved when it answers; ask again in a minute.`;
}
/** Why a month is missing while it rests after DA_MONTH_TRIES failures in a row. */
export function restingWhy(last: string, until: number): string {
  const at = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(until));
  return `${last}. It failed ${DA_MONTH_TRIES} times in a row, so it is not asked again until ${at} New York time (a ${DA_REST_MS / 60_000}-minute rest, to spare the portal); ask again after that.`;
}
/** Why a fiscal-year month is missing when the answer did not wait for it. */
export const STILL_LOADING =
  "still loading: NYC Open Data is slow to answer this month, so this answer did not wait for it. It keeps loading and is saved when done; ask again in a minute.";

/** A fiscal-year call on an empty cache whose dataset metadata did not arrive within the wait. */
export const FY_METADATA_SLOW =
  "NYC Open Data is slow to answer right now, so no month of this fiscal year could be read within this answer's wait. The months are loading in the background and are saved as they arrive; ask again in a minute.";

/** Why a fiscal-year month is missing from a one-month call's year to date. */
export const ONE_MONTH_ONLY = "not fetched: a one-month call fetches only its own month; this one is not saved yet";

const TRY_LATER =
  "Try again later, or ask for the fiscal year instead of one month (fiscal_year, without month): months already saved answer it without NYC Open Data.";

/** The plain message when NYC Open Data is failing (HTTP 5xx, or no connection). */
export function openDataDown(ym: string | null): string {
  return `NYC Open Data is not responding right now: the 311 Call Center Inquiry dataset (wewp-mm3p) did not answer${ym ? ` for ${ym}` : ""}. That is on the City's side, not the question. ${TRY_LATER}`;
}

/** The plain message when NYC Open Data is up but too slow to answer in time. */
export function openDataSlow(ym: string | null, waitedMs: number = DA_REQUEST.timeoutMs): string {
  return `NYC Open Data is slow right now: the 311 Call Center Inquiry dataset (wewp-mm3p) did not finish answering${ym ? ` for ${ym}` : ""} within ${waitInWords(waitedMs)}. It did not fail; it was too busy to answer in time. That is on the City's side, not the question. ${TRY_LATER}`;
}

type Trouble = "slow" | "down" | null;
type MonthResult =
  | { ym: string; groups: CallGroup[]; from: "cache" | "query" | "old_cache"; fetched_at: string }
  | { ym: string; missing: string; trouble: Trouble; loading?: true };

/**
 * One month's calls. A settled month (ended over SETTLED_AFTER_DAYS ago) is answered from the
 * saved copy for SETTLED_TTL_DAYS, whatever the dataset version, because the dataset's
 * rowsUpdatedAt moves every night (QA on #21). A recent month is re-asked when the dataset
 * changes. When NYC Open Data cannot be reached, or the call's time is up, any saved copy
 * answers; with none, the month is reported missing rather than guessed.
 */
async function monthCalls(
  soda: SodaClient,
  meta: { meta: SodaMetadata; stale: boolean },
  ym: string,
  today: string,
  deadline: number,
  give: { up: boolean; why?: string; trouble?: Trouble },
  request: RequestOpts
): Promise<MonthResult> {
  const key = `${CALL_CENTER_DATASET}/${ym}`;
  const saved = await soda.readCache<CallGroup[]>(key);
  const iso = (ms: number) => new Date(ms).toISOString();
  if (saved) {
    const fresh = savedIsFresh(saved, ym, today, meta.meta.rowsUpdatedAt, soda.clock());
    if (fresh || meta.stale) return { ym, groups: saved.value, from: fresh ? "cache" : "old_cache", fetched_at: iso(saved.fetched_at_ms) };
  }
  if (saved && give.up) return { ym, groups: saved.value, from: "old_cache", fetched_at: iso(saved.fetched_at_ms) };
  if (meta.stale || give.up) {
    return meta.stale
      ? { ym, missing: "NYC Open Data could not be reached and no saved copy exists", trouble: "down" }
      : { ym, missing: give.why ?? "this call ran out of time before reaching it", trouble: give.trouble ?? "slow" };
  }
  // A fiscal-year call is already fetching this month: wait on that request, not a second one.
  const running = loading.get(soda)?.get(ym);
  if (running) {
    let r: MonthResult | undefined;
    running.then((x) => (r = x));
    await waitFor([running], Math.max(0, deadline - soda.clock()));
    if (r) return r;
    if (saved) return { ym, groups: saved.value, from: "old_cache", fetched_at: iso(saved.fetched_at_ms) };
    return { ym, missing: pendingWhy(soda, ym), trouble: "slow", loading: true };
  }
  try {
    const groups = await fetchMonth(soda, ym, { deadline, ...request });
    await soda.writeCache(key, meta.meta.rowsUpdatedAt, groups);
    return { ym, groups, from: "query", fetched_at: iso(soda.clock()) };
  } catch (err) {
    // Out of time, too slow, or failing after its retries: the other months are not tried.
    const trouble = sodaTrouble(err);
    if (trouble) {
      give.up = true;
      give.trouble = trouble;
      give.why =
        err instanceof DeadlineError
          ? "this call ran out of time before reaching it"
          : trouble === "slow"
            ? "not tried: NYC Open Data was too slow on an earlier month in this call"
            : "not tried: NYC Open Data was failing on an earlier month in this call";
    }
    if (saved) return { ym, groups: saved.value, from: "old_cache", fetched_at: iso(saved.fetched_at_ms) };
    const allowed = request.timeoutMs ?? DA_REQUEST.timeoutMs;
    const waited = timedOutAfter(err);
    const missing =
      err instanceof DeadlineError
        ? "this call ran out of time before reaching it"
        : trouble === "slow" && waited !== null && waited < allowed
          ? "this call ran out of time before NYC Open Data answered it"
          : trouble === "slow"
            ? `NYC Open Data was too slow: it sent no answer within ${waitInWords(allowed)}`
          : trouble === "down"
            ? "NYC Open Data was not responding (it returned an error or could not be reached)"
            : `NYC Open Data failed: ${err instanceof Error ? err.message : String(err)}`;
    return { ym, missing, trouble };
  }
}

/**
 * A month's saved answer, if it may be used now (see savedIsFresh). Otherwise `fresh` is null
 * and `older` is the saved copy, if any, to answer with when the month cannot be fetched in time.
 */
async function savedMonth(
  soda: SodaClient,
  meta: { meta: SodaMetadata; stale: boolean },
  ym: string,
  today: string
): Promise<{ fresh: MonthResult | null; older: MonthResult | null }> {
  const saved = await soda.readCache<CallGroup[]>(`${CALL_CENTER_DATASET}/${ym}`);
  if (!saved) return { fresh: meta.stale ? { ym, missing: "NYC Open Data could not be reached and no saved copy exists", trouble: "down" } : null, older: null };
  const fresh = savedIsFresh(saved, ym, today, meta.meta.rowsUpdatedAt, soda.clock());
  const at = new Date(saved.fetched_at_ms).toISOString();
  if (fresh || meta.stale) return { fresh: { ym, groups: saved.value, from: fresh ? "cache" : "old_cache", fetched_at: at }, older: null };
  return { fresh: null, older: { ym, groups: saved.value, from: "old_cache", fetched_at: at } };
}

/**
 * Months being fetched, per client, so a second call waits on the same request rather than
 * asking NYC Open Data again. Each promise always resolves (never rejects): its month's
 * calls, or why it is missing. Removed when done; the saved copy answers after that.
 */
const loading = new WeakMap<SodaClient, Map<string, Promise<MonthResult>>>();

/**
 * Failures in a row per month, per client, kept across calls and loads (DA_REST_MS): how many
 * tries failed, the last trouble and reason, and, after DA_MONTH_TRIES, when the rest ends.
 */
type Failures = { tries: number; trouble: Trouble; last: string; restUntil?: number };
const failed = new WeakMap<SodaClient, Map<string, Failures>>();
function failuresOf(soda: SodaClient): Map<string, Failures> {
  let m = failed.get(soda);
  if (!m) failed.set(soda, (m = new Map()));
  return m;
}
/** Why a month not yet in is missing: still loading, or retrying after n failed tries. */
function pendingWhy(soda: SodaClient, ym: string): string {
  const f = failed.get(soda)?.get(ym);
  return f && !f.restUntil ? retryingWhy(f.trouble, f.tries) : STILL_LOADING;
}

/**
 * Fetch `months`, one at a time (DA_CONCURRENT_MONTHS), and save each as it arrives. A month
 * that fails does not stop the others: it goes to the back of the line and is asked again,
 * after a pause that grows with each failure in a row (DA_RETRY_PAUSE_MS, doubling, up to
 * DA_RETRY_PAUSE_MAX_MS), at most DA_MONTH_TRIES times, and never after `deadline`. A failure
 * that is not NYC Open Data's (a 400, a bad answer) is not asked again. Returns one promise per
 * month; none rejects, and nothing is left that can throw after the caller stops waiting.
 */
function loadMonths(
  soda: SodaClient,
  meta: SodaMetadata,
  months: string[],
  request: RequestOpts,
  deadline: number,
  pauseMs: number = DA_RETRY_PAUSE_MS
): Map<string, Promise<MonthResult>> {
  let busy = loading.get(soda);
  if (!busy) loading.set(soda, (busy = new Map()));
  const fails = failuresOf(soda);
  const out = new Map<string, Promise<MonthResult>>();
  type Job = { ym: string; tries: number; last?: Extract<MonthResult, { missing: string }>; done: (r: MonthResult) => void };
  const queue: Job[] = [];
  for (const ym of months) {
    const running = busy.get(ym);
    if (running) {
      out.set(ym, running);
      continue;
    }
    const f = fails.get(ym);
    if (f?.restUntil !== undefined) {
      if (soda.clock() < f.restUntil) {
        out.set(ym, Promise.resolve({ ym, missing: restingWhy(f.last, f.restUntil), trouble: f.trouble }));
        continue;
      }
      fails.delete(ym); // the rest is over: a new round of tries
    }
    let done!: (r: MonthResult) => void;
    const p = new Promise<MonthResult>((r) => (done = r));
    const own = busy;
    busy.set(ym, p);
    p.then(() => own.delete(ym));
    out.set(ym, p);
    queue.push({ ym, tries: fails.get(ym)?.tries ?? 0, done });
  }
  const one = async (ym: string): Promise<MonthResult & { late?: boolean }> => {
    try {
      const groups = await fetchMonth(soda, ym, { ...request, deadline });
      await soda.writeCache(`${CALL_CENTER_DATASET}/${ym}`, meta.rowsUpdatedAt, groups).catch(() => undefined);
      return { ym, groups, from: "query", fetched_at: new Date(soda.clock()).toISOString() };
    } catch (err) {
      const t = sodaTrouble(err);
      const allowed = request.timeoutMs ?? DA_REQUEST.timeoutMs;
      const missing =
        err instanceof DeadlineError
          ? "NYC Open Data did not finish answering in the time allowed; ask again later"
          : t === "slow"
            ? `NYC Open Data was too slow: it sent no answer within ${waitInWords(allowed)}; ask again later`
            : t === "down"
              ? "NYC Open Data was not responding (it returned an error or could not be reached)"
              : `NYC Open Data failed: ${err instanceof Error ? err.message : String(err)}`;
      return { ym, missing, trouble: t, ...(err instanceof DeadlineError ? { late: true } : {}) };
    }
  };
  // Out of background time: a month that was tried says what went wrong and how often.
  const outOfTime = (x: Job): MonthResult =>
    x.last
      ? { ...x.last, missing: retryingWhy(x.last.trouble, x.tries), loading: true }
      : { ym: x.ym, missing: "NYC Open Data did not finish answering in the time allowed; ask again later", trouble: "slow" };
  const worker = async () => {
    let failures = 0;
    for (let job = queue.shift(); job; job = queue.shift()) {
      const j = job;
      try {
        if (failures) {
          const ms = Math.min(DA_RETRY_PAUSE_MAX_MS, pauseMs * 2 ** (failures - 1));
          if (soda.clock() + ms >= deadline) {
            for (const x of [j, ...queue.splice(0)]) x.done(outOfTime(x));
            return;
          }
          await soda.pause(ms);
        }
        j.tries += 1;
        const r = await one(j.ym);
        if ("groups" in r) {
          failures = 0;
          fails.delete(j.ym);
          j.done(r);
          continue;
        }
        failures += 1;
        const { late, ...rest } = r;
        // A try the load's time limit cut short still counts: a request was sent and not answered.
        const result = (late ? { ...rest, trouble: rest.trouble ?? "slow" } : rest) as Extract<MonthResult, { missing: string }>;
        j.last = result;
        if (!result.trouble) {
          fails.delete(j.ym);
          j.done(result);
        } else if (j.tries < DA_MONTH_TRIES) {
          fails.set(j.ym, { tries: j.tries, trouble: result.trouble, last: result.missing });
          if (late) {
            for (const x of [j, ...queue.splice(0)]) x.done(outOfTime(x));
            return;
          }
          queue.push(j);
        } else {
          const until = soda.clock() + DA_REST_MS;
          fails.set(j.ym, { tries: j.tries, trouble: result.trouble, last: result.missing, restUntil: until });
          j.done({ ...result, missing: restingWhy(result.missing, until) });
          if (late) {
            for (const x of queue.splice(0)) x.done(outOfTime(x));
            return;
          }
        }
      } catch (err) {
        j.done({ ym: j.ym, missing: `failed: ${err instanceof Error ? err.message : String(err)}`, trouble: null });
      }
    }
  };
  for (let i = 0; i < Math.min(DA_CONCURRENT_MONTHS, queue.length); i++) void worker();
  return out;
}

/** Wait for every promise, or `ms` (real time), whichever comes first. Leaves no timer behind. */
async function waitFor(promises: Promise<unknown>[], ms: number): Promise<void> {
  if (!promises.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(promises), new Promise<void>((r) => (timer = setTimeout(r, ms)))]);
  clearTimeout(timer);
}

/** Today in New York, YYYY-MM-DD. */
function nycToday(now: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(now))
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let ym = start.slice(0, 7); ym <= end.slice(0, 7); ) {
    out.push(ym);
    ym = ym.endsWith("-12") ? `${Number(ym.slice(0, 4)) + 1}-01` : `${ym.slice(0, 5)}${String(Number(ym.slice(5, 7)) + 1).padStart(2, "0")}`;
  }
  return out;
}

/** Why an incomplete period lists saved months' counts: they are a partial sum only. */
export const SAVED_SO_FAR_NOTE =
  "saved_months gives each saved month's calls, and saved_months_so_far adds them up: a partial sum of the saved months so far, not the total for the period.";

/** One month's call count and its "Directory Assistance" topic count. */
function monthCounts(groups: CallGroup[]): { calls: number; directory_assistance_topic_calls: number } {
  let calls = 0;
  let da = 0;
  for (const g of groups) {
    calls += g.n;
    if (g.inquiry_name === "Directory Assistance") da += g.n;
  }
  return { calls, directory_assistance_topic_calls: da };
}

export function callSection(groups: CallGroup[], limit: number) {
  const byName = new Map<string, number>();
  const byAgency = new Map<string, { name: string | null; n: number }>();
  const byRes = new Map<string, number>();
  let total = 0;
  for (const g of groups) {
    total += g.n;
    byName.set(g.inquiry_name, (byName.get(g.inquiry_name) ?? 0) + g.n);
    const a = g.agency ?? "(blank)";
    const prev = byAgency.get(a);
    if (prev) prev.n += g.n;
    else byAgency.set(a, { name: g.agency_name, n: g.n });
    const r = g.call_resolution ?? "(blank)";
    byRes.set(r, (byRes.get(r) ?? 0) + g.n);
  }
  const cats = capped(
    [...byName].map(([category, calls]) => ({ category: redactZip(category), calls })).sort((a, b) => b.calls - a.calls || byText(a.category, b.category)),
    limit
  );
  const blankAgency = byAgency.get("(blank)")?.n ?? 0;
  const blankRes = byRes.get("(blank)") ?? 0;
  const da = byName.get("Directory Assistance") ?? 0;
  return {
    calls: total,
    by_category: cats.items,
    by_category_truncated: cats.truncated,
    category_count: cats.total_items,
    directory_assistance_topic_calls: da,
    by_agency:
      blankAgency === total
        ? null
        : [...byAgency].map(([agency, v]) => ({ agency, agency_name: v.name, calls: v.n })).sort((a, b) => b.calls - a.calls || byText(a.agency, b.agency)),
    calls_with_blank_agency: blankAgency,
    by_call_resolution:
      blankRes === total ? null : [...byRes].map(([call_resolution, calls]) => ({ call_resolution, calls })).sort((a, b) => b.calls - a.calls),
    calls_with_blank_call_resolution: blankRes,
  };
}

export async function directoryAssistanceReport(
  args: z.infer<z.ZodObject<typeof DA_SHAPE>>,
  soda: SodaClient = sodaClient(),
  now: number = Date.now(),
  opts: { budgetMs?: number; requestTimeoutMs?: number; answerWaitMs?: number; retryPauseMs?: number; backgroundMs?: number } = {}
) {
  // A fiscal-year call's answer wait counts from here, so the dataset metadata lookup is inside
  // it (beta retest 8, 2026-11-09: the first call on an empty cache took 16.0 s, the metadata
  // request adding about 4 s before the 12 s wait began).
  const callStart = Date.now();
  const today = nycToday(now);
  // The dataset is published daily, through yesterday at best.
  const window = { start: DATA_START, end: addDays(today, -1) };
  const periods = reportPeriods(args, window, lastCompleteMonth(window.end));
  const limit = args.limit ?? 50;
  const deadline = soda.clock() + (opts.budgetMs ?? DA_BUDGET_MS);
  const request: RequestOpts = { ...DA_REQUEST, ...(opts.requestTimeoutMs ? { timeoutMs: opts.requestTimeoutMs } : {}) };
  const waited = request.timeoutMs ?? DA_REQUEST.timeoutMs;
  const plain = (trouble: Trouble, ym: string | null) => (trouble === "slow" ? openDataSlow(ym, waited) : openDataDown(ym));
  let mr: Awaited<ReturnType<SodaClient["metadataOrCached"]>>;
  const answerWait = opts.answerWaitMs ?? DA_ANSWER_WAIT_MS;
  const waitUntil = callStart + answerWait;
  const metaP = soda.metadataOrCached(CALL_CENTER_DATASET, { deadline, ...request });
  try {
    if (periods.month) mr = await metaP;
    else {
      // A fiscal-year call waits for the metadata only within its answer wait. If it is not in
      // by then, the answer says every month not saved is still loading, and the load starts
      // in the background as soon as the metadata arrives.
      let got: typeof mr | undefined;
      metaP.then((m) => (got = m)).catch(() => undefined);
      await Promise.race([metaP, new Promise((r) => setTimeout(r, Math.max(0, waitUntil - Date.now())).unref?.())]);
      if (!got) {
        const disk = await soda.readCache<SodaMetadata>(`meta/${CALL_CENTER_DATASET}`);
        if (!disk) {
          // Nothing saved at all (an empty cache): start the load once the metadata arrives,
          // and answer now that it is loading.
          const fyMonths = monthsBetween(periods.fiscal_year.start, periods.fiscal_year.end);
          metaP
            .then(async (m) => {
              const todo: string[] = [];
              for (const ym of fyMonths) if (!(await savedMonth(soda, m, ym, today)).fresh) todo.push(ym);
              loadMonths(soda, m.meta, todo, request, soda.clock() + (opts.backgroundMs ?? DA_BACKGROUND_MS), opts.retryPauseMs ?? DA_RETRY_PAUSE_MS);
            })
            .catch(() => undefined);
          throw new Error(FY_METADATA_SLOW);
        }
        // A saved copy of the metadata answers for now; the fresh one is used by the next call.
        mr = { meta: disk.value, stale: false };
      } else mr = got;
    }
  } catch (err) {
    const trouble = sodaTrouble(err);
    if (trouble) throw new Error(plain(trouble, periods.month?.month ?? null));
    throw err;
  }
  const meta = mr.meta;
  const months = monthsBetween(periods.fiscal_year.start, periods.fiscal_year.end);
  // The asked-for month first; then the rest, oldest first.
  const order = periods.month ? [periods.month.month, ...months.filter((m) => m !== periods.month!.month)] : months;
  const give: { up: boolean; why?: string; trouble?: Trouble } = { up: false };
  const results = new Map<string, MonthResult>();
  if (!periods.month) {
    // A fiscal-year call: saved months at once; the rest fetched one at a time, waited on
    // for DA_ANSWER_WAIT_MS at most, and saved for the next call if still loading then.
    const todo: string[] = [];
    // A saved copy too old to use as is (a month in progress, past OPEN_MONTH_TTL_MS): asked
    // again, and used, labeled as an older copy, only if the new answer is not in by the wait.
    const older = new Map<string, MonthResult>();
    for (const ym of months) {
      const r = await savedMonth(soda, mr, ym, today);
      if (r.fresh) results.set(ym, r.fresh);
      else {
        todo.push(ym);
        if (r.older) older.set(ym, r.older);
      }
    }
    const pause = opts.retryPauseMs ?? DA_RETRY_PAUSE_MS;
    const wait = Math.max(0, waitUntil - Date.now());
    // Months an earlier call started and that are still loading: this call waits on them.
    const inherited = new Set(todo.filter((ym) => loading.get(soda)?.has(ym)));
    const started = loadMonths(soda, meta, todo, request, soda.clock() + (opts.backgroundMs ?? DA_BACKGROUND_MS), pause);
    const done = new Map<string, MonthResult>();
    for (const [ym, p] of started) p.then((r) => done.set(ym, r));
    await waitFor([...started.values()], wait);
    // A load an earlier call started failed (or was not tried after one did): retry those
    // months now, within this call's answer wait, rather than only reporting the failure
    // and restarting on the call after (beta retest 5, 2026-11-09). Once per call, and only
    // for earlier calls' loads, so a portal failing now is not asked twice in one call.
    // Still one month at a time (loadMonths; standards §6).
    const retry = todo.filter((ym) => inherited.has(ym) && "missing" in (done.get(ym) ?? { groups: [] }));
    if (retry.length && Date.now() < waitUntil) {
      const again = loadMonths(soda, meta, retry, request, soda.clock() + (opts.backgroundMs ?? DA_BACKGROUND_MS), pause);
      for (const ym of retry) done.delete(ym);
      for (const [ym, p] of again) p.then((r) => done.set(ym, r));
      await waitFor([...again.values()], Math.max(0, waitUntil - Date.now()));
    }
    for (const ym of todo) {
      const r = done.get(ym);
      if (r && "groups" in r) results.set(ym, r);
      else
        results.set(
          ym,
          older.get(ym) ?? r ?? { ym, missing: pendingWhy(soda, ym), trouble: null, loading: true }
        );
    }
  }
  for (const ym of periods.month ? order : []) {
    const r = await monthCalls(soda, mr, ym, today, deadline, give, request);
    results.set(ym, r);
    if (periods.month && ym === periods.month.month) {
      // The asked-for month failed: stop, rather than spend the rest of the budget on the
      // fiscal-year months against a portal that is failing (beta test 2026-11-08: 45 s of 503s).
      if ("missing" in r) throw new Error(r.trouble ? plain(r.trouble, ym) : `No answer for ${ym}: ${r.missing}. Try again later.`);
      // A one-month call fetches only its month; the year to date uses saved months only
      // (beta retest 3, 2026-11-09: October, saved, still waited 55 s on the other months).
      give.up = true;
      give.why = ONE_MONTH_ONLY;
      give.trouble = null;
    }
  }
  const missing = [...results.values()].filter((r): r is Extract<MonthResult, { missing: string }> => "missing" in r);
  // An incomplete period still shows what it has: each saved month's count, and their sum,
  // labeled as a partial sum, never as the period's total (beta retest 5, 2026-11-09).
  const savedSoFar = (ms: string[]) => {
    const have = ms.flatMap((ym) => {
      const r = results.get(ym);
      return r && "groups" in r ? [{ month: ym, ...monthCounts(r.groups) }] : [];
    });
    return {
      saved_months: have,
      saved_months_so_far: have.length
        ? {
            label: `Saved months so far (${have.length} of ${ms.length}): a partial sum, not the total for the period`,
            months: have.length,
            of_months: ms.length,
            calls: have.reduce((a, m) => a + m.calls, 0),
            directory_assistance_topic_calls: have.reduce((a, m) => a + m.directory_assistance_topic_calls, 0),
          }
        : null,
    };
  };
  const section = (p: Period) => {
    const ms = monthsBetween(p.start, p.end);
    const gone = missing.filter((x) => ms.includes(x.ym));
    if (gone.length) {
      const saved = savedSoFar(ms);
      return {
        ...periodOut(p),
        complete: false,
        months_missing: gone.map((x) => ({ month: x.ym, why: x.missing })),
        ...saved,
        note:
          (gone.every((x) => x.missing === ONE_MONTH_ONLY)
            ? "A one-month call fetches only its own month, so no total is given for the year to date. Ask with fiscal_year (and no month) to fetch the other months; they are saved for later calls."
            : gone.some((x) => x.loading)
              ? "Some months are still loading from NYC Open Data, so the full total is not ready yet. The others keep loading and are saved when done. Ask again in a minute."
              : "Not every month of this period could be fetched in this call, so the full total is not ready yet. The months fetched are saved; ask again to finish.") +
          (saved.saved_months.length ? ` ${SAVED_SO_FAR_NOTE}` : ""),
      };
    }
    const groups = ms.flatMap((ym) => (results.get(ym) as { groups: CallGroup[] }).groups);
    return { ...periodOut(p), complete: true, ...callSection(groups, limit) };
  };
  const list = periods.month ? [periods.month, periods.fiscal_year] : [periods.fiscal_year];
  const sections = list.map(section);
  const counts = { query: 0, cache: 0, old_cache: 0 };
  for (const r of results.values()) if ("from" in r) counts[r.from] += 1;
  const col = (f: string) => meta.columns.find((c) => c.fieldName === f);
  const allBlank = sections.every((s) => !("by_agency" in s) || s.by_agency === null);
  const limitedReasons = [
    "The dataset has no field that says which calls were entered \"in the directory assistance category\", the law's definition. It holds every agent-handled call, so this report counts all of them, by topic (inquiry_name), and shows the one topic named \"Directory Assistance\" separately.",
    ...(allBlank
      ? [
          `The agency column is blank for every call in this period (and in every month checked back to January 2022), so there is no breakdown by agency. The column exists: ${col("agency")?.non_null?.toLocaleString("en-US") ?? "some"} older calls have one.`,
        ]
      : []),
    ...(sections.every((s) => !("by_call_resolution" in s) || s.by_call_resolution === null)
      ? ["The call_resolution column (how the call ended: information provided, transferred, service request created, and so on) is blank for every call in this period, so calls that only got information cannot be told apart from calls that became service requests."]
      : []),
    "The dataset's own description says that since March 2020 it \"does not fully represent the agent-handled calls to 311. The actual calls handled are higher.\" It counts agent-handled calls only, not every call to 311.",
  ];
  const caveats = [
    ...periods.notes,
    "Calls are counted by the date they were received (New York time). The topic is the one the 311 representative used to answer the call.",
    `Months that ended more than ${SETTLED_AFTER_DAYS} days ago are answered from a saved copy for up to ${SETTLED_TTL_DAYS} days. The month in progress (and the month before it, for ${SETTLED_AFTER_DAYS} days after it ends) is asked again when the dataset changes or its saved copy is more than ${OPEN_MONTH_TTL_MS / 60_000} minutes old, because calls keep being added without the dataset's update time moving; recent_months says when each was fetched.`,
  ];
  if (mr.stale) caveats.push(`NYC Open Data could not be reached just now, so this answer comes from saved copies (dataset as of ${meta.rowsUpdatedAt_iso}). Newer data may exist.`);
  if (counts.old_cache && !mr.stale) caveats.push(`${counts.old_cache} month(s) could not be refreshed and come from an older saved copy.`);
  const env = {
    data_as_of: meta.rowsUpdatedAt_iso,
    latest_request: null,
    boardstat_url: null,
    caveats,
    ...(mr.stale ? { warning: mr.warning, stale: true as const } : {}),
    source: {
      name: "NYC Open Data, 311 Call Center Inquiry (wewp-mm3p), read by BetaNYC",
      url: `https://data.cityofnewyork.us/d/${CALL_CENTER_DATASET}`,
      dataset: { id: CALL_CENTER_DATASET, name: meta.name, url: `https://data.cityofnewyork.us/d/${CALL_CENTER_DATASET}`, updated: meta.rowsUpdatedAt_iso },
    },
    data: {
      limited: true,
      limited_because: limitedReasons,
      month: periods.month ? sections[0] : null,
      fiscal_year: sections[periods.month ? 1 : 0],
      months_queried: counts.query,
      months_from_cache: counts.cache + counts.old_cache,
      months_missing: missing.map((x) => x.ym),
      // When each month not yet settled was last fetched (beta retest 6, 2026-11-09).
      recent_months: [...results.values()]
        .filter((r): r is Extract<MonthResult, { groups: CallGroup[] }> => "groups" in r && !isSettled(r.ym, today))
        .map((r) => ({
          month: r.ym,
          fetched_at: r.fetched_at,
          from: r.from === "query" ? "fetched by this call" : r.from === "cache" ? "saved copy" : "older saved copy (a newer one could not be fetched in time)",
          asked_again_after_minutes: OPEN_MONTH_TTL_MS / 60_000,
        })),
    },
    mandate: MANDATES.directory_assistance,
  };
  assertNoZip(env);
  return scrubZipValues(env);
}

// ─── 3. cb_monthly_list (§ 1075(d), current law) ──────────────────────────────

const CB_PARTS = ["all", "new_this_month", "unresolved_from_prior_months", "unresolved_at_month_end_now_closed"] as const;

const CB_SHAPE = {
  community_district: z.union([z.number().int(), z.string()]),
  month: z.string().optional(),
  part: z.enum(CB_PARTS).optional(),
  limit: LIMIT(1000),
  offset: z.number().int().min(0).optional(),
  format: z.enum(["rows", "csv"]).optional(),
  /** The data_as_of of the first page, so later pages cannot silently come from a newer build. */
  data_as_of: z.string().optional(),
};

const CB_COLUMNS = ["section", "unique_key", "created", "closed", "category", "description", "agency", "agency_name", "status", "address"] as const;
type CbRow = Record<(typeof CB_COLUMNS)[number], string | null>;

const DETAIL_COLS = ["unique_key", "created_date", "closed_date", "complaint_type_raw", "descriptor", "agency", "agency_name", "status", "incident_address", "intersection_street_1", "intersection_street_2"];

export function toCsv(columns: readonly string[], rows: Record<string, string | null>[]): string {
  const cell = (v: string | null) => (v == null ? "" : /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

const sortCreated = (a: Row, b: Row) =>
  (a.created_date as Date).getTime() - (b.created_date as Date).getTime() || byText(String(a.unique_key), String(b.unique_key));

export async function cbMonthlyList(src: Source, args: z.infer<z.ZodObject<typeof CB_SHAPE>>) {
  const data = await pin(src);
  const mr = await data.manifest();
  const m = mr.manifest;
  if (args.data_as_of !== undefined && args.data_as_of !== m.generated_at) {
    throw new Error(
      `BoardStat published new data since the first page (that page was from ${args.data_as_of}; the data is now from ${m.generated_at}), ` +
        "so later pages would not line up with earlier ones. Start again at offset 0, without data_as_of."
    );
  }
  const d = resolveDistrict(m, { community_district: args.community_district });
  const window = { start: m.window.start, end: lastDataDay(m) };
  const newest = lastCompleteMonth(lastDataDay(m));
  const periods = reportPeriods({ month: args.month }, window, newest);
  const month = periods.month as Period & { month: string };
  const part = args.part ?? "all";
  const want = (p: (typeof CB_PARTS)[number]) => part === "all" || part === p;
  const limit = args.limit ?? 100;
  const offset = args.offset ?? 0;
  const monthStart = localAsDate(month.start);
  const afterMonth = localAsDate(addDays(month.end, 1));
  const before = { $gte: localAsDate(m.window.start), $lt: monthStart };
  const hasPrior = month.start > m.window.start;

  const read = async (filter: Record<string, unknown>, extra: string[] = []) =>
    (await data.readParquet(d.file, { columns: [...DETAIL_COLS, ...extra], filter })).rows.sort(sortCreated);
  const fresh = want("new_this_month") ? await read({ created_date: { $gte: monthStart, $lt: afterMonth } }) : [];
  const stillOpen = want("unresolved_from_prior_months") && hasPrior ? await read({ created_date: before, is_closed: { $eq: false } }, ["is_closed"]) : [];
  // Created before the month, closed after it ended: unresolved at the month's end, by their own
  // created and closed dates. This much of the past can be rebuilt; a past status cannot.
  const closedSince = want("unresolved_at_month_end_now_closed") && hasPrior
    ? await read({ created_date: before, is_closed: { $eq: true }, closed_date: { $gte: afterMonth } }, ["is_closed"])
    : [];

  // Two kinds of inconsistent City records the three parts cannot place (QA round 2 on #21).
  const closedNoDate =
    want("unresolved_at_month_end_now_closed") && hasPrior
      ? (await data.readParquet(d.file, { columns: ["created_date", "closed_date", "is_closed"], filter: { created_date: before, is_closed: { $eq: true } } })).rows.filter(
          (r) => !(r.closed_date instanceof Date)
        ).length
      : null;
  const openButClosedBefore = want("unresolved_from_prior_months")
    ? stillOpen.filter((r) => r.closed_date instanceof Date && (r.closed_date as Date).getTime() < afterMonth.getTime()).length
    : null;
  const recordCaveats: string[] = [];
  if (closedNoDate) {
    recordCaveats.push(
      `${closedNoDate.toLocaleString("en-US")} requests created before ${month.month} are marked Closed but have no close date, so it cannot be told whether they were unresolved at the month's end. They are not listed in any part.`
    );
  }
  if (openButClosedBefore) {
    recordCaveats.push(
      `City records are inconsistent for ${openButClosedBefore.toLocaleString("en-US")} requests: not Closed today, but carrying a close date before ${month.month} ended. They are listed as unresolved from prior months, by their current status.`
    );
  }

  const toRow = (section: string) => (r: Row): CbRow => ({
    section,
    unique_key: String(r.unique_key),
    created: fmtLocal(r.created_date),
    closed: fmtLocal(r.closed_date),
    category: r.complaint_type_raw == null ? null : redactZip(String(r.complaint_type_raw)),
    description: r.descriptor == null ? null : redactZip(String(r.descriptor)),
    agency: r.agency == null ? null : String(r.agency),
    agency_name: r.agency_name == null ? null : String(r.agency_name),
    status: r.status == null ? null : String(r.status),
    address: redactZip(addressOf(r)),
  });
  const all = [
    ...fresh.map(toRow("new_this_month")),
    ...stillOpen.map(toRow("unresolved_from_prior_months")),
    ...closedSince.map(toRow("unresolved_at_month_end_now_closed")),
  ];
  const page = all.slice(offset, offset + limit);
  const next = offset + limit < all.length ? offset + limit : null;
  const unresolvedLink = boardstatUrl(data.siteUrl, { geo: "cd", id: d.id, start: m.window.start, end: addDays(month.start, -1), status: "not_closed" });
  const older = month.month !== newest;
  const asOf =
    `"unresolved_from_prior_months" means not closed when this data was built (${m.generated_at}), not at the end of ${month.month}. ` +
    "Open data keeps only each request's current status, so a past status cannot be rebuilt. A § 1075(d) list sent at the month's end would show the status as of then.";

  const env = districtEnvelope({
    manifest: mr,
    siteUrl: data.siteUrl,
    link: { geo: "cd", id: d.id, start: month.start, end: month.end },
    data: {
      district: districtOut(d),
      month: periodOut(month),
      part,
      status_as_of: m.generated_at,
      ...(older ? { status_note: asOf } : {}),
      counts: {
        new_this_month: want("new_this_month") ? fresh.length : null,
        unresolved_from_prior_months: want("unresolved_from_prior_months") ? stillOpen.length : null,
        unresolved_at_month_end_now_closed: want("unresolved_at_month_end_now_closed") ? closedSince.length : null,
        rows: all.length,
      },
      record_problems: {
        closed_without_close_date: closedNoDate,
        not_closed_but_close_date_before_month_end: openButClosedBefore,
      },
      offset,
      limit,
      next_offset: next,
      next_page: next === null ? null : { offset: next, data_as_of: m.generated_at },
      unresolved_boardstat_url: want("unresolved_from_prior_months") ? unresolvedLink : null,
      columns: [...CB_COLUMNS],
      ...(args.format === "csv" ? { csv: toCsv(CB_COLUMNS, page) } : { rows: page }),
    },
    extraCaveats: [
      ...periods.notes,
      ...districtCaveats(d, m),
      "\"new_this_month\" is every request created in the month. \"unresolved_from_prior_months\" is every request created earlier (2020 on) that is still not closed. \"unresolved_at_month_end_now_closed\" is every request created earlier that was closed after the month ended, so it was unresolved at the month's end, by its own created and closed dates.",
      older ? asOf : `Status is the current status, as of when this data was built (${m.generated_at}), which is what § 1075(d)(3) asks for.`,
      "Unresolved means any status other than Closed (Open, In Progress, Pending, Assigned, Started, Unspecified, or none). Closed does not mean fixed.",
      "Category is the City's complaint type; description is the City's descriptor. unique_key is NYC Open Data's id for the request; it is not the 311 number (311-XXXXXXXX) the person who reported was given. Addresses are as the City wrote them.",
      "To page, pass next_page.offset and next_page.data_as_of. A page asked for with an older data_as_of is refused, so a list is never stitched from two builds.",
      ...recordCaveats,
      ...(d.jia ? ["A Joint Interest Area has no community board of its own; § 1075(d) lists go to community boards."] : []),
    ],
  });
  return withMandate(env, MANDATES.cb_list);
}

// ─── Registration ─────────────────────────────────────────────────────────────

const MONTH_JSON = {
  type: "string",
  description: "Month, YYYY-MM; the answer also covers the fiscal year to date through it. Default: the newest complete month. Not with fiscal_year.",
};
const FY_JSON = {
  type: ["integer", "string"],
  description: "NYC fiscal year: 2027 or 'FY2027' = 2026-07-01 to 2027-06-30, cut to the data if not over. Not with month.",
};
const limitJson = (def: number, max: number, what: string) => ({
  type: "integer",
  minimum: 1,
  maximum: max,
  description: `How many ${what} to list (default ${def}).`,
});

// Short sentence on every LL47 tool; the full text is LL47_REBUILD in the server instructions.
const REBUILD = "A BetaNYC rebuild from NYC Open Data, not the City's official report. No ZIP codes, nothing before 2020.";

export const LL47_TOOLS = [
  {
    name: "ll47_service_request_report",
    description:
      "Rebuilds the monthly 311 service request report of former Charter § 1075(b) (Local Law 47 of 2005; repealed by Local Law 69 of 2023): for a month and the fiscal year to date, totals by category (the City's complaint type) and by agency, totals by status, and the average (and median) days to close for each category and agency. Citywide, one borough, one community district or one council district; or by_district for a table of every district. From BoardStat's nightly files. Citywide and borough answers give totals by problem only, unless read_every_district is true. " +
      REBUILD,
    inputSchema: obj({
      month: MONTH_JSON,
      fiscal_year: FY_JSON,
      ...DISTRICT_JSON,
      borough: { type: "string", enum: BOROUGHS, description: "One borough. Give at most one of borough, community_district, council_district; none = citywide. With by_district, narrows the table." },
      by_district: {
        type: "string",
        enum: GEO_KINDS,
        description: "A table with one row per district or borough of this kind: requests in the month and fiscal year, and the top problem.",
      },
      read_every_district: {
        type: "boolean",
        description: "Citywide or borough only: read every community district file to add agencies, statuses and days to close. A large download (about 860 MB citywide in November 2026), cached until the next build.",
      },
      limit: limitJson(50, 1000, "categories and category-agency rows (with by_district: districts)"),
    }),
  },
  {
    name: "ll47_directory_assistance_report",
    description:
      "Rebuilds the monthly directory-assistance report of former Charter § 1075(c) (Local Law 47 of 2005; repealed by Local Law 69 of 2023), as far as the open data allows: calls to 311 agents for a month and the fiscal year to date, by topic, from NYC Open Data's 311 Call Center Inquiry dataset (wewp-mm3p). Marked limited: the dataset cannot tell directory-assistance calls from others, and its agency and call-resolution columns are blank in recent years, so there is no breakdown by agency. Queries NYC Open Data (one query per month, cached; the month in progress is asked again after an hour). A month call fetches only that month; its fiscal year to date uses saved months. A fiscal_year call answers within about 12 s: saved months at once, others listed as still loading while they keep loading (an incomplete period shows each saved month's count and a partial sum, labeled, never a total); asking again a minute later finishes it. " +
      REBUILD,
    inputSchema: obj({ month: MONTH_JSON, fiscal_year: FY_JSON, limit: limitJson(50, 2000, "topics") }),
  },
  {
    name: "cb_monthly_list",
    description:
      "The monthly list of Charter § 1075(d), current law, for one community district: every 311 request created in a month (default: the newest complete month), plus earlier requests still not closed and those unresolved at the month's end that have closed since; each with its number, date, category, description, agency, current status and address. Pages with limit and offset; format 'csv' returns the page as CSV text. From BoardStat's nightly files. " +
      REBUILD,
    inputSchema: obj(
      {
        community_district: { type: ["integer", "string"], description: "306, BK06 or 'Brooklyn 6' (all forms: server instructions)." },
        month: { type: "string", description: "Month, YYYY-MM. Default: the newest complete month (the law's 'immediately preceding month')." },
        part: {
          type: "string",
          enum: CB_PARTS,
          description: "all (default); the month's new requests; earlier requests still not closed; or earlier requests unresolved at the month's end and closed since.",
        },
        data_as_of: DATA_AS_OF_JSON,
        limit: limitJson(100, 1000, "rows"),
        offset: { type: "integer", minimum: 0, description: "Rows to skip, for the next page (next_offset)." },
        format: { type: "string", enum: ["rows", "csv"], description: "'rows' (default) or 'csv': the page as CSV text, columns as in 'columns'." },
      },
      ["community_district"]
    ),
  },
];

export const LL47_ARG_SHAPES = {
  ll47_service_request_report: SR_SHAPE,
  ll47_directory_assistance_report: DA_SHAPE,
  cb_monthly_list: CB_SHAPE,
};

export type Ll47ToolName = keyof typeof LL47_ARG_SHAPES;

export async function runLl47Tool(
  name: Ll47ToolName,
  args: Record<string, unknown>,
  deps: { data?: Source; soda?: SodaClient } = {}
): Promise<unknown> {
  switch (name) {
    case "ll47_service_request_report":
      return serviceRequestReport(deps.data ?? boardstatData(), args as never);
    case "ll47_directory_assistance_report":
      return directoryAssistanceReport(args as never, deps.soda ?? sodaClient());
    case "cb_monthly_list":
      return cbMonthlyList(deps.data ?? boardstatData(), args as never);
  }
}
