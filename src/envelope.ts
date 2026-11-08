// The response shape every district tool shares (epic #12, Phase 0 #13).
// Documented in docs/district-tools.md; change both together.

import type { BoardStatManifest, ManifestResult } from "./boardstat-data.js";

/**
 * Said on every district answer. Plain language, because these are read aloud
 * in Council offices and community board meetings.
 */
export const CAVEATS: readonly string[] = [
  "311 counts are reports, not problems: they reflect who reports and how, not only how many problems exist.",
  "\"Closed\" means the agency closed the request. It does not mean the problem was fixed.",
  "BoardStat's data starts 2020-01-01. Requests from before then are not included.",
  "Problem names are grouped by BoardStat, and those groupings have not yet been reviewed.",
];

export type BoardStatLinkFilters = {
  geo?: "cd" | "cc";
  id?: string | number;
  start?: string;
  end?: string;
  types?: string[];
  /** Descriptions (BoardStat's `desc`), and whether they are excluded rather than kept (`descx=1`). */
  descs?: string[];
  descExclude?: boolean;
  agency?: string;
  /** "Closed", "not_closed" (BoardStat's "Not yet closed"), or another status BoardStat lists. */
  status?: string;
};

/**
 * A BoardStat page link with the same filters as the answer, so a person can
 * check it. Parameter names are the ones BoardStat's district page reads
 * (BoardStat v2/site/js/district.js, readState/writeUrl): geo, id, start, end,
 * type and desc (each joined with "|"), descx=1 (exclude the descriptions), agency,
 * status. Without a district it links the home page.
 *
 * Addresses are deliberately not accepted: BoardStat keeps street addresses out of
 * district-page URLs (district.js, writeUrl) and this link does the same.
 */
export function boardstatUrl(siteUrl: string, f: BoardStatLinkFilters = {}): string {
  if (!f.geo || f.id === undefined) return new URL("./", siteUrl).toString();
  const p = new URLSearchParams({ geo: f.geo, id: String(f.id) });
  if (f.start) p.set("start", f.start);
  if (f.end) p.set("end", f.end);
  if (f.types?.length) p.set("type", f.types.join("|"));
  if (f.descs?.length) p.set("desc", f.descs.join("|"));
  if (f.descs?.length && f.descExclude) p.set("descx", "1");
  if (f.agency) p.set("agency", f.agency);
  if (f.status) p.set("status", f.status);
  return `${new URL("district.html", siteUrl).toString()}?${p.toString()}`;
}

export type DistrictEnvelope<T> = {
  /** When BoardStat built the data this answer comes from (manifest `generated_at`). */
  data_as_of: string;
  /** The newest request in the data (manifest `window.last_created`), if published. */
  latest_request: string | null;
  boardstat_url: string;
  caveats: string[];
  source: {
    name: string;
    url: string;
    dataset: { id?: string; name?: string; url?: string; updated?: string } | null;
  };
  /** Set when beta.nyc could not be reached and an older cached build answered. */
  warning?: string;
  /** True only in that case (the cached build answered while beta.nyc was unreachable). */
  stale?: true;
  data: T;
};

const ZIP_KEY = /zip/i;

