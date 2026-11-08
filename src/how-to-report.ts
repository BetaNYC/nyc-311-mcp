// how_to_report and list_311_categories (#17, first half of #10): from a plain
// description of a problem, the 311 article that fits, the agency and 311 problem
// type it names, what the article says to do, and the ways to report. The server
// never files a report; the person does (epic #12, "Reporting stops at guide and draft").
//
// Matching is deterministic: a word list (CONCEPTS) turns everyday words into the
// words 311's own article titles use, routes the question to a few 311 categories,
// and scores those categories' articles by where the words appear. No model call,
// no new dependency. The word list was written against the category tree and
// article titles the API returned on 2026-11-07 (test/fixtures/content/); category
// hints name categories by their name, and a hint whose category is gone is skipped.
//
// What is said about reporting comes only from City text: the article itself
// (its sections, its "Call 911" lines, its "What Happens Next"), and for the ways
// to reach 311, portal.311.nyc.gov/about-nyc-311/ (read 2026-11-07, REACH_311).

import { z } from "zod";
import { assertNoZip, assertNoZipValues, redactZip } from "./envelope.js";
import { articleUrl, contentClient, NotFoundError, CATEGORY_ID, PORTAL, type Article, type ArticleSummary, type Category, type ContentAction, type ContentClient, type Fetched } from "./content-311.js";
import { BOROUGHS, boardstatData, DISTRICT_JSON, DISTRICT_SHAPE, problemTrend } from "./district-tools.js";
import type { BoardStatData } from "./boardstat-data.js";

// ─── words ────────────────────────────────────────────────────────────────────

const STOP = new Set(
  "a an the my our your his her their its on in at of to is are was were and or for from there here it this that these those me i we you he she they has have had been be by with as am pm all some any very just really so too about into onto over under up down out off again won't wont can't cant don't dont isn't not no yes what when where who how why which while because since every each would could should will can do does did get got keep keeps kept still now today tonight night day week weeks month months year years ago one two three four five lot lots".split(
    " "
  )
);
const IRREGULAR: Record<string, string> = { mice: "mouse", neighbour: "neighbor", neighbours: "neighbor", mould: "mold", children: "child", people: "person", geese: "goose" };

/** A word reduced the same way on both sides: lower case, plural and -ing/-ed endings dropped. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "").replace(/['’]/g, "");
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /(ch|sh|x|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && w.length > 3 && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1); // running → run
  return w;
}

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9’']+/g) ?? []).filter((w) => !/^\d+$/.test(w));
}

const stems = (text: string) => new Set(words(text).filter((w) => !STOP.has(w)).map(stem));

type Concept = {
  /** Matched against the description, lower case. */
  when: RegExp;
  /** Words (any form; stemmed here) that 311's titles use for this, with a weight. */
  terms: string[];
  weight?: number;
  /** Words that point away from the right article when this concept is present. */
  against?: string[];
  /** 311 category names (end nodes) to search. */
  categories?: string[];
  /** Suggests danger: the answer leads with the City's "Call 911" wording. */
  danger?: boolean;
};

