// Date periods for the district tools: a calendar range or a City fiscal year.
//
// New York City's fiscal year runs July 1 to June 30 and is named for the
// calendar year it ends in: FY2027 = 2026-07-01 through 2027-06-30.
//
// Every date here is a plain YYYY-MM-DD string, compared as text. That is safe
// because the format is fixed-width, and it avoids every time-zone trap: a
// BoardStat `year_month` and a 311 `created_date` are both New York local time.

import { z } from "zod";

/** BoardStat's data starts here (manifest `window.start`; requests 2010-2019 are not loaded). */
export const DATA_START = "2020-01-01";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Throws unless `s` is a real calendar date written YYYY-MM-DD. */
export function assertRealIsoDate(s: string, name = "date"): string {
  const m = ISO_DATE.exec(s);
  if (!m) throw new Error(`Invalid ${name} '${s}': expected YYYY-MM-DD.`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid ${name} '${s}': not a real calendar date.`);
  }
  return s;
}

/** The fiscal year a date falls in. 2026-07-01 → 2027; 2026-06-30 → 2026. */
export function fiscalYearOf(isoDate: string): number {
  assertRealIsoDate(isoDate);
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= 7 ? year + 1 : year;
}

/** First and last day of a fiscal year. 2027 → 2026-07-01 .. 2027-06-30. */
export function fiscalYearRange(fy: number): { start: string; end: string } {
  if (!Number.isInteger(fy) || fy < 1900 || fy > 2200) {
    throw new Error(`Invalid fiscal year '${fy}': expected a four-digit year such as 2027.`);
  }
  return { start: `${fy - 1}-07-01`, end: `${fy}-06-30` };
}

/**
 * Accepts 2027, "2027", "FY2027", "FY27", "fy 2027". Two-digit years are 20xx.
 * Anything else is rejected rather than guessed at.
 */
export function parseFiscalYear(input: number | string): number {
  if (typeof input === "number") {
    fiscalYearRange(input);
    return input;
  }
  const m = /^\s*(?:fy\s*)?(\d{2}|\d{4})\s*$/i.exec(input);
  if (!m) {
    throw new Error(
      `Invalid fiscal year '${input}': use a year such as 2027 or FY2027 (NYC fiscal year 2027 runs 2026-07-01 to 2027-06-30).`
    );
  }
  const fy = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
  fiscalYearRange(fy);
  return fy;
}

export type PeriodArgs = {
  from_date?: string;
  to_date?: string;
  fiscal_year?: number | string;
};

export type Period = {
  start: string;
  end: string;
  /** Set when the period was given as a fiscal year. */
  fiscal_year?: number;
  /** Human label, e.g. "FY2027 (2026-07-01 to 2027-06-30)". */
  label: string;
  /** Plain-language notes when the period was cut to the data window. */
  notes: string[];
};

/**
 * Resolve tool arguments to one inclusive date period inside the data window.
 *
 * - `fiscal_year` alone, or `from_date` and/or `to_date`; never both kinds.
 * - A missing `from_date` means the start of the data; a missing `to_date` the end.
 * - With nothing given, `fallback` is used, or an error is raised if there is none.
 * - A period reaching outside the data window is cut to it, with a note saying so.
 */
export function resolvePeriod(
  args: PeriodArgs,
  window: { start: string; end: string },
  fallback?: { start: string; end: string }
): Period {
  const hasRange = args.from_date !== undefined || args.to_date !== undefined;
  const hasFy = args.fiscal_year !== undefined;
  if (hasRange && hasFy) {
    throw new Error(
      "Give either fiscal_year or from_date/to_date, not both: they describe the period two different ways."
    );
  }

  let start: string;
  let end: string;
  let fiscal_year: number | undefined;
  if (hasFy) {
    fiscal_year = parseFiscalYear(args.fiscal_year as number | string);
    ({ start, end } = fiscalYearRange(fiscal_year));
  } else if (hasRange) {
    start = args.from_date !== undefined ? assertRealIsoDate(args.from_date, "from_date") : window.start;
    end = args.to_date !== undefined ? assertRealIsoDate(args.to_date, "to_date") : window.end;
  } else if (fallback) {
    ({ start, end } = fallback);
  } else {
    throw new Error("A period is required: give fiscal_year (e.g. 2027) or from_date and to_date (YYYY-MM-DD).");
  }

  if (end < window.start) {
    throw new Error(
      `The period ends ${end}, before the data begins (${window.start}). BoardStat holds requests from ${window.start} on.`
    );
  }
  if (start > window.end) {
    throw new Error(`The period starts ${start}, after the latest data (${window.end}).`);
  }

  // Checked after the window checks, so a start past the data reads as that,
  // not as a reversed range against the default end.
  if (start > end) {
    throw new Error(`Invalid period: the start (${start}) is after the end (${end}).`);
  }

  const notes: string[] = [];
  let toDate = false;
  if (start < window.start) {
    notes.push(`The data begins ${window.start}, so the period starts there rather than ${start}.`);
    start = window.start;
  }
  if (end > window.end) {
    notes.push(
      fiscal_year !== undefined
        ? `FY${fiscal_year} is not over: the data runs to ${window.end}, so this is fiscal year to date.`
        : `The data runs to ${window.end}, so the period ends there rather than ${end}.`
    );
    end = window.end;
    toDate = true;
  }
  // The label names the dates actually covered, after any cut (QA on #21): a fiscal year that
  // is not over reads "FY2027 to date (2026-07-01 to 2026-11-04)", never the whole year.
  const label =
    fiscal_year !== undefined ? `FY${fiscal_year}${toDate ? " to date" : ""} (${start} to ${end})` : `${start} to ${end}`;
  return { start, end, fiscal_year, label, notes };
}

/**
 * The calendar months (YYYY-MM) a period touches, and which of them it covers
 * only in part. BoardStat's month aggregate counts whole months, so a tool that
 * sums it must either use whole months or read the detail file for the partial ones.
 */
export function monthsInPeriod(period: { start: string; end: string }): {
  months: string[];
  partial: string[];
} {
  const months: string[] = [];
  let y = Number(period.start.slice(0, 4));
  let m = Number(period.start.slice(5, 7));
  const endYm = period.end.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    months.push(ym);
    if (ym >= endYm) break;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  const partial: string[] = [];
  if (!period.start.endsWith("-01")) partial.push(months[0]);
  if (period.end !== lastDayOfMonth(endYm) && !partial.includes(endYm)) partial.push(endYm);
  return { months, partial };
}

function lastDayOfMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

// ─── Shared tool parameters ───────────────────────────────────────────────────
// Every district tool that takes dates spreads these into its schema, so the
// three parameters mean the same thing everywhere.

export const PERIOD_ARG_SHAPE = {
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  fiscal_year: z.union([z.number().int(), z.string()]).optional(),
};

export const PERIOD_JSON_PROPERTIES = {
  from_date: {
    type: "string",
    description: "Start, YYYY-MM-DD, inclusive.",
  },
  to_date: {
    type: "string",
    description: "End, YYYY-MM-DD, inclusive.",
  },
  fiscal_year: {
    type: ["integer", "string"],
    description:
      "NYC fiscal year: 2027 or 'FY2027' = 2026-07-01 to 2027-06-30.",
  },
} as const;