// Five-digit numbers that look like ZIP codes, inside text: five digits (optionally +4)
// standing alone that follow a state ("NY 10010"), a borough or "New York"
// ("Brooklyn 11201"), or the word ZIP ("zip code 10010", "Zip: 11222") — or that are
// anything other than a house number. A house number starts an address: it is followed
// by the street in the City's capitals ("10001 4 AVENUE"), so it is kept.
// Found in City data: agency boilerplate "…, New York, NY 10010." in resolution text,
// and junk addresses such as "730 11363".
const ZIP_IN_TEXT = /(?<![\d-])(\d{5})(?:-\d{4})?(?![\d-])/g;
const ZIP_CONTEXT_BEFORE = new RegExp(
  [
    "\\b(?:N\\.?\\s?Y\\.?|NEW YORK|N\\.?\\s?J\\.?|NEW JERSEY|C\\.?\\s?T\\.?)\\s*,?\\s*$", // a state
    "\\b(?:MANHATTAN|BROOKLYN|BRONX|QUEENS|STATEN ISLAND)\\s*,?\\s*$", // a borough
    "\\bZIP(?:\\s*CODE)?\\s*[:#]?\\s*$", // the word ZIP
  ].join("|"),
  "i"
);
// The next word in capitals, as the City writes a street: "4 AVENUE", "WEST 42 STREET".
const STREET_AFTER = /^\s+[A-Z0-9][A-Z0-9'&.-]*(?=\s|$)/;

function zipSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(ZIP_IN_TEXT)) {
    const start = m.index as number;
    const end = start + m[0].length;
    const afterContext = ZIP_CONTEXT_BEFORE.test(text.slice(Math.max(0, start - 24), start));
    const houseNumber = !afterContext && STREET_AFTER.test(text.slice(end));
    if (!houseNumber) spans.push([start, end]);
  }
  return spans;
}

/** Text with five-digit numbers that look like ZIP codes replaced by "[ZIP code removed]". Used on every free-text field a tool returns. */
export function redactZip(text: string): string;
export function redactZip(text: string | null): string | null;
export function redactZip(text: string | null): string | null {
  if (text == null) return text;
  const spans = zipSpans(text);
  if (!spans.length) return text;
  let out = "";
  let at = 0;
  for (const [a, b] of spans) {
    out += text.slice(at, a) + "[ZIP code removed]";
    at = b;
  }
  return out + text.slice(at);
}

/** Throws if any string anywhere in `value` still holds a ZIP code. The value-level twin of assertNoZip. */
export function assertNoZipValues(value: unknown, where = "response"): void {
  if (typeof value === "string") {
    if (zipSpans(value).length) throw new Error(`A ZIP code was about to be returned in text (at ${where}). ZIP codes are not part of any answer.`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoZipValues(v, `${where}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) assertNoZipValues(v, `${where}.${k}`);
  }
}

/** Throws if any key anywhere in `value` names a ZIP code. No ZIP codes, by decision (#12). */
export function assertNoZip(value: unknown, where = "response"): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoZip(v, `${where}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (ZIP_KEY.test(k)) throw new Error(`ZIP codes are not part of any answer (found '${k}' at ${where}).`);
      assertNoZip(v, `${where}.${k}`);
    }
  }
}

export function districtEnvelope<T>(args: {
  manifest: ManifestResult | BoardStatManifest;
  siteUrl: string;
  link?: BoardStatLinkFilters;
  data: T;
  /** Tool-specific caveats (e.g. period notes from resolvePeriod), added after the standard ones. */
  extraCaveats?: string[];
}): DistrictEnvelope<T> {
  const mr: ManifestResult =
    "manifest" in args.manifest ? (args.manifest as ManifestResult) : { manifest: args.manifest, stale: false };
  const m = mr.manifest;
  const sr = m.sources?.service_requests;
  const env: DistrictEnvelope<T> = {
    data_as_of: m.generated_at,
    latest_request: m.window.last_created ?? null,
    boardstat_url: boardstatUrl(args.siteUrl, args.link),
    caveats: [...CAVEATS, ...(args.extraCaveats ?? [])],
    source: {
      name: "BoardStat, by BetaNYC, built nightly from NYC Open Data",
      url: new URL("./", args.siteUrl).toString(),
      dataset: sr ? { id: sr.id, name: sr.name, url: sr.url, updated: sr.rowsUpdatedAt_iso } : null,
    },
    data: args.data,
  };
  if (mr.stale) {
    // Said twice on purpose: `warning` for clients that look for it, and a caveat for
    // the many that read only the caveats aloud.
    env.warning = mr.warning ?? `BoardStat could not be reached; this answer comes from the cached build of ${m.generated_at}.`;
    env.stale = true;
    env.caveats.push(`BoardStat could not be reached just now, so this answer comes from a saved copy of the data built ${m.generated_at}. Newer data may exist.`);
  }
  assertNoZip(env);
  assertNoZipValues(env);
  return env;
}
