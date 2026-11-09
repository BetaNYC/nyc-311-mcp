// draft_311_report (#18, second half of #10): a ready-to-paste 311 report the person
// files themselves. The server never files, starts or submits a 311 request, never calls
// the Developer Partner product, and never opens or fills a portal form (decided by
// BetaNYC (Noel Hidalgo), 2026-11-07; epic #12, "Reporting stops at guide and draft").
//
// The City publishes the fields each 311 form asks for nowhere: not in the API, not in
// any dataset, not on the article pages (the Report button runs JavaScript). So the
// draft carries the facts every report needs (what, where, when, details) and says
// plainly that the form may ask for more.
//
// Which article, agency, problem type and emergency answer: how_to_report's own
// matching (howToReport, called, not copied), so its fixes reach this tool too.
// What the article says about contact details, photos and what you need: the article's
// own text (read from the content client's cache; the same article how_to_report read).
// Problem Detail options and response times: the 311 Service Level Agreements dataset
// on NYC Open Data, cs9t-e3x8, which was last updated 2024-03-05 and is labeled old.
//
// ZIP codes: none in any answer. A ZIP the person typed is left out of the draft.

import { z } from "zod";
import { assertNoZip, redactZip, scrubZipValues } from "./envelope.js";
import { contentClient, PORTAL, type Article, type ContentClient } from "./content-311.js";
import { BOROUGHS, boardstatData } from "./district-tools.js";
import { howToReport, REACH_311, splitProblems, stem, words } from "./how-to-report.js";
import { ASSISTANT_INSTRUCTION, assessDanger, BUILT_IN_911, BUILT_IN_911_READ, emergencyLead, GENERIC_911, SAFETY_LINE, SAFETY_LINE_SOURCE } from "./emergency.js";
import { sodaClient, type SodaClient } from "./soda.js";
import type { BoardStatData } from "./boardstat-data.js";

// ─── the Service Level Agreements dataset (cs9t-e3x8) ────────────────────────

export const SLA_DATASET = "cs9t-e3x8";
export const SLA_URL = `https://data.cityofnewyork.us/d/${SLA_DATASET}`;
/** The dataset changes about once a year (it says "Annually"; it last changed 2024-03-05). */
export const SLA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SLA_KEY = `sla/${SLA_DATASET}`;
const SLA_DEADLINE_MS = 20_000;

/** Columns, from the dataset's own metadata (/api/views/cs9t-e3x8.json, read 2026-11-07). */
export type SlaRow = { agency: string; problem: string; problem_details?: string; additional_details?: string; sla_days: string };
type SlaCache = { rows: SlaRow[]; rows_updated: string };
export type SlaTable = SlaCache & { fetched_at: string; stale?: true; warning?: string };

/**
 * Every row of cs9t-e3x8 (about 3,600), read once and kept 30 days. After 30 days the
 * metadata is checked first, and the rows are read again only if the dataset changed.
 * Two requests a month at most. Null when NYC Open Data cannot be reached and nothing
 * is saved: the draft is still made, without Problem Detail options.
 */
export async function slaTable(soda: SodaClient): Promise<SlaTable | null> {
  const saved = await soda.readCache<SlaCache>(SLA_KEY);
  const now = soda.clock();
  if (saved && now - saved.fetched_at_ms < SLA_TTL_MS) return { ...saved.value, fetched_at: new Date(saved.fetched_at_ms).toISOString() };
  const deadline = now + SLA_DEADLINE_MS;
  try {
    const meta = await soda.metadata(SLA_DATASET, { deadline });
    let value: SlaCache;
    if (saved && saved.version === meta.rowsUpdatedAt) {
      value = saved.value;
    } else {
      const raw = await soda.queryAll(
        SLA_DATASET,
        { $select: "agency,problem,problem_details,additional_details,sla_days", $order: "problem,problem_details,additional_details,agency,sla_days" },
        { pageSize: 5000, deadline }
      );
      value = { rows: raw.map(toSlaRow).filter((r): r is SlaRow => r !== null), rows_updated: meta.rowsUpdatedAt_iso.slice(0, 10) };
    }
    await soda.writeCache(SLA_KEY, meta.rowsUpdatedAt, value);
    return { ...value, fetched_at: new Date(soda.clock()).toISOString() };
  } catch (err) {
    if (!saved) return null;
    return {
      ...saved.value,
      fetched_at: new Date(saved.fetched_at_ms).toISOString(),
      stale: true,
      warning: `NYC Open Data could not be reached (${err instanceof Error ? err.message : String(err)}). The Problem Detail options come from the copy saved ${new Date(saved.fetched_at_ms).toISOString()}.`,
    };
  }
}

const text = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "N/A" ? v.trim() : undefined);

function toSlaRow(r: Record<string, unknown>): SlaRow | null {
  const agency = text(r.agency);
  const problem = text(r.problem);
  const sla = text(r.sla_days);
  if (!agency || !problem || !sla) return null;
  return { agency, problem, problem_details: text(r.problem_details), additional_details: text(r.additional_details), sla_days: sla };
}

