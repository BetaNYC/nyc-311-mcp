// Plain-language status and resolution for 311 service requests (Phase 3, #16; epic #12).
//
// Two sources use two different status vocabularies, and both are covered here:
//
//   - The 311 Public API (GetServiceRequest / GetServiceRequestList) returns `Status` as a
//     numeric code. The only documentation is the 200-response text of the
//     GetServiceRequestList operation on api-portal.nyc.gov (API nyc-311-public-api,
//     operation api-GetServiceRequestList-post, read 2026-11-07):
//       614110001: Open · 614110002: In Progress · 614110000: Cancel · 614110003: Closed
//     and the fields SRNumber, Agency, Problem, ProblemDetails, Status, DateTimeSubmitted,
//     Address. Live calls on 2026-11-07 also returned AdditionalDetails, ResolutionAction,
//     ResolutionActionUpdatedDate, and Address as { Borough, FullAddress } (FullAddress ends
//     in a ZIP code, which is removed). No response schema is published.
//   - NYC Open Data erm2-nwe9 (and so BoardStat) writes `status` as text. Its data
//     dictionary says only "Status of SR submitted". Values seen 2026-11-07: Closed, Open,
//     In Progress, Pending, Assigned, Started, Unspecified (BoardStat detail/cd/101, every
//     request since 2020; erm2-nwe9 since 2026-10-01 has the same set less Started).
//
// The City publishes no definition of any status beyond its label. The meanings below say
// what the label says, what BoardStat counts it as, and what the data shows, and nothing more.
//
// The API's request number (311-XXXXXXXX) is NOT the Open Data unique_key. Evidence
// (docs/service-request-numbers.md): 311-17323508 is unique_key 60061097 and 311-17323514 is
// unique_key 60071726 (same agency, problem, address, second and resolution text), and
// "311-" + a unique_key is not found by the API. Open Data has no column holding the 311 number.

import { assertNoZip, assertNoZipValues, redactZip } from "./envelope.js";

/** The 311 Public API's status codes, as documented on api-portal.nyc.gov (GetServiceRequestList). */
export const API_STATUS_CODES: Readonly<Record<string, string>> = {
  "614110000": "Cancel",
  "614110001": "Open",
  "614110002": "In Progress",
  "614110003": "Closed",
};

const NO_DEFINITION = "The City does not publish a definition of this status.";
const NOT_CLOSED = "BoardStat counts it as not yet closed.";

/** Plain-language meanings, keyed by the lower-case label. */
const MEANINGS: Record<string, { meaning: string; closed: boolean }> = {
  closed: {
    meaning:
      "The agency closed the request. Closed does not mean the problem was fixed: read the agency's resolution text for what it recorded.",
    closed: true,
  },
  open: {
    meaning: `311 sent the request to the agency, and the agency has not closed it. ${NOT_CLOSED}`,
    closed: false,
  },
  "in progress": {
    meaning: `The agency has the request and has not closed it. Some agencies keep requests In Progress while a longer process runs (for example a TLC hearing or a health inspection). ${NOT_CLOSED}`,
    closed: false,
  },
  pending: {
    meaning: `Not closed, and waiting on a further step. Mostly used by DOT, whose resolution text often says the status is on DOT's own website. ${NO_DEFINITION} ${NOT_CLOSED}`,
    closed: false,
  },
  assigned: {
    meaning: `The agency assigned the request to a unit for action (for example, the Department of Buildings to a division). ${NO_DEFINITION} ${NOT_CLOSED}`,
    closed: false,
  },
  started: {
    meaning: `The agency has started work or an investigation and has not closed the request. ${NO_DEFINITION} ${NOT_CLOSED}`,
    closed: false,
  },
  unspecified: {
    meaning: `The City's data gives no status for this request. Read the resolution text and close date instead. ${NO_DEFINITION} ${NOT_CLOSED}`,
    closed: false,
  },
  cancel: {
    meaning:
      "The request was cancelled (the 311 API's label is 'Cancel'). The API does not say who cancelled it or why. It was not closed by the agency.",
    closed: false,
  },
};
MEANINGS["cancelled"] = MEANINGS.cancel;
MEANINGS["canceled"] = MEANINGS.cancel;

export type StatusExplained = {
  status: string | null;
  meaning: string;
  /** True for Closed, false for every other known status, null when the status is unknown or missing. */
  closed: boolean | null;
};

/** The plain-language meaning of a status label from either source (case-insensitive). */
export function explainStatus(status: string | null | undefined): StatusExplained {
  if (status == null || String(status).trim() === "") {
    return { status: null, meaning: `No status was given. ${NOT_CLOSED}`, closed: null };
  }
  const s = String(status).trim();
  const hit = MEANINGS[s.toLowerCase()];
  if (hit) return { status: s, meaning: hit.meaning, closed: hit.closed };
  return { status: s, meaning: `'${s}' is not a status this server knows. ${NO_DEFINITION}`, closed: null };
}

/** Meanings for every status present in a list of rows, in the order first seen. */
export function statusMeanings(statuses: Iterable<string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of statuses) {
    const k = s == null ? "(none)" : s;
    if (!(k in out)) out[k] = explainStatus(s).meaning;
  }
  return out;
}

