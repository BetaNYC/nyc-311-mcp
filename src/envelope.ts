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
  agency?: string;
  status?: string;
};

/**
 * A BoardStat page link with the same filters as the answer, so a person can
 * check it. Parameter names are the ones BoardStat's district page reads
 * (BoardStat v2/site/js/district.js, readState/writeUrl): geo, id, start, end,
 * type (joined with "|"), agency, status. Without a district it links the home page.
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
  data: T;
};

const ZIP_KEY = /zip/i;

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
  if (mr.stale && mr.warning) env.warning = mr.warning;
  assertNoZip(env);
  return env;
}
