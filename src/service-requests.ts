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
// The City publishes no definition of any status beyond its label. The meanings below are
// BetaNYC's reading (meaning_source), from the label, BoardStat's rule and the data, nothing more.
//
// The API's request number (311-XXXXXXXX) is NOT the Open Data unique_key. Evidence
// (docs/service-requests.md): 311-17323508 is unique_key 60061097 and 311-17323514 is
// unique_key 60071726 (same agency, problem, address, second and resolution text), and
// "311-" + a unique_key is not found by the API. Open Data has no column holding the 311 number,
// and we found no published source linking the two (checked: the erm2-nwe9 data dictionary and
// the API portal's operation docs).

import { assertNoZip, redactZip, scrubZipValues } from "./envelope.js";

/** The 311 Public API's status codes, as documented on api-portal.nyc.gov (GetServiceRequestList). */
export const API_STATUS_CODES: Readonly<Record<string, string>> = {
  "614110000": "Cancel",
  "614110001": "Open",
  "614110002": "In Progress",
  "614110003": "Closed",
};

const NO_DEFINITION = "The City does not publish a definition of this status.";
const NOT_CLOSED = "BoardStat counts it as not yet closed.";
/** Who wrote each meaning: BetaNYC, from the label and the data, not the City. */
export const MEANING_SOURCE = "BetaNYC";
/** Where the "used mostly by" evidence comes from. */
const SEEN = "in the BoardStat districts checked (Manhattan CD 1 and Council District 11, 2020 on, build of 2026-11-07)";

/**
 * BetaNYC's plain-language reading of each label, keyed by the lower-case label. Every one says
 * the City publishes no definition, and states only the label, which agencies use it in the data
 * checked, and how BoardStat counts it. Wording reviewed in #22 QA.
 */
const MEANINGS: Record<string, { meaning: string; closed: boolean }> = {
  closed: {
    meaning: `${NO_DEFINITION} The request is marked Closed. Closed does not mean the problem was fixed: read the agency's resolution text for what it recorded.`,
    closed: true,
  },
  open: {
    meaning: `${NO_DEFINITION} The request is marked Open, not Closed. Used mostly by HPD, then DOB and DEP, ${SEEN}. ${NOT_CLOSED}`,
    closed: false,
  },
  "in progress": {
    meaning: `${NO_DEFINITION} The request is marked In Progress, not Closed. Used mostly by Parks, DOHMH, TLC and EDC, ${SEEN}. ${NOT_CLOSED}`,
    closed: false,
  },
  pending: {
    meaning: `${NO_DEFINITION} The request is marked Pending, not Closed. Used almost only by DOT ${SEEN}, whose resolution text often says the status is on DOT's own website. Most of these also have a close date. ${NOT_CLOSED}`,
    closed: false,
  },
  assigned: {
    meaning: `${NO_DEFINITION} The request is marked Assigned, not Closed. Used mostly by DOT, then DOB and DEP, ${SEEN}. ${NOT_CLOSED}`,
    closed: false,
  },
  started: {
    meaning: `${NO_DEFINITION} The request is marked Started, not Closed. Used only by DEP ${SEEN}; the label suggests work has begun. ${NOT_CLOSED}`,
    closed: false,
  },
  unspecified: {
    meaning: `${NO_DEFINITION} The City's data says Unspecified. Most of these have a close date anyway; read the close date and resolution text. ${NOT_CLOSED}`,
    closed: false,
  },
  cancel: {
    meaning: `${NO_DEFINITION} The 311 API labels this code 'Cancel'. The API does not say who cancelled the request or why. It is not marked Closed.`,
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
  /** Who wrote `meaning`: always "BetaNYC". The City publishes no definitions. */
  meaning_source: typeof MEANING_SOURCE;
};

/** The plain-language meaning of a status label from either source (case-insensitive). */
export function explainStatus(status: string | null | undefined): StatusExplained {
  if (status == null || String(status).trim() === "") {
    return { status: null, meaning: `No status was given. ${NOT_CLOSED}`, closed: null, meaning_source: MEANING_SOURCE };
  }
  const s = String(status).trim();
  const hit = MEANINGS[s.toLowerCase()];
  if (hit) return { status: s, meaning: hit.meaning, closed: hit.closed, meaning_source: MEANING_SOURCE };
  return { status: s, meaning: `'${s}' is not a status this server knows. ${NO_DEFINITION}`, closed: null, meaning_source: MEANING_SOURCE };
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
  "The 311 number (311-XXXXXXXX) is not NYC Open Data's unique_key (two matched requests, 2026-11-07), Open Data does not publish the 311 number, and we found no published source that links them. So a request looked up here is not matched to its Open Data or BoardStat row by number; use address_history for its address.";

export const NOT_FOUND_HINT =
  "If this number came from NYC Open Data or BoardStat (an 8-digit unique_key such as 60061097), it is not a 311 number: the two use different numbers. Use address_history or find_requests for Open Data requests.";

/**
 * A 311 number the API does not know, in one plain sentence plus the hint, without the
 * City's raw error body (beta retest 1, 2026-11-08). A request or trace id the API sent
 * is kept, for anyone asking the City about the error.
 */
/** The same plain sentence for a list lookup in which the City found none of the numbers. */
export function listNotFoundMessage(srNumbers: string[], apiMessage: string): string {
  if (srNumbers.length === 1) return notFoundMessage(srNumbers[0], apiMessage);
  const id = apiMessage.match(/\b(?:request|activity|trace|correlation)[ _-]?id\b["']?\s*[:=]\s*["']?([A-Za-z0-9-]{6,})/i)?.[1];
  return `311 has none of these service requests: ${srNumbers.join(", ")}. ${NOT_FOUND_HINT}${id ? ` (311 API request id ${id}.)` : ""}`;
}

export function notFoundMessage(srNumber: string, apiMessage: string): string {
  const id = apiMessage.match(/\b(?:request|activity|trace|correlation)[ _-]?id\b["']?\s*[:=]\s*["']?([A-Za-z0-9-]{6,})/i)?.[1];
  return `311 has no service request ${srNumber}. ${NOT_FOUND_HINT}${id ? ` (311 API request id ${id}.)` : ""}`;
}

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
  meaning_source: typeof MEANING_SOURCE;
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
    meaning_source: MEANING_SOURCE,
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
  return scrubZipValues(out);
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