// Written against 311's category tree and article titles of 2026-11-07. Each line's
// words are taken from the titles and summaries of the article it should find.
export const CONCEPTS: Concept[] = [
  // Noise (category "Noise")
  { when: /\b(noise|noisy|loud|music|blasting|bass|yell|shout|scream|bang|pound|stomp|stereo|speakers?|tv|television|racket|barks?\b|barking)/, terms: ["noise"], categories: ["Noise"] },
  { when: /\b(neighbou?rs?|next door|upstairs|downstairs|apartment (above|below)|across the hall|my building|the building)\b/, terms: ["neighbor"], weight: 2 },
  { when: /\b(bar|bars|club|nightclub|lounge|restaurant)\b/, terms: ["bar", "club", "restaurant"], weight: 2, against: ["neighbor"] },
  { when: /\b(store|shop|bodega|deli|business)\b/, terms: ["store", "business"], weight: 1 },
  { when: /\b(sidewalk|on the street|in the street|outside|on my block|corner)\b/, terms: ["street", "sidewalk"], weight: 1 },
  { when: /\b(car|cars|truck|vehicle|motorcycle|moped|horn|honk|engine|idling)/, terms: ["vehicle"], weight: 2 },
  { when: /\b(construction|jackhammer|drilling|demolition|crane|scaffold)/, terms: ["construction"], weight: 3, categories: ["Noise", "Buildings & Property"] },
  { when: /\balarm/, terms: ["alarm"], weight: 2 },
  { when: /\b(dog|dogs|barking|barks|animal)\b/, terms: ["dog", "animal"], weight: 2 },
  // Parking and vehicles
  { when: /\b(parked|parking|double[- ]?parked|park(ed)? illegally)\b/, terms: ["parking", "illegal", "parked", "vehicle"], categories: ["Parking", "Tickets & Tows"] },
  { when: /\bhydrant/, terms: ["hydrant"], weight: 2, categories: ["Water", "Sidewalks"] },
  { when: /\bdriveway/, terms: ["driveway", "blocked"], weight: 3, against: ["commercial"], categories: ["Parking"] },
  { when: /\b(abandoned|derelict|junk car|no (license )?plates?|hasn'?t moved|not moved|been (sitting|there) for)/, terms: ["abandoned", "vehicle"], weight: 3, categories: ["Tickets & Tows", "Parking"] },
  { when: /\b(no|without|missing) (license )?plates?\b/, terms: ["without"], weight: 3 },
  { when: /\bwith (a )?(license )?plates?\b/, terms: ["with"], weight: 3 },
  // Housing (category "Tenants")
  { when: /\b(heat|heating|radiators?|boiler|freezing|cold apartment|no heat)\b/, terms: ["heat"], weight: 3, categories: ["Tenants"] },
  { when: /\bhot water\b/, terms: ["hot", "water", "heat"], weight: 2, categories: ["Tenants"] },
  { when: /\b(apartment|landlord|super|superintendent|tenant|my unit|my building|rent)\b/, terms: ["apartment", "residential", "building"], weight: 1, against: ["commercial", "nycha", "loft"], categories: ["Tenants"] },
  { when: /\b(mice|mouse|rats?|roach(es)?|cockroach(es)?|bed ?bugs?|pests?|vermin|fleas|flies)\b/, terms: ["pest", "mouse", "roach", "rat"], weight: 3, categories: ["Tenants", "Pests & Wildlife"] },
  { when: /\b(mold|mould|mildew)\b/, terms: ["mold"], weight: 3, categories: ["Tenants"] },
  { when: /\b(toilet|sink|plumbing|pipes?|shower|bathtub|tub|clogged|faucet)\b/, terms: ["maintenance", "plumbing"], weight: 2, categories: ["Tenants"] },
  { when: /\b(paint|plaster|ceiling|walls?|cracks?|cracked|peeling)\b/, terms: ["maintenance", "paint"], weight: 2, categories: ["Tenants"] },
  { when: /\b(door|doors|locks?|windows?)\b/, terms: ["maintenance", "door", "window"], weight: 2, against: ["guard"], categories: ["Tenants"] },
  { when: /\b(leak|leaking|leaks|dripping|drips|water coming|flooding|flooded)\b/, terms: ["leak", "water"], weight: 2, categories: ["Tenants", "Water"] },
  // Streets and sidewalks
  { when: /\b(pothole|potholes|hole in the (road|street)|cave[- ]?in|sinkhole|crater)/, terms: ["pothole", "cave", "street"], weight: 3, categories: ["Streets & Highways"] },
  { when: /\b(traffic (light|signal)|stop ?light|signal|walk sign|red light)\b/, terms: ["traffic", "signal"], weight: 3, categories: ["Streets & Highways", "Sidewalks"] },
  { when: /\b(street ?lights?|lamp ?posts?|light poles?)\b/, terms: ["street", "light"], weight: 3, categories: ["Streets & Highways", "Sidewalks"] },
  { when: /\b(trees?|branch|branches)\b/, terms: ["tree", "branch"], weight: 3, categories: ["Sidewalks", "Streets & Highways"] },
  { when: /\b(snow|ice|icy|unshoveled|shovel|slush|plow)/, terms: ["snow", "ice"], weight: 3, categories: ["Sidewalks", "Streets & Highways"] },
  // Water
  { when: /\b(water main|gushing|water (all )?over the street|water in the street)/, terms: ["water", "main", "break"], weight: 2, categories: ["Water", "Sidewalks"] },
  { when: /\bhydrant\b.*\b(open|running|leak|spraying|gushing)|\b(open|running|leaking) (fire )?hydrant/, terms: ["hydrant", "leak", "running"], weight: 3, categories: ["Water", "Sidewalks"] },
  // Trash
  { when: /\b(trash|garbage|litter|rubbish|debris|dirty|filthy|broken glass|dog (poop|waste))/, terms: ["dirty", "litter", "trash"], weight: 2, categories: ["Cleaning", "Collection & Disposal"] },
  { when: /\b(dump|dumped|dumping)\b/, terms: ["dump"], weight: 3, categories: ["Cleaning"] },
  { when: /\b(missed (pickup|collection)|not picked up|wasn'?t (picked up|collected)|not collected)/, terms: ["collection", "missed"], weight: 3, categories: ["Collection & Disposal"] },
  // Homelessness
  { when: /\b(homeless|encampments?|tents?|unhoused|sleeping (on|in) the|living on the street)/, terms: ["homeless", "encampment"], weight: 3, categories: ["Safety & Crime", "Homelessness"] },
  // Danger: the City's own articles for these say "Call 911" (category "Safety & Crime").
  { when: /\b(on fire|fire\b(?!\s*(hydrant|escape|alarm|department|code|safety|truck|house|station|inspection))|flames|burning|smoke\b(?!\s*(detector|alarm|free)))/, terms: ["fire", "smoke", "emergency"], weight: 3, categories: ["Safety & Crime"], danger: true },
  { when: /\b(gas (smell|leak)|smells? (of|like) gas|smell gas|gas is leaking)/, terms: ["gas", "leak"], weight: 3, categories: ["Safety & Crime"], danger: true },
  { when: /\bcarbon monoxide\b/, terms: ["carbon", "monoxide"], weight: 3, categories: ["Safety & Crime"], danger: true },
  { when: /\b(hurt|injured|injury|bleeding|unconscious|not breathing|overdos|heart attack|collapsed|ambulance|medical emergency)/, terms: ["medical", "emergency", "injury"], weight: 3, categories: ["Safety & Crime"], danger: true },
  { when: /\b(break[- ]?in|breaking in|burglar|robbery|robbing|being robbed|mugg|assault|attacking|attacked|stabb|shooting|shots fired|gunshots?|gunfire|a gun|weapon|knife)/, terms: ["assault", "gunshot", "crime"], weight: 3, categories: ["Safety & Crime"], danger: true },
  { when: /\b(down(ed)? (power )?lines?|live wire|wires? (down|sparking)|sparking)/, terms: ["dangerous", "electrical"], weight: 2, categories: ["Safety & Crime"], danger: true },
  { when: /\b(crash|collision|hit by a car|car accident)\b/, terms: ["accident", "injury"], weight: 3, categories: ["Safety & Crime"], danger: true },
];

type Query = { terms: Map<string, number>; against: Set<string>; categories: string[]; danger: string[]; matched: string[] };

/** The description as weighted search words. The description itself is not kept. */
export function parseQuery(description: string): Query {
  const text = description.toLowerCase().replace(/\s+/g, " ");
  const terms = new Map<string, number>();
  const against = new Set<string>();
  const categories: string[] = [];
  const danger: string[] = [];
  const matched: string[] = [];
  const add = (t: string, w: number) => terms.set(stem(t), Math.max(terms.get(stem(t)) ?? 0, w));
  for (const c of CONCEPTS) {
    const m = text.match(c.when);
    if (!m) continue;
    matched.push(m[0].trim());
    for (const t of c.terms) add(t, c.weight ?? 2);
    for (const t of c.against ?? []) against.add(stem(t));
    for (const cat of c.categories ?? []) if (!categories.includes(cat)) categories.push(cat);
    if (c.danger) danger.push(m[0].trim());
  }
  for (const w of words(text)) if (!STOP.has(w) && w.length > 2) add(w, 1);
  for (const t of terms.keys()) if (against.has(t)) against.delete(t);
  return { terms, against, categories, danger, matched: [...new Set(matched)] };
}

// ─── scoring ──────────────────────────────────────────────────────────────────

const INFORMATIONAL = /^(learn|get|apply|find|pay|purchase|request permission|access|recorded)\b/i;

export function scoreArticle(q: Query, a: ArticleSummary): { score: number; hits: string[] } {
  const title = stems(a.title);
  const desc = stems(a.description);
  let score = 0;
  const hits: string[] = [];
  for (const [t, w] of q.terms) {
    if (title.has(t)) {
      score += 3 * w;
      hits.push(t);
    } else if (desc.has(t)) {
      score += w;
      hits.push(t);
    }
  }
  for (const t of q.against) if (title.has(t)) score -= 4;
  if (!hits.length) return { score: 0, hits };
  const call911 = /^call 911\b/i.test(a.description);
  if (call911) score += q.danger.length ? 6 : -3;
  else if (/^(report|request|make a complaint)\b/i.test(a.description)) score += 1;
  else if (INFORMATIONAL.test(a.description)) score -= 2;
  return { score, hits };
}

function scoreCategory(q: Query, c: Category): number {
  let s = 0;
  const name = stems(c.name);
  const desc = stems(c.description ?? "");
  for (const [t, w] of q.terms) s += name.has(t) ? 2 * w : desc.has(t) ? w : 0;
  if (q.categories.includes(c.name)) s += 20;
  return s;
}

export const MAX_CATEGORIES = 5;
const MIN_SCORE = 4;

/** End-node categories to search, best first: the hinted ones, then the best by name. */
export function routeCategories(q: Query, all: Category[], max = MAX_CATEGORIES): Category[] {
  const parents = new Set(all.map((c) => c.parent_id).filter(Boolean));
  const leaves = all.filter((c) => !parents.has(c.id) && c.id !== "311-19"); // "A to Z" is a leaf with no articles
  // A category not named by a hint must match well on its own (a recognized word in
  // its name, or several in its description), so a stray word does not add a category.
  const scored = leaves.map((c) => ({ c, s: scoreCategory(q, c) })).filter((x) => x.s >= 5);
  scored.sort((a, b) => b.s - a.s || (a.c.id < b.c.id ? -1 : 1));
  // A danger word always searches Safety & Crime, where the City's "Call 911" articles are.
  const out = scored.map((x) => x.c);
  if (q.danger.length) {
    const sc = leaves.find((c) => c.name === "Safety & Crime");
    if (sc) return [sc, ...out.filter((c) => c.id !== sc.id)].slice(0, max);
  }
  return out.slice(0, max);
}

// ─── reading an article ──────────────────────────────────────────────────────

/** Sentences, never across a line (a list item or heading is its own line). */
const sentences = (text: string) =>
  text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [])
    .map((s) => s.replace(/^•\s*/, "").trim())
    .filter(Boolean);

/** The article's own "Call 911" wording: its summary if it starts so, else its 911 section. */
export function call911Text(a: Pick<Article, "description" | "sections">): string | null {
  if (/^call 911\b/i.test(a.description)) return a.description;
  const s = a.sections.find((x) => /^911\b/.test(x.name));
  if (!s) return null;
  const body = s.text.split(/Need something else\?/i)[0].replace(/^Call 911\s*\n?/i, "").replace(/\s*\n\s*/g, " ").trim();
  return body ? body : null;
}

function whatHappensNext(text: string): string | null {
  const i = text.search(/What Happens Next/i);
  if (i < 0) return null;
  const rest = text.slice(i).replace(/^What Happens Next\s*/i, "");
  const out = sentences(rest).slice(0, 3).join(" ");
  return out || null;
}

const PHONE_ONLY = /(by phone only|must be reported by phone|can only be (reported|made) by phone)/i;
const CALL_311 = /Call 311 or 212-NEW-YORK \(212-639-9675\)/;
const NOT_HANDLED = /(The City does not|does not accept|doesn'?t accept|is not handled by|contact the [^.]* directly)/i;
const AGENCY_IN_TEXT = /\b((?:Department|Office|Administration|Commission|Police Department|Fire Department) (?:of |for )?[A-Z][A-Za-z&' ]+?)\s\(([A-Z]{2,6})\)/g;

function scoreAction(q: Query, x: ContentAction, section: string, ignore: Set<string>): number {
  const s = stems(`${x.name ?? ""} ${x.problem_detail ?? ""} ${section}`);
  let n = 0;
  for (const [t, w] of q.terms) if (s.has(t) && !ignore.has(t)) n += w;
  // An action for a narrower case ("City Vehicle Parked in front of a Fire Hydrant")
  // must not win on shared words when the question never said so.
  for (const t of QUALIFIERS) if (s.has(t) && !q.terms.has(t)) n -= 3;
  return n;
}
const QUALIFIERS = ["city", "commercial", "intercity", "nycha", "loft", "government"];

/** The sentences after a "File a Complaint" heading: often where the City says a complaint cannot be taken right now. */
function fileAComplaint(text: string): string | null {
  const i = text.search(/File a Complaint\n/);
  if (i < 0) return null;
  const rest = text.slice(i + "File a Complaint".length).split(/\nWhat Happens Next/)[0];
  return sentences(rest).slice(0, 2).join(" ") || null;
}

export type Match = ReturnType<typeof describeArticle>;
export type Alternative = { rank: number; title: string; ka_number: string; portal_url: string; summary: string; score: number; matched_words: string[]; found_in_categories: string[] };

function describeArticle(q: Query, a: Article, rank: number, score: number, hits: string[], confidence: string, categories: string[], fetched: Fetched<Article>) {
  const actions = a.sections.flatMap((s) => s.actions.map((x) => ({ section: s.name, ...x })));
  // The best action is the one whose name, detail or section shares the most words with
  // the question. When the article's actions go to different problems, it must share a
  // word that is not in the article's title (which every action shares); otherwise no
  // action is picked and all are listed.
  const titleWords = stems(a.title);
  const distinct = new Set(actions.map((x) => `${x.agency}|${x.problem}`)).size;
  let best: (typeof actions)[number] | null = null;
  let bestScore = 0;
  for (const x of actions) {
    const sc = scoreAction(q, x, x.section, distinct > 1 ? titleWords : new Set());
    if (sc > bestScore) {
      best = x;
      bestScore = sc;
    }
  }
  if (!best && distinct === 1) best = actions[0];
  const bestSection = best ? a.sections.find((s) => s.name === best!.section) : null;
  const all = a.sections.map((s) => s.text).join("\n");
  const problems = [...new Set(actions.map((x) => x.problem).filter((p): p is string => Boolean(p)))];
  const agencies = [...new Set(actions.map((x) => x.agency).filter((p): p is string => Boolean(p)))];
  const named = [...new Set([...all.matchAll(AGENCY_IN_TEXT)].map((m) => `${m[1].trim()} (${m[2]})`))].slice(0, 4);
  const phoneOnly = sentences(all).find((s) => PHONE_ONLY.test(s)) ?? null;
  const callLine = sentences(all).find((s) => CALL_311.test(s)) ?? null;
  const notHandled = [...new Set(sentences(all).filter((s) => NOT_HANDLED.test(s)))].slice(0, 3);
  const ways: { method: string; how: string; url?: string; source: string }[] = [];
  if (actions.length && !phoneOnly) {
    ways.push({
      method: "online",
      how: `On the article's page on 311 Online, which has a report option for: ${[...new Set(actions.map((x) => x.name ?? x.section))].slice(0, 6).join("; ")}.`,
      url: articleUrl(a.ka_number),
      source: "The article's reportable actions (GetContent ContentAction).",
    });
  }
  if (phoneOnly) ways.push({ method: "phone only", how: callLine ? `${phoneOnly} ${callLine}` : phoneOnly, source: "The article's own text." });
  else if (callLine) ways.push({ method: "phone", how: callLine, source: "The article's own text." });
  return {
    rank,
    title: a.title,
    ka_number: a.ka_number,
    portal_url: articleUrl(a.ka_number),
    summary: a.description,
    confidence,
    score,
    matched_words: hits,
    found_in_categories: categories,
    call_911: call911Text(a),
    agency: best?.agency ?? (agencies.length === 1 ? agencies[0] : null),
    problem_type: best?.problem ?? null,
    problem_detail: best?.problem_detail ?? null,
    best_action: best ? { section: best.section, name: best.name } : null,
    problem_types: problems,
    agencies,
    ...(actions.length ? {} : { agencies_named_in_text: named, no_reportable_action: "The article lists no report option with an agency and problem type. Follow what its text says." }),
    ...(actions.length && !best ? { no_best_action: "The article's report options go to different agencies or problem types, and your words did not pick one. They are all in report_actions." } : {}),
    report_actions: actions.slice(0, 15),
    report_actions_truncated: actions.length > 15,
    what_happens_next: (bestSection && whatHappensNext(bestSection.text)) ?? whatHappensNext(all),
    file_a_complaint: (bestSection && fileAComplaint(bestSection.text)) ?? fileAComplaint(a.sections[0]?.text ?? ""),
    the_city_says_it_does_not: notHandled,
    ways_to_report: ways,
    article_fetched_at: fetched.fetched_at,
  };
}

// ─── reaching 311 (City text, read 2026-11-07) ────────────────────────────────

/**
 * From portal.311.nyc.gov/about-nyc-311/, read 2026-11-07: "Call 311 or 212-NEW-YORK
 * (212-639-9675) to connect with us: Outside of New York City; Using a Voice over
 * Internet Protocol (VoIP) provider; Using 711 or a teletypewriter (TTY) service;
 * Using a Video Relay Service (VRS)". "Text 311-692". "Download the NYC311 App: File
 * and track service requests on the go using your smartphone or tablet." (store links
 * from the same page). Online reporting is on each article's page.
 */
export const REACH_311 = {
  source: "https://portal.311.nyc.gov/about-nyc-311/",
  checked: "2026-11-07",
  ways: [
    { method: "311 Online", how: "Open the article's page (portal_url) and use its report option.", url: `${PORTAL}/` },
    {
      method: "NYC311 app",
      how: "\"File and track service requests on the go using your smartphone or tablet.\"",
      android: "https://play.google.com/store/apps/details?id=gov.nyc.doitt.ThreeOneOne",
      apple: "https://apps.apple.com/us/app/nyc-311/id324897619",
    },
    {
      method: "phone",
      how: "Call 311, or 212-NEW-YORK (212-639-9675) from outside New York City, with a VoIP provider, or with 711, TTY, or a Video Relay Service. 24 hours a day, 7 days a week.",
    },
    { method: "text", how: "Text 311-692, 24 hours a day, 7 days a week. Message and data rates may apply." },
  ],
} as const;

export const NOT_FILED = "This tool does not file a report. You report the problem yourself, through one of the ways listed.";

// ─── the tools ────────────────────────────────────────────────────────────────

export const HOW_SHAPE = {
  description: z.string().min(3).max(500),
  borough: z.enum(BOROUGHS).optional(),
  ...DISTRICT_SHAPE,
  last_days: z.number().int().min(1).max(3660).optional(),
  category_id: z.string().regex(CATEGORY_ID).optional(),
  limit: z.number().int().min(1).max(5).optional(),
};

export const CATEGORIES_SHAPE = { category_id: z.string().regex(CATEGORY_ID).optional() };

const oldest = (xs: Fetched<unknown>[]) => xs.map((x) => x.fetched_at).sort()[0] ?? null;

export async function howToReport(args: z.infer<z.ZodObject<typeof HOW_SHAPE>>, client: ContentClient = contentClient(), data: BoardStatData = boardstatData()) {
  if (args.community_district !== undefined && args.council_district !== undefined) throw new Error("Give community_district or council_district, not both.");
  if (args.last_days !== undefined && args.community_district === undefined && args.council_district === undefined) {
    throw new Error("last_days counts reports in a district; give community_district or council_district with it.");
  }
  const q = parseQuery(args.description);
  const used: Fetched<unknown>[] = [];
  const cats = await client.categories();
  used.push(cats);
  let routed: Category[];
  if (args.category_id) {
    const c = cats.value.find((x) => x.id === args.category_id);
    if (!c) throw new Error(`311 has no category ${args.category_id}. list_311_categories lists them.`);
    routed = [c];
  } else {
    routed = routeCategories(q, cats.value);
  }
  const pool = new Map<string, { a: ArticleSummary; cats: string[] }>();
  for (const c of routed) {
    const list = await client.articleList(c.id);
    used.push(list);
    for (const a of list.value) {
      const hit = pool.get(a.ka_number);
      if (hit) hit.cats.push(c.name);
      else pool.set(a.ka_number, { a, cats: [c.name] });
    }
  }
  const ranked = [...pool.values()]
    .map((x) => ({ ...x, ...scoreArticle(q, x.a) }))
    .filter((x) => x.score >= MIN_SCORE)
    .sort((x, y) => y.score - x.score || (x.a.title < y.a.title ? -1 : x.a.title > y.a.title ? 1 : 0));
  const top = ranked.slice(0, args.limit ?? 3);
  const s1 = top[0]?.score ?? 0;
  const s2 = top[1]?.score ?? 0;
  // Only the best match is read in full (one GetContent request); the others are
  // listed from their summaries, which keeps a question to a few requests.
  const matches: Match[] = [];
  const alternatives: Alternative[] = [];
  let unreadable: string | null = null;
  for (const [i, x] of top.entries()) {
    if (i === 0) {
      try {
        const art = await client.article(x.a.ka_number);
        used.push(art);
        const conf =
          s1 >= 9 && s1 - s2 >= 2
            ? "strong: the best fit by a clear margin"
            : s1 >= 9
              ? "close call: the next match scored nearly as well; read both"
              : "possible: few of your words matched; check the article";
        matches.push(describeArticle(q, art.value, 1, x.score, x.hits, conf, x.cats, art));
        continue;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        unreadable = `${x.a.ka_number} is listed in its category but the API returned no article for it.`;
      }
    }
    alternatives.push({
      rank: i + 1,
      title: x.a.title,
      ka_number: x.a.ka_number,
      portal_url: articleUrl(x.a.ka_number),
      summary: x.a.description,
      score: x.score,
      matched_words: x.hits,
      found_in_categories: x.cats,
    });
  }

  const lead = matches[0];
  let first_line: string;
  let emergency: { suggested_by: string[]; call_911: string; source: string } | null = null;
  const leadCall = lead ? call911Text({ description: lead.summary, sections: [] }) : null;
  if (q.danger.length || leadCall) {
    const fromCity = [...matches, ...alternatives].find((m) => /^call 911\b/i.test(m.summary));
    const text = fromCity?.summary ?? (q.danger.length ? "If anyone is in danger, call 911 now. 311 is for problems that are not emergencies." : (leadCall as string));
    emergency = {
      suggested_by: q.danger,
      call_911: text,
      source: fromCity ? `311 article ${fromCity.ka_number}, ${fromCity.portal_url}` : "BetaNYC wording: no City article with a \"Call 911\" summary matched. 311's own articles tell people to call 911 for fires (KA-01543), gas leaks (KA-02048) and medical emergencies (KA-01581).",
    };
    first_line = text.startsWith("Call 911") || text.startsWith("If anyone") ? text : `Call 911: ${text}`;
  } else if (lead) {
    first_line =
      `Best match: "${lead.title}" (${lead.ka_number})` +
      (lead.agency ? `, handled by the ${lead.agency}` : "") +
      (lead.problem_type ? `, 311 problem type "${lead.problem_type}"` : "") +
      `. Confidence ${lead.confidence.split(":")[0]}.`;
  } else if (alternatives.length) {
    first_line = `Possible match: "${alternatives[0].title}" (${alternatives[0].ka_number}). Its details could not be read; open the link.`;
  } else {
    first_line = "No 311 article matched this description well enough to suggest one. Try other words, browse with list_311_categories, or search 311 Online.";
  }

  const searchWords = [...q.terms.entries()].filter(([, w]) => w > 1).map(([t]) => t).slice(0, 6);
  const no_match = lead || alternatives.length
    ? null
    : {
        message: first_line,
        portal_search_url: `${PORTAL}/search/?q=${encodeURIComponent(searchWords.join(" ") || "report a problem")}`,
        portal_search_note: "The search link carries the matched words, not your description, so no address goes into the link.",
      };

  let in_your_district: unknown = null;
  if (lead?.problem_type && (args.community_district !== undefined || args.council_district !== undefined)) {
    try {
      const env = await problemTrend(data, {
        community_district: args.community_district,
        council_district: args.council_district,
        problem: lead.problem_type,
        last_days: args.last_days ?? 365,
      } as Parameters<typeof problemTrend>[1]);
      const d = env.data as { district: unknown; period: unknown; problem: string; requests: number };
      in_your_district = {
        problem: d.problem,
        district: d.district,
        period: d.period,
        requests: d.requests,
        boardstat_url: env.boardstat_url,
        data_as_of: env.data_as_of,
        note: "Reports to 311 of this problem type in the district, from BoardStat (NYC Open Data). Reports, not problems. problem_trend gives the month by month.",
        ...(env.stale ? { warning: env.warning } : {}),
      };
    } catch (err) {
      in_your_district = { problem: lead.problem_type, note: `Not counted: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const stale = used.filter((x) => x.stale);
  const out = {
    first_line,
    emergency,
    best_match: lead ?? null,
    alternatives,
    ...(unreadable ? { note: unreadable } : {}),
    no_match,
    how_to_reach_311: REACH_311,
    not_filed: NOT_FILED,
    ...(args.borough ? { borough: args.borough, borough_note: "311's articles apply citywide; the borough does not change the match. Give it when you report." } : {}),
    in_your_district,
    searched: {
      categories: routed.map((c) => ({ id: c.id, name: c.name })),
      articles_scored: pool.size,
      words_recognized: q.matched,
    },
    source: {
      name: "NYC 311 Public API, content operations (GetCategory, GetContentList, GetContent): the articles on 311 Online",
      url: "https://api-portal.nyc.gov/api-details#api=nyc-311-public-api",
      fetched_at: oldest(used),
    },
    caveats: [
      "The match is made by BetaNYC from keywords, not by the City. Read the article before you report.",
      "The 311 problem type is the one the article names. NYC Open Data calls it complaint_type and sometimes writes it in capitals (\"HEAT/HOT WATER\"). Some articles name an agency but no problem type.",
      `Only the categories listed under searched were read. If the match looks wrong, list_311_categories shows the rest, and category_id searches one of them.`,
      NOT_FILED,
    ],
    ...(stale.length ? { stale: true as const, warning: stale[0].warning } : {}),
  };
  return redactAll(out);
}

export async function list311Categories(args: z.infer<z.ZodObject<typeof CATEGORIES_SHAPE>>, client: ContentClient = contentClient()) {
  const cats = await client.categories();
  const kids = (id: string | null) => cats.value.filter((c) => c.parent_id === id);
  const source = { name: "NYC 311 Public API, GetCategory and GetContentList", url: "https://api-portal.nyc.gov/api-details#api=nyc-311-public-api" };
  const node = (c: Category): Record<string, unknown> => {
    const children = kids(c.id);
    return { id: c.id, name: c.name, description: c.description, portal_url: c.url, ...(children.length ? { subcategories: children.map(node) } : { has_articles: c.id !== "311-19" }) };
  };
  if (!args.category_id) {
    return redactAll({
      categories: kids(null).map(node),
      count: cats.value.length,
      note: "Only categories with no subcategories hold articles. Give one as category_id here to list its articles, or to how_to_report to search only it. \"A to Z\" (311-19) returns no articles through the API.",
      source: { ...source, fetched_at: cats.fetched_at },
      ...(cats.stale ? { stale: true as const, warning: cats.warning } : {}),
    });
  }
  const c = cats.value.find((x) => x.id === args.category_id);
  if (!c) throw new Error(`311 has no category ${args.category_id}. Call list_311_categories with no category_id to see them.`);
  const children = kids(c.id);
  if (children.length) {
    return redactAll({ category: node(c), note: "This category has subcategories; articles are in the ones with no subcategories.", source: { ...source, fetched_at: cats.fetched_at } });
  }
  const list = await client.articleList(c.id);
  return redactAll({
    category: { id: c.id, name: c.name, description: c.description, portal_url: c.url },
    articles: list.value.map((a) => ({ ka_number: a.ka_number, title: a.title, summary: a.description, portal_url: articleUrl(a.ka_number) })),
    count: list.value.length,
    source: { ...source, fetched_at: list.fetched_at },
    ...(list.stale || cats.stale ? { stale: true as const, warning: list.warning ?? cats.warning } : {}),
  });
}

/** Every string redacted of ZIP codes (City article text carries mailing addresses), then checked. */
function redactAll<T>(value: T): T {
  const walk = (v: unknown): unknown =>
    typeof v === "string" ? redactZip(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  const out = walk(value) as T;
  assertNoZip(out);
  assertNoZipValues(out);
  return out;
}

// ─── tool definitions ────────────────────────────────────────────────────────

export const REPORT_TOOLS = [
  {
    name: "how_to_report",
    description:
      "Find how to report a problem to 311, from a plain description ('a pothole on my block', 'loud music next door at 2 am', 'no heat in my apartment'). Returns the best 311 articles from the City's own 311 content (title, KA number, link on 311 Online), the agency and the 311 problem type each names (the problem type is NYC Open Data's complaint_type), what the article says to do and what happens next, and the ways to report (311 Online, the NYC311 app, phone 311 or 212-NEW-YORK, text 311-692), all from City text. If the description suggests danger, first_line says to call 911, in the City's words where an article has them. Matching is by keyword, done by BetaNYC, and reads only a few 311 categories (listed in searched). Give community_district or council_district to add how often that problem type was reported there (BoardStat). Does not file anything.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string", minLength: 3, maxLength: 500, description: "The problem in plain words. Not stored and not sent anywhere: only the 311 content is fetched." },
        borough: { type: "string", enum: [...BOROUGHS], description: "Optional. 311's articles are citywide, so this does not change the match; it is noted for the report." },
        ...DISTRICT_JSON,
        last_days: { type: "integer", minimum: 1, maximum: 3660, description: "With a district: count reports over the last N days of data (default 365)." },
        category_id: { type: "string", description: "Search only this 311 category (an id from list_311_categories, e.g. '311-12' for Noise)." },
        limit: { type: "integer", minimum: 1, maximum: 5, description: "How many articles to return (default 3, at most 5)." },
      },
      required: ["description"],
    },
  },
  {
    name: "list_311_categories",
    description:
      "Browse 311's own topic categories (the ones on 311 Online), or, given a category_id, the articles in it with their KA numbers and links. Use it when how_to_report's match looks wrong, then pass the category_id to how_to_report.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        category_id: { type: "string", description: "A category id such as '311-12' (Noise). Leave out to list all categories." },
      },
    },
  },
];

export const REPORT_ARG_SHAPES = { how_to_report: HOW_SHAPE, list_311_categories: CATEGORIES_SHAPE };
export type ReportToolName = keyof typeof REPORT_ARG_SHAPES;

export async function runReportTool(name: ReportToolName, args: Record<string, unknown>) {
  if (name === "how_to_report") return howToReport(args as z.infer<z.ZodObject<typeof HOW_SHAPE>>);
  return list311Categories(args as z.infer<z.ZodObject<typeof CATEGORIES_SHAPE>>);
}