// ─── The 311 Public API's service request ───────────────────────────────────────

export const SR_NUMBER_NOTE =
  "The 311 number (311-XXXXXXXX) is not NYC Open Data's unique_key, and Open Data does not publish the 311 number, so a request looked up here cannot be matched to its Open Data or BoardStat row by number.";

export const NOT_FOUND_HINT =
  "If this number came from NYC Open Data or BoardStat (an 8-digit unique_key such as 60061097), it is not a 311 number: the two use different numbers. Use address_history or find_requests for Open Data requests.";

/** A copy with ZIP keys dropped and ZIP codes removed from every string. */
function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redactZip(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!/zip/i.test(k)) out[k] = sanitize(v);
    return out;
  }
  return value;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : v == null ? null : typeof v === "number" ? String(v) : null);

/** The street part of the API's FullAddress ("180 EAST   94 STREET, MANHATTAN (NEW YORK), NY, <ZIP>" → "180 EAST 94 STREET"). */
export function streetOf(fullAddress: string | null): string | null {
  if (!fullAddress) return null;
  const street = fullAddress.split(",")[0].replace(/\s+/g, " ").trim();
  return street ? redactZip(street) : null;
}

// The same five names as district-tools BOROUGHS, kept here so the two modules do not import each other.
const BOROUGHS = ["Manhattan", "Bronx", "Brooklyn", "Queens", "Staten Island"] as const;

function boroughOf(b: string | null): (typeof BOROUGHS)[number] | null {
  if (!b) return null;
  return BOROUGHS.find((x) => x.toLowerCase() === b.trim().toLowerCase()) ?? null;
}

export type Explained = {
  status: string | null;
  status_code: string | null;
  meaning: string;
  closed: boolean | null;
  resolution: string | null;
  resolution_updated: string | null;
  submitted: string | null;
  address_lookup: { address: string; borough: string } | null;
  next_step: string | null;
  about_the_number: string;
};

/** The additive `plain_language` block for one request from the 311 Public API. */
export function explainApiRequest(sr: Record<string, unknown>): Explained {
  const code = str(sr.Status);
  const label = code == null ? null : (API_STATUS_CODES[code] ?? (/^\d+$/.test(code) ? null : code));
  const ex = explainStatus(label);
  const address = (sr.Address ?? null) as Record<string, unknown> | null;
  const street = streetOf(str(address?.FullAddress));
  const borough = boroughOf(str(address?.Borough));
  const lookup = street && borough ? { address: street, borough } : null;
  return {
    status: label,
    status_code: code,
    meaning: label == null && code != null ? `Status code ${code} is not in the 311 API's documentation.` : ex.meaning,
    closed: label == null ? null : ex.closed,
    resolution: redactZip(str(sr.ResolutionAction)),
    resolution_updated: str(sr.ResolutionActionUpdatedDate),
    submitted: str(sr.DateTimeSubmitted),
    address_lookup: lookup,
    next_step: lookup
      ? `For every request at this address since 2020 and its district, call address_history with address '${lookup.address}' and borough '${lookup.borough}'. That looks up the address, not this request.`
      : null,
    about_the_number: SR_NUMBER_NOTE,
  };
}

function isRequest(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && !Array.isArray(v) && "SRNumber" in (v as object));
}

function finish<T>(out: T): T {
  assertNoZip(out);
  assertNoZipValues(out);
  return out;
}

/**
 * The GetServiceRequest answer: the API's fields as returned (ZIP codes removed), plus a
 * `plain_language` block. Additive only: no field the API returns is renamed or dropped,
 * except ZIP codes.
 */
export function describeServiceRequest(raw: unknown): unknown {
  const clean = sanitize(raw);
  if (!isRequest(clean)) return finish(clean);
  return finish({ ...clean, plain_language: explainApiRequest(clean) });
}

/**
 * The GetServiceRequestList answer ({ SRResponses: [...] }), each request with its
 * `plain_language` block, plus `not_found`: the numbers asked for that the API left out.
 * The API omits a number it cannot find rather than returning an error for it (live call,
 * 2026-11-07).
 */
export function describeServiceRequestList(raw: unknown, asked: string[]): unknown {
  const clean = sanitize(raw);
  if (!clean || typeof clean !== "object" || !Array.isArray((clean as Record<string, unknown>).SRResponses)) return finish(clean);
  const list = (clean as { SRResponses: unknown[] }).SRResponses.map((r) => (isRequest(r) ? { ...r, plain_language: explainApiRequest(r) } : r));
  const got = new Set(list.filter(isRequest).map((r) => String(r.SRNumber).toUpperCase()));
  const notFound = [...new Set(asked.map((a) => a.toUpperCase()))].filter((a) => !got.has(a));
  return finish({
    ...(clean as object),
    SRResponses: list,
    not_found: notFound,
    ...(notFound.length ? { not_found_note: `The 311 API returned nothing for ${notFound.join(", ")}. ${NOT_FOUND_HINT}` } : {}),
  });
}