export type DetailOption = { problem_detail: string; additional_details: string[]; response_time: string[] };

/**
 * The Problem Detail options the dataset lists for one problem type (case aside; the
 * dataset has "HEAT/HOT WATER" and "Heat/Hot Water" both), for one agency when the
 * article named one and the dataset has rows for it.
 */
export function detailOptions(rows: SlaRow[], problem: string, agency: string | null): DetailOption[] {
  let hit = rows.filter((r) => r.problem.toLowerCase() === problem.toLowerCase());
  if (agency && hit.some((r) => r.agency === agency)) hit = hit.filter((r) => r.agency === agency);
  const by = new Map<string, { add: Set<string>; sla: Set<string> }>();
  for (const r of hit) {
    if (!r.problem_details) continue;
    const g = by.get(r.problem_details) ?? { add: new Set(), sla: new Set() };
    if (r.additional_details) g.add.add(r.additional_details);
    g.sla.add(r.sla_days);
    by.set(r.problem_details, g);
  }
  return [...by.entries()].map(([d, g]) => ({ problem_detail: d, additional_details: [...g.add].slice(0, 12), response_time: [...g.sla] }));
}

const MAX_OPTIONS = 15;

/** One option as a line: "Defacement: Advertisement, Graffiti (60 days)". */
export function optionText(o: DetailOption): string {
  return `${o.problem_detail}${o.additional_details.length ? `: ${o.additional_details.join(", ")}` : ""} (${o.response_time.join(" or ")})`;
}

// Words that say where, not what ("my block" is not "Blocked - Construction").
const PLACE_WORDS = new Set(["block", "corner", "near", "front", "side", "area", "place", "thing", "across", "next", "outside", "inside"]);

/** The option whose words overlap the person's words most, when one clearly does. */
export function likelyDetail(options: DetailOption[], said: string): string | null {
  const mine = new Set(words(said).map(stem).filter((w) => !PLACE_WORDS.has(w)));
  const score = (o: DetailOption) => new Set([o.problem_detail, ...o.additional_details].flatMap((x) => words(x)).map(stem).filter((w) => w.length > 2 && mine.has(w))).size;
  const scored = options.map((o) => ({ o, s: score(o) })).sort((a, b) => b.s - a.s);
  if (!scored.length || scored[0].s === 0 || (scored[1] && scored[1].s === scored[0].s)) return null;
  return scored[0].o.problem_detail;
}

// ─── what the article says (City text) ───────────────────────────────────────

const lines = (a: Article): string[] => a.sections.flatMap((s) => s.text.split("\n").map((l) => l.trim()).filter(Boolean));
const sentencesOf = (a: Article) => lines(a).flatMap((l) => l.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? []).map((s) => s.replace(/^•\s*/, "").trim());
const uniq = (xs: string[]) => [...new Set(xs)];

/** Lines under each "What You Need" heading, until the next heading. */
export function whatYouNeed(a: Article): string[] {
  const out: string[] = [];
  for (const s of a.sections) {
    const all = s.text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i < all.length; i++) {
      if (!/^What You Need$/i.test(all[i])) continue;
      for (let j = i + 1; j < all.length && j <= i + 8; j++) {
        const l = all[j];
        const bullet = l.startsWith("•");
        if (!bullet && !/[.:!?]$/.test(l)) break; // a heading
        out.push(l.replace(/^•\s*/, "").trim());
      }
    }
  }
  return uniq(out);
}

const CONTACT = /\b(contact information|anonymous(ly)?|your name|phone number|email address)\b/i;
const ANONYMOUS = /\banonymous(ly)?\b/i;
const PHOTO = /\b(photo|photos|photograph|picture|pictures|video|videos|image|images)\b/i;

export function contactText(a: Article): string[] {
  return uniq(sentencesOf(a).filter((s) => CONTACT.test(s))).slice(0, 4);
}
export function photoText(a: Article): string[] {
  return uniq(sentencesOf(a).filter((s) => PHOTO.test(s) && /\b(attach|upload|submit|send|include|add)/i.test(s))).slice(0, 3);
}

// ─── the person's words ──────────────────────────────────────────────────────

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g;
const LEFT_OUT = "[contact details left out]";

