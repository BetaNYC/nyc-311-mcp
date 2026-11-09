// get_status in plain words (beta test, 2026-11-08: the answer was only {"inEffect":false}).
//
// What each status checks is the City's own operation description on the 311 Public API
// portal (https://api-portal.nyc.gov/api-details#api=nyc-311-public-api, operation list
// read 2026-11-08). The portal documents no response fields. The fields seen in live
// answers on 2026-11-08: every status returns `inEffect` (true or false); OEM also returns
// `eventName` (empty when nothing is in effect). Nothing else is assumed: the API's answer
// is kept as returned, and a plain_language block is added.

import type { StatusType } from "./nyc-311.js";

/** The City's description of each status operation, word for word (read 2026-11-08). */
export const STATUS_CHECKS: Record<StatusType, { label: string; city_description: string }> = {
  CodeBlue: { label: "Code Blue", city_description: "API to determine if Code Blue status is currently active" },
  FireHydrant: { label: "Fire Hydrant emergency", city_description: "API to determine if Fire Hydrant emergency is currently active" },
  OEM: { label: "an Emergency Management (OEM) event", city_description: "API to get OEM event currently active" },
  SnowOnSidewalk: { label: "Snow or Ice on Sidewalk emergency", city_description: "API to determine if Snow or Ice on Sidewalk emergency is currently active" },
  SnowOnStreet: { label: "Snow or Ice on Street emergency", city_description: "API to determine if Snow or Ice on Street emergency is currently active" },
};

export const STATUS_DOCS_READ = "2026-11-08";
const PORTAL = "https://api-portal.nyc.gov/api-details#api=nyc-311-public-api";
const NOT_ASP =
  "This is not alternate side parking. For alternate side parking, garbage and recycling collection, and schools on a given day, use get_calendar.";

/** The API's answer as returned, plus a plain_language block. */
export function describeStatus(type: StatusType, raw: unknown, now: Date = new Date()): unknown {
  const check = STATUS_CHECKS[type];
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const inEffect = typeof obj?.inEffect === "boolean" ? obj.inEffect : null;
  const event = typeof obj?.eventName === "string" && obj.eventName.trim() ? obj.eventName.trim() : null;
  const checked_at = now.toISOString();
  let answer: string;
  if (inEffect === true) answer = `Yes: the City's 311 API says ${check.label} is in effect now${event ? ` (${event})` : ""}.`;
  else if (inEffect === false) answer = `No: the City's 311 API says ${check.label} is not in effect right now. That is as of when it was asked; it can change later today, so ask again for a later answer.`;
  else answer = `The City's 311 API did not say whether ${check.label} is in effect (its answer had no inEffect true or false). Its answer is shown as returned.`;
  return {
    ...(obj ?? { answer_as_returned: raw }),
    plain_language: {
      answer,
      in_effect: inEffect,
      ...(type === "OEM" ? { event_name: event } : {}),
      what_it_checks: `${check.city_description}. (The City's description of this operation on the 311 API portal, read ${STATUS_DOCS_READ}.)`,
      checked_at,
      not_alternate_side_parking: NOT_ASP,
    },
    source: { name: `NYC 311 Public API, Status/${type}`, url: PORTAL },
  };
}