/** The person's text, with any email address or phone number left out, and no ZIP code. */
export function cleanText(s: string): { text: string; contact_removed: boolean; zip_removed: boolean } {
  let contact_removed = false;
  let t = s.replace(EMAIL, () => ((contact_removed = true), LEFT_OUT)).replace(PHONE, () => ((contact_removed = true), LEFT_OUT));
  const z = redactZip(t).replace(/\b(?:zip|zip code|postal code|zipcode)\s*[:#]?\s*(\[ZIP code removed\])/gi, "$1");
  const zip_removed = z !== t;
  t = z.replace(/\s*,?\s*\[ZIP code removed\]/g, "").replace(/\s+/g, " ").trim().replace(/^[,;]\s*/, "").replace(/[,;]$/, "");
  return { text: t, contact_removed, zip_removed };
}

// Words that start a place name, not a person's ("Bedford Ave", "Grand Concourse").
const PLACE_NAME = /^(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Pl|Place|Park|Pkwy|Parkway|Sq|Square|Ln|Lane|Dr|Drive|Ct|Court|Broadway|Concourse|Bridge|Island|Staten|New|York|NY|NYC|Brooklyn|Queens|Manhattan|Bronx|Harlem|East|West|North|South|Upper|Lower|City|Hall|Station|Center|Centre|Building|Houses|Apt|Apartment|Unit|Floor|I|I'm|DOT|DSNY|NYPD|HPD|DEP|DOB|MTA|NYCHA|ConEd|Con|Edison|The|My)$/;
const ROLE_THEN_NAME = /\b(?:neighbou?r|landlord|super|superintendent|roommate|tenant|owner|manager|husband|wife|boyfriend|girlfriend|partner|ex|son|daughter|brother|sister|mother|father|mom|dad|named|called|name is)\s+(?:is\s+)?[A-Z][a-z]+/;

// Words that end a place name: streets, neighborhoods, parks and buildings ("Gun Hill Road",
// "Crown Heights", "Bay Ridge", "Morris Park"). Beta test 2026-11-08: "Gun Hill" was read
// as a person's name. Matched on any word of a capitalized pair, or on the word after it.
const PLACE_END = /^(Hill|Hills|Heights|Ridge|Village|Point|Beach|Bay|Harbor|Harbour|Gardens?|Slope|Hook|Neck|Terrace|Junction|Woods?|Meadows?|Flats?|Falls|Creek|Valley|Kills?|Rockaways?|Side|Town|Yards?|Plaza|Mall|Oval|Circle|Way|Row|Walk|Expressway|Expy|Tpke|Turnpike|Highway|Hwy|Pier|Ferry|Market|Library|School|Church|Hospital|Tower|Towers|Field|Fields|Playground|Greenway|Island|Heights|Estates|Manor|Commons|Green|Lake|River|Bridge|Tunnel|Terminal)$/;
const PLACE_BEFORE = /\b(on|at|near|along|off|across|outside|in|around|by)\s*$/i;
const STREET_AFTER = /^\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Pl|Place|Park|Pkwy|Parkway|Sq|Square|Ln|Lane|Dr|Drive|Ct|Court|Hill|Heights|Ridge|Expressway|Expy|Houses)\b/i;

/** Whether the person's words seem to name someone (a role then a name, or two capitalized words that are not a place). */
export function namesSomeone(text: string): boolean {
  if (ROLE_THEN_NAME.test(text)) return true;
  for (const m of text.matchAll(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g)) {
    const ws = m[0].split(/\s+/);
    if (ws.some((w) => PLACE_NAME.test(w) || PLACE_END.test(w))) continue;
    const at = m.index as number;
    if (STREET_AFTER.test(text.slice(at + m[0].length))) continue;
    if (PLACE_BEFORE.test(text.slice(Math.max(0, at - 12), at))) continue;
    return true;
  }
  return false;
}
export const NAMES_SOMEONE = "This draft names someone; 311 may not need their name.";

// Times and recurrences that are plain in the person's words ("at 2 am", "every night",
// "since Monday"). Lifted into When: as written; nothing is computed or inferred.
const DAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)day";
const WHEN_PATTERNS = [
  /\b(?:at|around|about|after|before|until|till)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/gi,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/gi,
  new RegExp(`\\b(?:every|each)\\s+(?:night|day|morning|afternoon|evening|weekend|week|${DAY})\\b`, "gi"),
  new RegExp(`\\bsince\\s+(?:yesterday|last\\s+\\w+|this\\s+\\w+|${DAY}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\\w*\\.?\\s+\\d{1,2}|\\d{1,2}/\\d{1,2})\\b`, "gi"),
  new RegExp(`\\b(?:all night|all day|every day|nightly|daily|tonight|this morning|this afternoon|this evening|last night|yesterday|today|(?:on|last|this)\\s+${DAY})\\b`, "gi"),
];

/** The times the person already gave, in their order, as written. Null when none. */
export function liftWhen(text: string): string | null {
  const hits: { at: number; end: number; s: string }[] = [];
  for (const re of WHEN_PATTERNS) for (const m of text.matchAll(re)) hits.push({ at: m.index as number, end: (m.index as number) + m[0].length, s: m[0].trim() });
  hits.sort((a, b) => a.at - b.at || b.end - a.end);
  const kept: typeof hits = [];
  for (const h of hits) if (!kept.some((k) => h.at < k.end && k.at < h.end)) kept.push(h);
  return kept.length ? kept.map((k) => k.s).join(", ") : null;
}

// ─── the tool ─────────────────────────────────────────────────────────────────

export const ONGOING = ["still happening", "stopped", "keeps happening"] as const;

export const DRAFT_SHAPE = {
  description: z.string().min(3).max(500),
  location: z.string().min(2).max(200).optional(),
  borough: z.enum(BOROUGHS).optional(),
  when: z.string().min(1).max(100).optional(),
  ongoing: z.enum(ONGOING).optional(),
  details: z.string().min(1).max(1000).optional(),
  include_contact: z
    .object({ name: z.string().min(1).max(100).optional(), phone: z.string().min(7).max(30).optional(), email: z.string().email().max(200).optional() })
    .strict()
    .optional(),
};
export type DraftArgs = z.infer<z.ZodObject<typeof DRAFT_SHAPE>>;

export const NOT_SENT = "This draft is not sent anywhere and the server files nothing. The person reports the problem themselves, on 311 Online, in the NYC311 app, by phone or by text.";
export const FIELDS_NOTE = "The City does not publish each form's exact fields, so the form may ask for things this draft doesn't cover.";
export const CHECK_STATUS_URL = `${PORTAL}/check-status/`;
const WHERE_NOTE =
  "311 asks where the problem is. On 311 Online and in the app you may be asked to set the spot on a map: check that it is where the problem is. (BetaNYC wording; the form itself is not published.)";

type Matched = Awaited<ReturnType<typeof howToReport>>;
type Best = NonNullable<Matched["best_match"]>;

const MAX_PROBLEMS = 3;
const CITY_DOES_NOT = /^The City (does not|doesn’t|doesn't) (accept|handle|take)/i;
/** The article's own "not taking complaints right now" (DSNY's sidewalk snow action out of season). */
const NOT_NOW = /(not|n’t|n't) (taking|accepting)|does not accept|cannot accept/i;

/** The safety fields every answer starts with (the same as how_to_report's). */
const SAFETY = { safety_line: SAFETY_LINE, safety_line_source: SAFETY_LINE_SOURCE, assistant_instruction: ASSISTANT_INSTRUCTION } as const;

export async function draftReport(args: DraftArgs, client: ContentClient = contentClient(), soda: SodaClient = sodaClient(), data: BoardStatData = boardstatData()) {
  try {
    return await draftReportInner(args, client, soda, data);
  } catch (err) {
    // Every error starts with the safety line, as how_to_report's do.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.startsWith(SAFETY_LINE) ? message : `${SAFETY_LINE} ${message}`);
  }
}

async function draftReportInner(args: DraftArgs, client: ContentClient, soda: SodaClient, data: BoardStatData) {
  // `details` and `when` go into the paste text too, so they are read for danger as well,
  // each on its own: "not urgent" in one field does not cancel danger named in another.
  const dangerWhole = assessDanger(args.description);
  const dangerOther = [args.details, args.when].map((t) => (t ? assessDanger(t) : null)).find((x) => x?.kinds.length) ?? null;
  const notDrafted = (first_line: string, emergency: unknown, extra: Record<string, unknown> = {}) =>
    finish({
      ...SAFETY,
      first_line,
      emergency,
      drafted: false,
      reports: [],
      not_drafted: "No 311 draft is made when the description suggests an emergency. Call 911 first. When the emergency is over and a problem that is not an emergency remains (a pothole after a crash, say), ask again about that problem.",
      ...extra,
      how_to_reach_311: REACH_311,
      not_sent: NOT_SENT,
    });

  // One report per problem, split by how_to_report's own splitProblems; each part is
  // matched on its own, and kept when it lands on an article no other part did.
  const split = splitProblems(args.description);
  const each: { said: string; match: Matched }[] = [];
  let whole: Matched;
  try {
    whole = await howToReport({ description: args.description, borough: args.borough }, client, data);
    if (split.length > 1) for (const part of split.slice(0, MAX_PROBLEMS)) each.push({ said: part, match: await howToReport({ description: part, borough: args.borough }, client, data) });
  } catch (err) {
    // 311's content could not be read (no key, the API down) and the danger is only in
    // `details` or `when`: the City's built-in 911 line for that danger, not a bare error
    // (beta retest 1, 2026-11-08). Without danger, the error stands.
    if (!dangerOther) throw err;
    const emergency = emergencyLead(dangerOther, BUILT_IN_911)!;
    if (emergency.ka_number) emergency.source += ` (the City's words, built into this server as read ${BUILT_IN_911_READ}, because 311's content could not be reached just now)`;
    return notDrafted(emergency.call_911, emergency, { content_unavailable: `311's articles could not be reached, so only the safety answer is given. ${err instanceof Error ? err.message : String(err)}` });
  }

  // Danger: no draft whenever assessDanger flags it, in the whole description or in any
  // part, or how_to_report leads with 911 (including a matched City article that itself
  // says "Call 911"). The answer is how_to_report's own 911 answer; for danger named only
  // in `details` or `when`, the City's built-in line for that danger.
  const flaggedPart = each.find((x) => assessDanger(x.said).kinds.length || x.match.emergency);
  const cityCall911 = Boolean(whole.best_match && /^call 911\b/i.test(whole.best_match.summary) && whole.first_line === whole.best_match.summary);
  if (dangerWhole.kinds.length || whole.emergency || flaggedPart || cityCall911 || dangerOther) {
    const emergency =
      whole.emergency ??
      flaggedPart?.match.emergency ??
      emergencyLead(dangerWhole.kinds.length ? dangerWhole : flaggedPart ? assessDanger(flaggedPart.said) : dangerOther ?? assessDanger(args.description), BUILT_IN_911);
    if (emergency?.ka_number && !whole.emergency && !flaggedPart?.match.emergency) emergency.source += ` (the City's words, built into this server as read ${BUILT_IN_911_READ})`;
    return notDrafted(whole.emergency || cityCall911 ? whole.first_line : (flaggedPart?.match.emergency ? flaggedPart.match.first_line : (emergency?.call_911 ?? GENERIC_911)), emergency);
  }

  const sla = await slaTable(soda);
  const noArticle = (m: Matched) => !m.best_match && !cityDoesNot(m);

  // One problem: no article, no draft (how_to_report's no-match answer, 911 first).
  if (each.length < 2) {
    if (noArticle(whole)) return noMatchAnswer(whole);
  }

  // Every part is listed: a draft when it matched, a "couldn't match" entry when not, and
  // a pointer when it matched the same article as an earlier part.
  const reports: Record<string, unknown>[] = [];
  if (each.length >= 2) {
    const seen = new Map<string, number>();
    for (const [i, x] of each.entries()) {
      const ka = x.match.best_match?.ka_number;
      if (noArticle(x.match)) {
        reports.push({ status: "not_matched", this_problem: cleanText(x.said).text, note: "Couldn't match this part to a 311 article, so it has no draft. Ask how_to_report about it on its own, or browse list_311_categories." });
      } else if (ka && seen.has(ka)) {
        reports.push({ status: "same_article", this_problem: cleanText(x.said).text, ka_number: ka, note: `Matches the same 311 article as part ${(seen.get(ka) as number) + 1}; describe it in that report.` });
      } else {
        if (ka) seen.set(ka, i);
        reports.push(await oneReport(x.said, x.match, args, client, sla, true));
      }
    }
    if (!reports.some((r) => r.status === "drafted" || r.status === "not_a_311_report" || r.status === "no_exact_match")) return noMatchAnswer(whole);
  } else {
    reports.push(await oneReport(args.description, whole, args, client, sla, false));
  }
  const drafts = reports.filter((r) => r.status === "drafted");
  const unmatched = reports.filter((r) => r.status === "not_matched").length;
  const one = reports[0] as { status: string; report_at?: { title: string; ka_number: string }; placeholders?: string[] };

  const first_line =
    reports.length > 1
      ? `${unmatched ? `${GENERIC_911} ` : ""}This sounds like ${reports.length} problems; 311 takes one problem per report, so there is a draft for each that matched (${drafts.length} of ${reports.length}). ${FIELDS_NOTE}`
      : one.status === "not_a_311_report"
        ? `The City's own article says it does not take this (${one.report_at?.ka_number}); its words are in where_to_go. No draft is made.`
        : one.status === "no_exact_match"
          ? "No exact match: no 311 report option fits this. The closest City articles are in closest_options; no draft is made, because it would go to the wrong place."
        : `Draft ready for "${one.report_at!.title}" (${one.report_at!.ka_number}). ${one.placeholders!.length ? `Fill in the ${one.placeholders!.length} [add: …] place${one.placeholders!.length > 1 ? "s" : ""} first. ` : ""}${FIELDS_NOTE}`;

  return finish({
    ...SAFETY,
    first_line,
    emergency: null,
    drafted: drafts.length > 0,
    reports,
    how_to_reach_311: REACH_311,
    not_sent: NOT_SENT,
    fields_note: FIELDS_NOTE,
    sources: {
      matching: "how_to_report: BetaNYC's keyword match over the City's 311 articles (NYC 311 Public API content operations).",
      articles: whole.source,
      problem_details: sla
        ? { name: "311 Service Level Agreements (NYC Open Data)", url: SLA_URL, last_updated: sla.rows_updated, fetched_at: sla.fetched_at, note: `Last updated by the City ${sla.rows_updated}; the dataset says "Annually" but has not changed since. Options and response times may be out of date.` }
        : { name: "311 Service Level Agreements (NYC Open Data)", url: SLA_URL, note: "Could not be reached and no saved copy exists; no Problem Detail options are listed." },
    },
    caveats: [
      FIELDS_NOTE,
      "Which article and problem type fit is BetaNYC's keyword match, not the City's. Read the article before you report.",
      "The draft holds only what the person said. Nothing is made up: anything missing is marked [add: …].",
      NOT_SENT,
    ],
    ...(sla?.stale ? { stale: true as const, warning: sla.warning } : whole.stale ? { stale: true as const, warning: whole.warning } : {}),
  });
}

function cityDoesNot(m: Matched): boolean {
  const lead = m.best_match ?? m.alternatives[0] ?? null;
  return Boolean(lead && CITY_DOES_NOT.test(lead.summary) && !(m.best_match && m.best_match.report_actions.length));
}

/** No article matched: how_to_report's no-match answer, which leads with 911. No draft. */
function noMatchAnswer(whole: Matched) {
  // No article: how_to_report's no-match line (it names 911); the response ends with SAFETY_LINE.
  const first = whole.first_line;
  return finish({
    ...SAFETY,
    first_line: first,
    emergency: whole.emergency,
    drafted: false,
    reports: [],
    not_drafted: "No 311 article matched, so no draft is made: a report needs the right article. Ask the person to say more about the problem, or browse list_311_categories.",
    no_match: whole.no_match,
    alternatives: whole.alternatives,
    how_to_reach_311: REACH_311,
    not_sent: NOT_SENT,
  });
}

async function oneReport(said: string, match: Matched, args: DraftArgs, client: ContentClient, sla: SlaTable | null, split: boolean) {
  const best: Best | null = match.best_match;
  const placeholders: string[] = [];
  const questions: string[] = [];
  const what = cleanText(said);
  const loc = args.location ? cleanText(args.location) : null;
  const when = args.when ? cleanText(args.when) : null;
  const details = args.details ? cleanText(args.details) : null;
  const contactRemoved = [what, loc, when, details].some((x) => x?.contact_removed);
  const zipRemoved = [what, loc, details].some((x) => x?.zip_removed);

  let article: Article | null = null;
  if (best) {
    try {
      article = (await client.article(best.ka_number)).value; // the copy how_to_report just read
    } catch {
      article = null;
    }
  }

  // Not a 311 report: the article's own summary says the City does not take it (KA-01332
  // "The City does not accept complaints about body or cooking odor from a residence."),
  // or it has no report option and no phone way and says who handles it instead.
  const lead = best ?? match.alternatives[0] ?? null;
  if (lead && cityDoesNot(match)) {
    return {
      status: "not_a_311_report" as const,
      you_said: what.text,
      report_at: { title: lead.title, ka_number: lead.ka_number, portal_url: lead.portal_url },
      where_to_go: { the_city_says: uniq([lead.summary, ...(best?.the_city_says_it_does_not ?? [])]), source: `311 article ${lead.ka_number}, ${lead.portal_url}` },
      paste_text: null,
      placeholders,
      questions_to_ask: ["Read the article with the person: it is the City's own word on whether 311 takes this, and where to go instead if it says."],
    };
  }
  if (best && !best.report_actions.length && !best.ways_to_report.length && best.the_city_says_it_does_not.length) {
    return {
      status: "not_a_311_report" as const,
      you_said: what.text,
      report_at: { title: best.title, ka_number: best.ka_number, portal_url: best.portal_url },
      where_to_go: { the_city_says: best.the_city_says_it_does_not, agencies_named: (best as { agencies_named_in_text?: string[] }).agencies_named_in_text ?? [], source: `311 article ${best.ka_number}, ${best.portal_url}` },
      paste_text: null,
      placeholders,
      questions_to_ask: ["Read the article with the person: it says where this goes instead of 311."],
    };
  }

  // No exact match: the closest article's only report option is for a place the person did
  // not name (a neighbor's grill and Barbecuing's park-only option). No draft: a draft would
  // send the report to the wrong place. The closest City articles are listed instead.
  if (best && (best as { exact_match?: false }).exact_match === false) {
    return {
      status: "no_exact_match" as const,
      you_said: what.text,
      closest_options: [
        { title: best.title, ka_number: best.ka_number, portal_url: best.portal_url, summary: best.summary, why_not_exact: best.no_best_action },
        ...match.alternatives.slice(0, 3).map((a) => ({ title: a.title, ka_number: a.ka_number, portal_url: a.portal_url, summary: a.summary })),
      ],
      ...(best.call_911 ? { the_city_says_call_911_when: best.call_911 } : {}),
      paste_text: null,
      placeholders,
      questions_to_ask: ["No 311 report option fits exactly. Read the closest articles with the person; they say what the City takes and where."],
    };
  }

  // What
  const options = best?.problem_type && sla ? detailOptions(sla.rows, best.problem_type, best.agency_source === "report option" ? best.agency : null) : [];
  // The article's report option may name a Problem Detail ("Cave-in" on the pothole
  // article). It goes into the draft only when the person's words say so too.
  const saidAll = [said, args.details ?? ""].join(" ");
  const actionDetail = best?.problem_detail && likelyDetail([{ problem_detail: best.problem_detail, additional_details: [], response_time: [] }], saidAll) ? best.problem_detail : null;
  // A Problem Detail guessed from the words is a suggestion to confirm, never put in the draft.
  const suggested = actionDetail ? null : options.length ? likelyDetail(options, saidAll) : null;
  const chosen = actionDetail ?? suggested;
  const problemLine = best ? `${best.title}${best.problem_type ? ` (311 problem type: ${best.problem_type}${actionDetail ? `, ${actionDetail}` : ""})` : ""}` : "[add: which problem this is: pick the 311 article on 311 Online]";
  if (!best) {
    placeholders.push("which problem this is");
    questions.push("Which 311 article fits? Try how_to_report with other words, or list_311_categories.");
  } else if (!best.problem_type && best.report_actions.length) {
    questions.push(`Which of the article's report options fits? ${uniq(best.report_actions.map((x) => x.name ?? x.section)).slice(0, 6).join("; ")}.`);
  }
  if (suggested) questions.push(`Is it "${suggested}"? That is the closest of the City's 2024 Problem Detail options to their words.`);
  else if (options.length > 1 && !chosen) {
    questions.push(
      options.length <= 8
        ? `Which of these fits best? ${options.map((o) => o.problem_detail).join("; ")} (the City's 2024 list; the form's own choices may differ).`
        : `Which kind is it? The City's 2024 list has ${options.length} options for this problem type (what.problem_detail_options); the form will offer its own.`
    );
  }

  // Where
  let whereLine: string;
  if (loc && args.borough) whereLine = `${loc.text}, ${args.borough}`;
  else if (loc) {
    whereLine = `${loc.text}, [add: borough]`;
    placeholders.push("borough");
    questions.push("Which borough is it in?");
  } else {
    whereLine = `[add: where: the street address, or the two nearest cross streets, or a landmark], ${args.borough ?? "[add: borough]"}`;
    placeholders.push("where");
    questions.push("Where exactly is it? A street address, the two nearest cross streets, or a landmark.");
    if (!args.borough) {
      placeholders.push("borough");
      questions.push("Which borough is it in?");
    }
  }

  // When
  const ongoing = args.ongoing === "still happening" ? "It is still happening." : args.ongoing === "keeps happening" ? "It keeps happening." : args.ongoing === "stopped" ? "It has stopped." : null;
  let whenLine: string;
  const lifted = when ? null : liftWhen([what.text, details?.text ?? ""].join(" "));
  if (when) whenLine = `${when.text}${ongoing ? `. ${ongoing}` : ""}`;
  else if (lifted) whenLine = `${lifted}${ongoing ? `. ${ongoing}` : ""}`;
  else {
    whenLine = `[add: when you saw it (date and time)]${ongoing ? `. ${ongoing}` : ""}`;
    placeholders.push("when");
    questions.push("When did you see it (date and time)?");
  }
  if (!ongoing) questions.push("Is it still happening, has it stopped, or does it keep happening?");

  // What the City's article says you need
  const need = article ? whatYouNeed(article).filter((l) => !CONTACT.test(l)) : [];
  for (const n of need) if (!/^You must provide:?$/i.test(n)) questions.push(`The City's article asks for: ${n}`);

  // Contact
  const cityContact = article ? contactText(article) : [];
  const anonymous = cityContact.filter((s) => ANONYMOUS.test(s));
  const contact = {
    in_draft: Boolean(args.include_contact && Object.values(args.include_contact).some(Boolean)),
    the_city_says: cityContact,
    anonymous: anonymous.length ? anonymous : null,
    note: cityContact.length
      ? "What the City's article says about contact details, quoted. 311 may ask for contact information."
      : "311 may ask for contact information. The article says nothing about it, so whether you can report without it is not stated here.",
    ...(contactRemoved ? { removed: "An email address or phone number in the person's words was left out of the draft. Pass include_contact only if they ask for it to be in the draft." } : {}),
  };
  if (cityContact.some((s) => /must provide/i.test(s)) && !contact.in_draft) {
    questions.push("The City's article says this report needs your contact information. Do you want it in the draft, or will you enter it on the form?");
  }

  // Photos
  const cityPhotos = article ? photoText(article) : [];
  const photos = cityPhotos.length
    ? { the_city_says: cityPhotos, source: `311 article ${best!.ka_number}` }
    : { note: "Have photos ready if you have them. The article does not say whether the form takes them." };

  const draftLines = [
    `Problem: ${problemLine}`,
    `Where: ${whereLine}`,
    `When: ${whenLine}`,
    `What I saw: ${what.text}`,
    ...(details ? [`Details: ${details.text}`] : []),
    ...(contact.in_draft ? [`Contact: ${[args.include_contact!.name, args.include_contact!.phone, args.include_contact!.email].filter(Boolean).join(", ")}`] : []),
  ];
  const phoneOnly = best?.ways_to_report.find((w) => w.method === "phone only");

  return {
    status: (best ? "drafted" : "drafted_without_article") as "drafted" | "drafted_without_article",
    ...(split ? { this_problem: what.text } : {}),
    paste_text: draftLines.join("\n"),
    placeholders: placeholders.map((p) => `[add: ${p}]`),
    questions_to_ask: uniq(questions),
    report_at: best
      ? {
          title: best.title,
          ka_number: best.ka_number,
          portal_url: best.portal_url,
          agency: best.agency,
          problem_type: best.problem_type,
          confidence: best.confidence,
          how: phoneOnly ? `${phoneOnly.how} Use the draft as notes for the call.` : "Open the article's page on 311 Online (portal_url) and use its report option, or use the NYC311 app, phone or text (how_to_reach_311).",
        }
      : null,
    ...(best ? {} : { no_match: match.no_match }),
    what: {
      problem_detail: chosen,
      problem_detail_how: actionDetail ? "Named by the article's report option, and by the person's words." : chosen ? "A likely fit, by the person's words; confirm it with them." : null,
      problem_detail_options: options.length
        ? {
            as_of: sla!.rows_updated,
            label: `From the City's 311 Service Level Agreements dataset, last updated ${sla!.rows_updated}. Old: the form's choices may differ. In brackets, the time the agency committed to respond in, as of then, not a promise of when it will be handled.`,
            options: options.slice(0, MAX_OPTIONS).map(optionText),
            ...(options.length > MAX_OPTIONS ? { more: options.length - MAX_OPTIONS } : {}),
          }
        : null,
    },
    ...(lifted ? { when_note: "When: is taken from the person's own words; check it with them." } : {}),
    ...(namesSomeone([said, args.details ?? ""].join(" ")) ? { names_someone: NAMES_SOMEONE } : {}),
    where: { note: WHERE_NOTE, ...(zipRemoved ? { postal_code_left_out: "A ZIP code was left out: this tool returns none. Give it on the form if it asks." } : {}) },
    the_city_says_you_need: need,
    contact,
    photos,
    what_happens_next: {
      from_the_article: best?.what_happens_next ?? null,
      after_you_report: `Keep the service request number 311 gives you. With it, get_service_request (or 311 Online's "Look Up Service Requests" page, ${CHECK_STATUS_URL}) shows its status.`,
    },
    ...(best?.matched_section ? { article_section: { ...best.matched_section, note: "The part of the City's article that fits the person's words, quoted. Read it first: it may say another office takes this report." } } : {}),
    ...(best?.the_city_says_it_does_not.length ? { the_city_says_it_does_not: best.the_city_says_it_does_not } : {}),
    ...(best?.file_a_complaint && NOT_NOW.test(best.file_a_complaint) ? { the_city_says_right_now: best.file_a_complaint } : {}),
  };
}

function finish<T>(value: T): T {
  const out = scrubZipValues(value);
  assertNoZip(out);
  return out;
}

// ─── tool definition ─────────────────────────────────────────────────────────

export const DRAFT_TOOLS = [
  {
    name: "draft_311_report",
    description:
      `Draft a 311 report for the person to submit themselves: a short ready-to-paste text (problem, where, when, what they saw), the 311 Online article link to report it on, questions to ask them for anything missing (marked [add: …], never made up), Problem Detail options from the City's 2024 Service Level Agreements list (labeled old), what the City's article says about contact details and photos, and what happens next. Uses how_to_report's matching. Files nothing, sends nothing, and fills no form: the City does not publish each form's fields, so the form may ask for more. If the description suggests an emergency it does not draft and says to call 911. A description of two problems gets one draft each. Every answer and error starts with "${SAFETY_LINE}" ${ASSISTANT_INSTRUCTION}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string", minLength: 3, maxLength: 500, description: "The problem in the person's words. Goes into the draft; not stored or sent anywhere." },
        location: { type: "string", minLength: 2, maxLength: 200, description: "Where: a street address, two cross streets ('Broadway and W 96 St'), or a landmark. A ZIP code is left out." },
        borough: { type: "string", enum: [...BOROUGHS] },
        when: { type: "string", minLength: 1, maxLength: 100, description: "When they saw it, in their words ('Nov 6 around 8 pm')." },
        ongoing: { type: "string", enum: [...ONGOING], description: "Whether it is still happening, has stopped, or keeps happening." },
        details: { type: "string", minLength: 1, maxLength: 1000, description: "Anything else they said about it." },
        include_contact: {
          type: "object",
          additionalProperties: false,
          description: "Only if the person asked for their contact details to be in the draft. Otherwise leave out; the form asks for them.",
          properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" } },
        },
      },
      required: ["description"],
    },
  },
];

export const DRAFT_ARG_SHAPES = { draft_311_report: DRAFT_SHAPE };
export type DraftToolName = keyof typeof DRAFT_ARG_SHAPES;

export async function runDraftTool(_name: DraftToolName, args: Record<string, unknown>) {
  return draftReport(args as DraftArgs);
}
