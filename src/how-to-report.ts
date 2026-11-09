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
import { assertNoZip, redactZip, scrubZipValues } from "./envelope.js";
import { articleUrl, contentClient, NotFoundError, CATEGORY_ID, PORTAL, type Article, type ArticleSummary, type Category, type ContentAction, type ContentClient, type Fetched } from "./content-311.js";
import { BOROUGHS, boardstatData, DISTRICT_JSON, DISTRICT_SHAPE, problemTrend } from "./district-tools.js";
import type { BoardStatData } from "./boardstat-data.js";
import { ASSISTANT_INSTRUCTION, BUILT_IN_911, BUILT_IN_911_READ, assessDanger, CRIME_POINTER, CRIME_WORDS, emergencyLead, GENERIC_911, normalize, SAFETY_LINE, SAFETY_LINE_SOURCE, type DangerAssessment } from "./emergency.js";

// ─── words ────────────────────────────────────────────────────────────────────

const STOP = new Set(
  "a an the my our your his her their its on in at of to is are was were and or for from there here it this that these those me i we you he she they has have had been be by with as am pm all some any very just really so too about into onto over under up down out off again won't wont can't cant don't dont isn't not no yes what when where who how why which while because since every each would could should will can do does did get got keep keeps kept still now today tonight night day week weeks month months year years ago one two three four five lot lots el la los las de del en mi mis un una muy hay y que es por con".split(
    " "
  )
);
const IRREGULAR: Record<string, string> = { mice: "mouse", neighbour: "neighbor", neighbours: "neighbor", mould: "mold", children: "child", people: "person", geese: "goose" };

/** A word reduced the same way on both sides: lower case, plural, -ment, -ing and -ed endings dropped. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/['’]s$/, "").replace(/['’]/g, "");
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /(ch|sh|x|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 7 && w.endsWith("ment")) w = w.slice(0, -4); // harassment → harass
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && w.length > 3 && !/(ll|ss|ff|zz)$/.test(w)) w = w.slice(0, -1); // running → run
  return w;
}

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9’'áéíóúñü]+/g) ?? []).filter((w) => !/^\d+$/.test(w));
}

const stems = (text: string) => new Set(words(text).filter((w) => !STOP.has(w)).map(stem));

// ─── typos ────────────────────────────────────────────────────────────────────

/**
 * Words a typo is corrected to: one edit (insert, delete, change, or swap two
 * neighbors) away, on words of 5 letters or more. Chosen so that no common word is
 * one edit from one of them ("barking" is not corrected to "parking", "beating" not
 * to "heating", "leaning" not to "leaking", "night" not to "light"); TYPO_SAFE guards
 * the near misses we know of.
 */
export const TYPO_VOCAB = [
  "pothole", "potholes", "street", "streets", "sidewalk", "music", "noise", "neighbor", "neighbors", "garbage", "apartment",
  "landlord", "ceiling", "driveway", "hydrant", "abandoned", "construction", "homeless", "encampment", "traffic", "signal",
  "plumbing", "toilet", "roaches", "elevator", "harassing", "graffiti", "recycling", "collection", "shoveled", "illegal",
  "sanitation", "radiator", "cockroach", "mattress", "blocking", "parking",
];
const TYPO_SAFE = new Set(["sparking", "sparkling", "barking", "parked", "barked", "beating", "leaning", "night", "broke", "streak", "ceilings", "noisy", "musics", "hydrants", "signals", "sidewalks", "toilets", "landlords", "elevators", "mattresses"]);

function oneEdit(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

/** The description with likely typos of known words corrected ("pothoel on my stret" → "pothole on my street"). */
export function correctTypos(text: string): { text: string; corrected: string[] } {
  const corrected: string[] = [];
  const out = text.replace(/[a-z]{5,}/g, (w) => {
    if (TYPO_SAFE.has(w) || TYPO_VOCAB.includes(w)) return w;
    const hit = TYPO_VOCAB.find((v) => oneEdit(w, v));
    if (!hit) return w;
    corrected.push(`${w} → ${hit}`);
    return hit;
  });
  return { text: out, corrected };
}

// ─── concepts ─────────────────────────────────────────────────────────────────

type Concept = {
  /** Matched against the description, lower case. */
  when: RegExp;
  /** The concept does not apply when this also matches ("cracked" with "sidewalk" is not an apartment repair). */
  unless?: RegExp;
  /** A further check on the whole description (indoor and outdoor words for a water leak). */
  onlyIf?: (text: string) => boolean;
  /** Words (any form; stemmed here) that 311's titles use for this, with a weight. */
  terms: string[];
  weight?: number;
  /** Words that point away from the right article when this concept is present. */
  against?: string[];
  /** 311 category names (end nodes) to search. */
  categories?: string[];
  /**
   * The kind of problem, for descriptions with more than one ("no hot water and the
   * elevator is broken"). Concepts without a family (a place, a vehicle) only add context.
   */
  family?: string;
  /** A Spanish word for the problem (the answer then points to 311's language help). */
  spanish?: boolean;
};

// A pickup that did not happen: the City's Missed Trash, Recycling, or Compost Collection
// article (KA-01788), not a litter basket. Beta retest 2026-11-08: "sanitation skipped our
// garbage pickup" got Litter Basket Complaint.
const MISSED_COLLECTION = /\b(skipped|missed|didn'?t (come|pick)|never (came|picked)|forgot)\b[^.]{0,40}\b(pick ?-?ups?|collections?|garbage|trash|recycling|compost)\b|\b(not|never|wasn'?t|weren'?t) (been )?(picked up|collected)\b|\bno recogieron\b/;
// Water standing in the street: the City's Street Flooding article (KA-02198), not a leak in
// a building. Beta retest 2026-11-08.
// Beta retest 4, 2026-11-09: "water pooling in the road" found nothing, so pooling counts too.
const STREET_FLOOD = /\b(street|road|roadway|intersection|corner|crosswalk|block)\b[^.]{0,30}\b(flood\w*|ponding|pool(s|ed|ing)|puddl\w*|under water|standing water)\b|\b(flood\w*|ponding|pool(s|ed|ing)|standing water)\b[^.]{0,30}\b(street|road|roadway|intersection|corner|crosswalk)\b/;
// Water leaking outdoors: the City's Water Leak on Street or Sidewalk (KA-01234), not Water
// Leak in a Building (KA-01509). Indoor and outdoor words decide: any indoor word ("my
// ceiling", "into my apartment") keeps the building article. Beta retest 4, 2026-11-09:
// "water is leaking from the street" got Water Leak in a Building, rated strong.
const OUTDOOR = "(streets?|sidewalks?|road|roadway|pavement|asphalt|curb|gutter|crosswalk|intersection|corner|block)";
const STREET_LEAK = new RegExp(`\\b(water|leak\\w*|drip\\w*|gush\\w*|bubbl\\w*|seep\\w*)\\b[^.]{0,40}\\b${OUTDOOR}\\b|\\b${OUTDOOR}\\b[^.]{0,30}\\b(leak\\w*|drip\\w*|gush\\w*|bubbl\\w*|seep\\w*)\\b`);
const INDOOR_WATER = /\b(ceilings?|walls?|apartment|bathroom|kitchen|bedroom|basement|upstairs|downstairs|hallways?|lobby|stairwell|roof|radiators?|sinks?|toilets?|bathtub|tub|shower|faucets?|apartamento|techo)\b|\b(in|into|inside) (my|the|our) (building|home|house|unit|room|place)\b/;
const WATER_MAIN = /\bwater ?mains?\b|\bmain (broke|burst|break)\b/;
// Either order: "water is gushing out of a hydrant" (beta retest 6 stress set) got Water Main Break.
const HYDRANT_WATER = /\bhydrant\b[^.]*\b(open|running|leak\w*|spray\w*|gush\w*|drip\w*)\b|\b(open|running|leaking) (fire )?hydrant|\b(leak\w*|spray\w*|gush\w*|pour\w*|spurt\w*|shoot\w*)\b[^.]{0,30}\bhydrant\b/;
const LEAKY = /\b(leak\w*|drip\w*|gush\w*|bubbl\w*|seep\w*|spurt\w*|spray\w*|coming (up|out)|pour\w*|flowing|running)\b/;
export const isStreetLeak = (text: string) => STREET_LEAK.test(text) && LEAKY.test(text) && !NO_WATER.test(text) && !INDOOR_WATER.test(text) && !STREET_FLOOD.test(text) && !WATER_MAIN.test(text) && !HYDRANT_WATER.test(text);

// No water (not no hot water): the City's No Water, Low Water Pressure, or Water Temperature
// Complaint (KA-01405), not Heat or Hot Water. Beta retest 2, 2026-11-09.
const NO_WATER = /\b(no|without|lost|losing) (running )?water\b|\bwater (is |was |has been |got )?(off|out|shut off|turned off)\b|\b(low|weak|no) water pressure\b|\bno hay agua\b/;
// An engine left running: the City's Idling Vehicle article (KA-02222). Beta retest 2, 2026-11-09.
const IDLING = /\bidl(e|es|ed|ing)\b|\b(engine|motor) (is |was |has been |kept |left )?(running|on)\b(?! fire)|\b(left|kept|keeps) (the |its |their |his |her )?(engine|motor) (running|on)\b(?! fire)/;
// Trash inside a building (a lobby, hallway or basement): the City's Apartment Maintenance
// Complaint (KA-01074), whose public-area and building-wide sections cover unsanitary
// conditions and garbage storage; not Dirty Gutter or a litter basket. Beta retest 2, 2026-11-09.
const INDOORS = "(lobby|hallways?|stairwells?|stairs|staircase|basement|laundry room|mailroom|compactor room|inside (my|the|our) building|in (my|the|our) building)";
const TRASH_WORDS = "(trash|garbage|litter|rubbish|debris|filth\\w*|dirty|unsanitary|basura)";
const TRASH_INDOORS = new RegExp(`\\b${TRASH_WORDS}\\b[^.]{0,60}\\b${INDOORS}\\b|\\b${INDOORS}\\b[^.]{0,40}\\b${TRASH_WORDS}\\b`);
// A street, traffic or parking sign: the City's Street Sign Complaint (KA-01063). Beta
// retest 2, 2026-11-09: "the stop sign at the corner was knocked down" found nothing.
const SIGN_DOWN = "(knocked (down|over)|fell|fallen|falling|fall(ing)? down|dangling|leaning|hanging|bent|toppled|on the ground)";
const STREET_SIGN = /\b(stop|street|traffic|parking|yield|one[- ]way|no parking|no standing|street name|bus stop|speed limit|school zone|do not enter) signs?\b/;

// A restroom in a park or playground that is locked, closed, dirty or broken: the City's Park
// Maintenance Complaint (KA-01060), which covers "unclean conditions" and a "park facility
// closed to the public during posted hours"; not Breaking Park Rules, not Unlocked Park or
// Playground (a park left open after hours), not a home repair. Beta retest 5, 2026-11-09:
// "public bathroom in the park is locked" got Breaking Park Rules.
const RESTROOM = "(restrooms?|bathrooms?|toilets?|comfort stations?|washrooms?|ba[nñ]os?)";
const PARK_PLACE = "(parks?|playgrounds?|greenway|ball ?fields?|beach(es)?|pools?|recreation cent(er|re)s?|rec cent(er|re)s?)";
export const PARK_RESTROOM = new RegExp(`\\b${RESTROOM}\\b[^.]{0,40}\\b${PARK_PLACE}\\b|\\b${PARK_PLACE}\\b[^.]{0,30}\\b${RESTROOM}\\b`);

// Hours outside the City's allowed construction hours ("between 7 AM and 6 PM on weekdays", KA-01091).
const AFTER_HOURS = "\\b(([1-6]|1[0-2]) ?(am|a\\.m\\.)|([6-9]|1[01]) ?(pm|p\\.m\\.)|early (in the )?morning|late at night|at night|overnight|after hours|midnight|before 7|on (a )?(saturday|sunday)|weekends?)\\b";
// A dead animal in a public place: the City's Dead Animal on Public Property (KA-02245), with
// Rat or Mouse Complaint still offered. Beta retest 3, 2026-11-09.
const DEAD_ANIMAL = /\bdead (rats?|mice|mouse|birds?|pigeons?|cats?|dogs?|raccoons?|squirrels?|deer|animals?|possums?|opossums?|geese|goose|ducks?|seagulls?|gulls?|skunks?)\b|\b(rats?|mouse|birds?|pigeons?|cats?|dogs?|raccoons?|squirrels?|animals?) (is |was |lying |laying )*dead\b|\b(roadkill|carcass\w*)\b/;

// A smoke or carbon monoxide detector, and an owner who did not put one in.
const DETECTOR = "\\b(smoke|carbon monoxide|co) (detectors?|alarms?)\\b";
const NOT_PUT_IN = "\\b(didn'?t|did not|won'?t|will not|never|refus\\w* to|hasn'?t|has not|haven'?t|have not|doesn'?t|does not|failed to)\\b[^.]{0,20}\\b(install\\w*|put (in|up)|replac\\w*|provid\\w*|give|fix\\w*|have)\\b";
// Dirt inside a home (a bathroom, a kitchen, "my house"): not a litter basket or a dirty street.
// The nearest City article is the Apartment Maintenance Complaint (KA-01074, "Unsanitary
// conditions"), for a rental the owner must keep up; a person's own home has no 311 complaint.
// So it is offered as a possible match, never a strong one: the concept has no family (below).
// Beta retest 6, 2026-11-09: "bathroom in my house is dirty" got Litter Basket, rated strong.
const HOME_ROOM = "(bathrooms?|kitchens?|bedrooms?|living rooms?|my (house|home|apartment|room|place|unit)|apartment|apartamento)";
const DIRTY = "(dirty|filthy|unsanitary|unclean|gross|disgusting|nasty|messy|sucio)";
// A restroom in a station, a store or another public place is not a home (and not a litter basket).
const NOT_HOME = /\b(subway|station|train|bus|terminal|ferry|library|school|restaurant|store|shop|deli|bodega|office|mall|hospital|airport|public (bathroom|restroom|toilet)s?)\b/;
export const DIRTY_AT_HOME = new RegExp(`\\b${HOME_ROOM}\\b[^.]{0,30}\\b${DIRTY}\\b|\\b${DIRTY}\\b[^.]{0,30}\\b${HOME_ROOM}\\b`);

// Written against 311's category tree and article titles of 2026-11-07. Each line's
// words are taken from the titles and summaries of the article it should find.
// Spanish words cover the top problems only; matching is by keyword, not translation.
export const CONCEPTS: Concept[] = [
  // Noise (category "Noise")
  { when: /\b(noise|noisy|loud|music|blasting|bass|yell(?!ow)|shout|scream|bang|pound|stomp|stereo|speakers?|tv\b|television|racket|barks?\b|barking|honk\w*|horns? (blar|honk)\w*|blaring|jingl\w*)/, terms: ["noise"], categories: ["Noise"], family: "noise" },
  { when: /\bice cream (trucks?|vans?)\b/, terms: ["ice", "cream", "truck"], weight: 3, categories: ["Noise"] },
  { when: /\b(ruido|música alta|musica alta|fiesta|gritos)/, terms: ["noise"], categories: ["Noise"], family: "noise", spanish: true },
  { when: /\b(neighbou?rs?|next ?do?or|upstairs|downstairs|apartment (above|below)|across the hall|my building|the building|vecin[oa]s?)\b/, terms: ["neighbor"], weight: 2 },
  { when: /\b(bar|bars|club|nightclub|lounge|restaurant)\b/, terms: ["bar", "club", "restaurant"], weight: 2, against: ["neighbor"] },
  { when: /\b(store|shop|bodega|deli|business)\b/, terms: ["store", "business"], weight: 1 },
  { when: /\b(sidewalk|on the street|in the street|outside|on my block|corner|acera|calle)\b/, terms: ["street", "sidewalk"], weight: 1 },
  // Whole words only: "carbon monoxide" is not a car (beta retest 6, 2026-11-09: "landlord didn't
  // install a carbon monoxide detector" got Vehicle Stored on Residential Property, rated strong).
  { when: /\b(car|cars|trucks?|vehicles?|motorcycles?|mopeds?|horns?|honk\w*|engines?|idling|carros?|coches?)\b/, terms: ["vehicle"], weight: 2 },
  { when: IDLING, unless: /\b(noise|noisy|loud|music|blasting|honk\w*|horn)\b/, terms: ["idling", "vehicle"], weight: 3, against: ["noise", "illegal", "parking"], categories: ["Air"], family: "idling" },
  { when: /\b(construction|jackhammer|drilling|demolition|crane|scaffold)/, terms: ["construction"], weight: 3, categories: ["Noise", "Buildings & Property"], family: "noise" },
  // A jackhammer or drill is noise, and work before or after the allowed hours is the City's
  // "Noise from After Hours Construction" option on Noise from Construction (KA-01091).
  // Beta retest 3, 2026-11-09: "a construction site starts jackhammering at 6am" got the
  // Construction Site No Smoking Sign article on the word "construction".
  { when: /\b(jackhammer\w*|pile[- ]?driv\w*|drilling|demolition)\b/, terms: ["noise", "construction", "jackhammer"], weight: 3, against: ["smoking", "sign", "dust", "permit"], categories: ["Noise"], family: "noise" },
  { when: new RegExp(`\\b(construction|jackhammer\\w*|drilling|demolition)\\b[^.]*${AFTER_HOURS}|${AFTER_HOURS}[^.]*\\b(construction|jackhammer\\w*|drilling|demolition)\\b`), terms: ["noise", "after", "hours"], weight: 2, against: ["smoking", "sign", "dust"], categories: ["Noise"], family: "noise" },
  { when: /\b(alarm)/, unless: /\b(smoke|carbon monoxide|co) (alarm|detector)/, terms: ["alarm", "noise"], weight: 2, categories: ["Noise"], family: "noise" },
  { when: /\b(car (was |got )?hit|hit my car|accident|crash(ed)?|collision|fender[- ]bender)\b/, terms: ["accident", "vehicle"], weight: 3, categories: ["Safety & Crime"], family: "crash" },
  { when: /\bsmok(e|es|ing)\b[^.]{0,25}\b(cigarettes?|cigars?|weed|marijuana|hallway|stairwell|lobby|building)\b|\b(cigarette|secondhand|second-hand) smoke\b/, onlyIf: (t) => !new RegExp(DETECTOR).test(t) || /\b(cigarettes?|cigars?|weed|marijuana|smokers?|smoking)\b/.test(t), terms: ["smoke", "free", "air", "act", "complaint"], weight: 3, categories: ["Tenants", "Public Health"], family: "smoking" },
  { when: /\b(smell|smells|odor|odour|stink\w*|fumes|exhaust)\b/, unless: /\bgas\b/, terms: ["odor", "smell"], weight: 2, categories: ["Air"], family: "odor" },
  // Chimney and vent words only when said: an odor alone is not chimney smoke (with the Air
  // category recorded, "cooking odor" tied with Chimney or Ventilation Smoke; 2026-11-08).
  { when: /\b(chimney|chimneys|vents?|ventilation|exhaust)\b/, terms: ["ventilation", "chimney"], weight: 2, categories: ["Air"] },
  { when: /\b(dog|dogs|barking|barks|animal|perro)\b/, terms: ["dog", "animal"], weight: 2 },
  { when: /\bfireworks?\b|\bfuegos artificiales\b/, terms: ["fireworks"], weight: 3, categories: ["Noise", "Safety & Crime"], family: "fireworks" },
  // Parking and vehicles
  { when: /\b(parked|parking|double[- ]?parked|park(ed)? illegally|mal estacionad\w*|estacionad\w*)\b/, unless: new RegExp(`\\b(parking )?meters?\\b|\\bmuni-?meters?\\b|${STREET_SIGN.source}|${IDLING.source}`), terms: ["parking", "illegal", "parked", "vehicle"], categories: ["Parking", "Tickets & Tows"], family: "parking" },
  // A parking meter: the City's Parking Meter Complaint or Request (KA-01240), not Illegal Parking.
  { when: /\b(parking )?meters?\b|\bmuni-?meters?\b/, unless: /\bwater meters?\b/, terms: ["parking", "meter", "complaint"], weight: 3, against: ["illegal"], categories: ["Parking"], family: "meter" },
  { when: /\bhydrant/, terms: ["hydrant"], weight: 2, categories: ["Water", "Sidewalks"] },
  { when: /\bdriveway/, terms: ["driveway", "blocked"], weight: 3, against: ["commercial"], categories: ["Parking"], family: "parking" },
  { when: /\b(abandoned|derelict|junk car|no (license )?plates?|hasn'?t moved|not moved|been (sitting|there) for)/, terms: ["abandoned", "vehicle"], weight: 3, categories: ["Tickets & Tows", "Parking"], family: "parking" },
  { when: /\b(no|without|missing) (license )?plates?\b/, terms: ["without"], weight: 3 },
  { when: /\bwith (a )?(license )?plates?\b/, terms: ["with"], weight: 3 },
  { when: /\bbike lane\b/, terms: ["bike", "lane"], weight: 3, categories: ["Bikes", "Parking"], family: "bike_lane" },
  // Housing (category "Tenants")
  { when: /\b(heat|heating|radiators?|boiler|freezing|cold apartment|no heat|calefacci[oó]n|no hay calor)\b/, terms: ["heat"], weight: 3, categories: ["Tenants"], family: "heat" },
  { when: /\b(hot water|agua caliente)\b/, terms: ["hot", "water", "heat"], weight: 2, categories: ["Tenants"], family: "heat" },
  { when: NO_WATER, unless: /\bhot water\b/, terms: ["water", "pressure", "temperature"], weight: 3, against: ["heat", "leak", "main"], categories: ["Tenants", "Water"], family: "no_water" },
  { when: /\b(apartment|landlord|super|superintendent|tenant|my unit|my building|rent|apartamento|casero|due[ñn]o|edificio)\b/, terms: ["apartment", "residential", "building"], weight: 1, against: ["commercial", "nycha", "loft"], categories: ["Tenants"] },
  { when: /\b(harass\w*|forcing (me|us) out|trying to (evict|force)|acoso|acosando)\b/, terms: ["harass", "tenant"], weight: 3, categories: ["Tenants"], family: "harassment" },
  // Bed bugs: the City's Bed Bug Complaint (KA-01236), its own article. Beta retest 2026-11-08.
  { when: /\bbed ?bugs?\b|\bchinches\b/, terms: ["bed", "bug", "complaint"], weight: 3, categories: ["Tenants", "Pests & Wildlife"], family: "pests" },
  { when: DEAD_ANIMAL, unless: /\b(apartment|my (home|house|yard|backyard|basement)|in (my|the|our) building|inside)\b/, terms: ["dead", "animal", "public", "property"], weight: 3, against: ["private"], categories: ["Pests & Wildlife", "Sidewalks"], family: "dead_animal" },
  // Rodents and insects apart: a roach is not a rat. Beta retest 6 stress set: "roaches all over
  // my kitchen" got Rat or Mouse Complaint, rated strong, because one word list gave it "rat" too.
  // (The rodent list keeps "roach": with it, Residential Pest Complaint, whose summary names mice
  // and roaches, stays ahead of Rat or Mouse Complaint for rodents at home, as tested since round 1.)
  { when: /\b(mice|mouse|rats?|rodents?|ratas?|ratones|roedores)\b/, terms: ["pest", "mouse", "roach", "rat"], weight: 3, categories: ["Tenants", "Pests & Wildlife"], family: "pests" },
  { when: /\b(roach(es)?|cockroach(es)?|pests?|vermin|fleas|flies|cucarachas|chinches)\b/, terms: ["pest", "roach"], weight: 3, categories: ["Tenants", "Pests & Wildlife"], family: "pests" },
  { when: /\b(mold|mould|mildew|moho|hongos)\b/, terms: ["mold"], weight: 3, categories: ["Tenants"], family: "mold" },
  { when: /\b(toilet|sink|plumbing|pipes?|shower|bathtub|tub|clogged|faucet|inodoro|lavamanos)\b/, unless: PARK_RESTROOM, terms: ["maintenance", "plumbing"], weight: 2, categories: ["Tenants"], family: "repair" },
  { when: /\b(paint|plaster|ceiling|walls?|cracks?|cracked|peeling|pintura|techo)\b/, unless: /\b(sidewalk|street|road|pavement|curb|acera|calle|graffiti)\b/, terms: ["maintenance", "paint"], weight: 2, categories: ["Tenants"], family: "repair" },
  { when: /\b(door|doors|locks?|windows?|puerta|ventana)\b/, unless: /\bfire escape\b|\b(coming|blowing|getting|comes|blows) (in|into|through) (my |the |our )?(windows?|doors?)\b|\bgraffiti\b/, terms: ["maintenance", "door", "window"], weight: 2, against: ["guard"], categories: ["Tenants"], family: "repair" },
  // A detector the owner did not put in is the same complaint as a broken one: owners must install
  // smoke and carbon monoxide detectors (KA-01074, "Smoke Detectors" and its CO section). Beta
  // retest 6, 2026-11-09: "landlord didn't install a CO detector" got no housing article at all.
  { when: new RegExp(`${DETECTOR}[^.]{0,30}\\b(broken|missing|not working|doesn'?t work|dead|removed|chirp\\w*|needs? (a )?(new )?batter\\w*)|\\b(no|missing|broken|without (a |any )?)\\s?${DETECTOR}|${NOT_PUT_IN}[^.]{0,25}${DETECTOR}`), terms: ["maintenance", "apartment"], weight: 3, against: ["installation"], categories: ["Tenants"], family: "repair" },
  { when: /\b(leak|leaking|leaks|dripping|drips|water coming|water (is )?pouring|pouring (in|through|down)|flooding|flooded|gotera|fuga de agua|filtraci[oó]n)\b/, unless: STREET_FLOOD, onlyIf: (t) => !isStreetLeak(t) && !(HYDRANT_WATER.test(t) && !INDOOR_WATER.test(t)) && !(WATER_MAIN.test(t) && !INDOOR_WATER.test(t)), terms: ["leak", "water"], weight: 3, categories: ["Tenants", "Water"], family: "leak" },
  { when: /\b(elevators?|lifts?|escalators?|ascensor|elevador)\b/, terms: ["elevator", "escalator"], weight: 3, categories: ["Buildings & Property"], family: "elevator" },
  { when: /\bfire escapes?\b|\b(blocked|locked) (building )?exits?\b/, terms: ["fire", "escape", "exit", "blocked"], weight: 3, categories: ["Buildings & Property"], family: "exit" },
  // Streets and sidewalks
  { when: /\b(pothole|potholes|hole in the (road|street)|cave[- ]?in|sinkhole|crater|bache|baches|hoyo en la calle)/, terms: ["pothole", "cave", "street"], weight: 3, categories: ["Streets & Highways"], family: "pothole" },
  { when: /\b(sidewalk|acera)\b[^.]{0,30}\b(crack\w*|broken|uneven|raised|trip\w*|damaged|hole)\b|\b(crack\w*|broken|uneven|damaged) (sidewalk|acera)\b/, terms: ["broken", "sidewalk"], weight: 3, categories: ["Sidewalks"], family: "sidewalk" },
  { when: /\b(traffic (light|signal)|stop ?light|signal|walk sign|red light|sem[aá]foro)\b/, terms: ["traffic", "signal"], weight: 3, categories: ["Streets & Highways", "Sidewalks"], family: "signal" },
  { when: STREET_SIGN, terms: ["street", "sign", "complaint"], weight: 3, against: ["request", "purchase", "highway", "advertising", "building"], categories: ["Streets & Highways"], family: "street_sign" },
  // A sign that came down: the "Street Sign Fallen, Dangling, or Leaning" option (KA-01063).
  { when: new RegExp(`${STREET_SIGN.source}[^.]{0,40}\\b${SIGN_DOWN}\\b|\\b${SIGN_DOWN}\\b[^.]{0,30}${STREET_SIGN.source}`), terms: ["fallen", "dangling", "leaning"], weight: 2 },
  // A bus stop shelter: the City's Bus Stop Shelters article (KA-01071). Beta retest 3, 2026-11-09.
  { when: /\bbus (stop )?shelters?\b|\bbus stop\b[^.]{0,30}\b(glass|smashed|broken|shattered|damaged|cracked)\b/, terms: ["bus", "stop", "shelter", "complaint"], weight: 3, against: ["bike", "sheltered"], categories: ["Sidewalks", "Streets & Highways"], family: "bus_shelter" },
  // A street vendor: the City's Street Vendor Complaint (KA-02152). Beta retest 3, 2026-11-09:
  // "someone is selling food on the street without a permit" found nothing.
  { when: /\b(vendors?|vending|peddl\w*|sellers?|hawkers?)\b|\bsell(s|ing)?\b[^.]{0,40}\b(on the street|on the sidewalk|in the street|on my block|on the corner|without a (permit|license))\b|\bfood (carts?|trucks?)\b/, unless: /\b(drugs?|weed|marijuana|counterfeit|fake)\b/, terms: ["street", "vendor", "complaint"], weight: 3, against: ["art", "tax", "contract"], categories: ["Sidewalks", "Streets & Highways"], family: "vendor" },
  { when: /\b(unlicensed|without a (permit|license)|no (permit|license)|illegal(ly)? (vend\w*|sell\w*))\b/, terms: ["unlicensed"], weight: 2 },
  { when: /\b(street ?lights?|lamp ?posts?|light poles?|poste de luz)\b/, terms: ["street", "light"], weight: 3, categories: ["Streets & Highways", "Sidewalks"], family: "street_light" },
  { when: /\b(trees?|branch|branches|[aá]rbol)\b/, terms: ["tree", "branch"], weight: 3, categories: ["Sidewalks", "Streets & Highways"], family: "tree" },
  // A standing dead or dying tree: the City's Dead Tree article (KA-02006), not Fallen Tree
  // or Branch, unless the person says it fell. Beta retest 2026-11-08.
  { when: /\b(dead|dying)\b[^.]{0,20}\b(trees?|[aá]rbol)\b|\btrees?\b[^.]{0,40}\b(dead|dying)\b/, unless: /\b(fell|fallen|falling|came down|knocked down|blew down|toppled)\b/, terms: ["dead"], weight: 3, against: ["fallen"], family: "tree" },
  // A sidewalk shed or scaffold left up: the City's Scaffold or Sidewalk Shed Complaint (KA-02291).
  { when: /\b(sidewalk|construction) sheds?\b|\bscaffold\w*/, terms: ["scaffold", "sidewalk", "shed", "complaint"], weight: 3, against: ["permit"], categories: ["Sidewalks", "Buildings & Property"], family: "scaffold" },
  { when: /\b(snow|ice(?! cream)|icy|unshoveled|shovel|slush|plow|nieve|hielo)/, terms: ["snow", "ice"], weight: 3, categories: ["Sidewalks", "Streets & Highways"], family: "snow" },
  // Water
  { when: STREET_FLOOD, terms: ["street", "flooding", "ponding"], weight: 3, categories: ["Streets & Highways"], family: "street_flooding" },
  { when: /\b(water ?mains?|main (broke|burst|break)|gushing|water (all )?over the street|water in the street)/, onlyIf: (t) => !INDOOR_WATER.test(t) && !(HYDRANT_WATER.test(t) && !WATER_MAIN.test(t)), terms: ["water", "main", "break"], weight: 3, against: ["building", "meter"], categories: ["Water", "Sidewalks"], family: "water" },
  { when: HYDRANT_WATER, terms: ["hydrant", "leak", "running"], weight: 3, against: ["building", "request", "permit"], categories: ["Water", "Sidewalks"], family: "water" },
  { when: STREET_LEAK, onlyIf: isStreetLeak, terms: ["water", "leak", "street", "sidewalk"], weight: 3, against: ["building", "apartment", "meter", "commercial", "drinking"], categories: ["Sidewalks", "Streets & Highways"], family: "water" },
  // Trash
  { when: TRASH_INDOORS, unless: /\b(trash|garbage|litter|recycling|public) (cans?|baskets?|bins?)\b|\bbaskets?\b/, terms: ["apartment", "maintenance", "complaint"], weight: 3, against: ["gutter", "sidewalk", "street", "basket", "lot"], categories: ["Tenants"], family: "building_trash" },
  { when: /\b(trash|garbage|litter|rubbish|debris|dirty|filthy|broken glass|dog (poop|waste)|basura|sucio)/, unless: new RegExp(`${MISSED_COLLECTION.source}|${TRASH_INDOORS.source}|${PARK_RESTROOM.source}|${DIRTY_AT_HOME.source}`), terms: ["dirty", "litter", "trash"], weight: 2, categories: ["Cleaning", "Collection & Disposal"], family: "trash" },
  { when: DIRTY_AT_HOME, unless: new RegExp(`${PARK_RESTROOM.source}|${TRASH_INDOORS.source}|${NOT_HOME.source}`), terms: ["apartment", "maintenance"], weight: 2, against: ["basket", "gutter", "sidewalk", "street"], categories: ["Tenants"] },
  // Trash inside a building is not a public litter basket ("trash in the lobby" got Litter
  // Basket once that article was recorded, 2026-11-08); a can, basket or bin said wins.
  { when: /\b(trash|garbage|litter|recycling|public) (cans?|baskets?|bins?)\b|\b(litter )?baskets?\b/, terms: ["basket"], weight: 3 },
  { when: /\b(lobby|hallways?|stairwells?|stairs|basement|laundry room|elevator|inside (my|the|our) building|in (my|the|our) building)\b/, unless: /\b(trash|garbage|litter|recycling|public) (cans?|baskets?|bins?)\b|\bbaskets?\b/, terms: [], against: ["basket"] },
  { when: /\b(dump|dumped|dumping|mattress|couch|sofa)\b/, terms: ["dump", "illegal"], weight: 3, categories: ["Cleaning"], family: "dumping" },
  { when: MISSED_COLLECTION, terms: ["collection", "missed"], weight: 3, categories: ["Collection & Disposal"], family: "collection" },
  // Homelessness
  { when: /\b(homeless|encampments?|tents?\b|unhoused|sleeping (on|in) the|living on the street|person sleeping|sin hogar|campamento)/, terms: ["homeless", "encampment", "outreach"], weight: 3, categories: ["Safety & Crime", "Homelessness"], family: "homeless" },
  // Graffiti: the City's Graffiti article (KA-02070), not a building repair. Beta test 2026-11-08.
  { when: /\b(graffiti|grafitti|graffitti|grafiti)\b/, terms: ["graffiti"], weight: 3, categories: ["Sidewalks", "Streets & Highways"], family: "graffiti" },
  // Grills: the City's Barbecuing article (KA-02228), the closest the City has to grill smoke;
  // its non-emergency smoke route is for chimneys and vents only. Beta test 2026-11-08.
  { when: /\b(grill|grills|grilling|bbq|barbe?cu\w*|barbequ\w*|hibachi)\b/, terms: ["barbecuing"], weight: 3, categories: ["Parks & Recreation", "Air"], family: "barbecue" },
  // Parks: a park is a place, not a home, so a park's own report option wins (rats in a park
  // go to Parks, not to HPD's at-home form). "Park" alone, never "parking" or "parked".
  { when: /\b(parks?|playgrounds?|greenway|ball ?fields?)\b/, terms: ["park"], weight: 2, categories: ["Parks & Recreation"] },
  { when: /\b(bench|benches|swings?|slides?|see-?saws?|jungle gym|monkey bars|water fountains?|drinking fountains?|(basketball|handball|tennis) (court|hoop)s?)\b/, terms: ["park", "maintenance"], weight: 3, categories: ["Parks & Recreation"], family: "park_maintenance" },
  { when: PARK_RESTROOM, terms: ["park", "maintenance"], weight: 3, against: ["apartment", "residential", "meter", "garage", "illegal"], categories: ["Parks & Recreation"], family: "park_maintenance" },
  // Illness from food: the City's Food Poisoning article (KA-02051). Beta retest 2026-11-08.
  { when: /\bfood poisoning\b|\bintoxicaci[oó]n alimentaria\b|\b(sick|ill|vomit\w*|threw up|throwing up)\b[^.]{0,40}\b(ate|eating|food|meal|restaurant|takeout)\b|\b(ate|eating)\b[^.]{0,40}\b(sick|ill|vomit\w*|threw up|throwing up)\b/, terms: ["food", "poisoning", "illness"], weight: 3, against: ["noise"], categories: ["Public Health"], family: "food_illness" },
  // Records
  { when: /\bbirth certificate|acta de nacimiento/, terms: ["birth", "certificate", "order"], weight: 3, categories: ["Public Health", "Birth & Adoption"], family: "records" },
  // Crime that is not happening now (danger is handled in emergency.ts)
  { when: /\b(report a crime|crime|criminal|police report|denunciar)\b/, terms: ["crime", "tip"], weight: 3, categories: ["Safety & Crime"], family: "crime" },
];

type Query = {
  terms: Map<string, number>;
  /** Kinds of place the description names (PLACES), to pick an article's report option for that place. */
  places: string[];
  /** The normalized description, for place checks only; never returned. */
  text: string;
  against: Set<string>;
  /**
   * Where each weighted word came from: the word list entries (CONCEPTS index, "c3") or danger
   * kinds ("d:gas") that added it. One entry's words are one piece of evidence, however many
   * of them an article shares (strongEvidence).
   */
  sources: Map<string, Set<string>>;
  /** The sources that name a problem (an entry with a family, or a danger), not just context. */
  problemSources: Set<string>;
  categories: string[];
  matched: string[];
  families: string[];
  spanish: boolean;
  danger: DangerAssessment;
  corrected: string[];
};

/** The description as weighted search words. The description itself is not kept. */
export function parseQuery(description: string): Query {
  const fixed = correctTypos(normalize(description));
  const text = fixed.text;
  // Danger is read from the person's own words, never the typo-corrected ones: a fix such
  // as "sparking" → "parking" must not be able to hide a 911 line (review, 2026-11-08).
  const danger = assessDanger(normalize(description));
  const terms = new Map<string, number>();
  const against = new Set<string>();
  const categories: string[] = [];
  const matched: string[] = [];
  const families: string[] = [];
  let spanish = false;
  const sources = new Map<string, Set<string>>();
  const problemSources = new Set<string>();
  const add = (t: string, w: number, from?: string) => {
    const k = stem(t);
    terms.set(k, Math.max(terms.get(k) ?? 0, w));
    if (from) sources.set(k, (sources.get(k) ?? new Set()).add(from));
  };
  for (const [i, c] of CONCEPTS.entries()) {
    const m = text.match(c.when);
    if (!m || (c.unless && c.unless.test(text)) || (c.onlyIf && !c.onlyIf(text))) continue;
    matched.push(m[0].trim());
    const from = `c${i}`;
    if (c.family) problemSources.add(from);
    for (const t of c.terms) add(t, c.weight ?? 2, from);
    for (const t of c.against ?? []) against.add(stem(t));
    for (const cat of c.categories ?? []) if (!categories.includes(cat)) categories.push(cat);
    if (c.family && !families.includes(c.family)) families.push(c.family);
    if (c.spanish) spanish = true;
  }
  // A danger adds its words and always searches Safety & Crime, where the City's "Call 911" articles are.
  const dv = danger.kinds.some((k) => k.id === "domestic_violence");
  for (const k of danger.kinds) {
    // Domestic violence: the City's own Domestic Violence article, not the general danger one.
    problemSources.add(`d:${k.id}`);
    if (!(dv && k.id === "crime")) for (const t of k.terms) add(t, 3, `d:${k.id}`);
    if (!categories.includes("Safety & Crime")) categories.unshift("Safety & Crime");
    matched.push(...danger.suggested_by);
  }
  for (const w of words(text)) if (!STOP.has(w) && w.length > 2) add(w, 1);
  for (const t of terms.keys()) if (against.has(t)) against.delete(t);
  spanish = spanish || SPANISH.test(text);
  const places = PLACES.filter((x) => x.said.test(text)).map((x) => x.id);
  return { terms, against, sources, problemSources, categories, matched: [...new Set(matched)], families, spanish, danger, corrected: fixed.corrected, places, text };
}

/**
 * Places an article's report options are split by (KA-01107 Rat or Mouse Complaint has
 * Residential Property, Sidewalk or Street, Parks, School, ...; KA-02070 Graffiti has
 * Park, Highway). When the person names one, the option for that place wins; a public
 * place never gets the at-home option. Beta test 2026-11-08: "rats in the park" got HPD.
 */
export const PLACES: { id: string; said: RegExp; option: RegExp; isPublic: boolean; venue?: true }[] = [
  { id: "park", said: /\b(parks?|playgrounds?|greenway|ball ?fields?|beach(es)?)\b/, option: /\b(parks?|beach)\b/i, isPublic: true, venue: true },
  { id: "street", said: /\b(sidewalk|curb|tree bed|on the street|in the street|acera)\b/, option: /\bsidewalk\b|\bstreet\b(?! food)/i, isPublic: true },
  { id: "school", said: /\bschool\b/, option: /\bschool\b/i, isPublic: true, venue: true },
  { id: "highway", said: /\b(highway|expressway)\b/, option: /\bhighway\b/i, isPublic: true, venue: true },
  { id: "food", said: /\b(restaurant|deli|bodega|cafe|bakery|food (cart|truck|vendor)|street vendor)\b/, option: /\b(food|restaurant|vendor)\b/i, isPublic: true },
  { id: "vacant", said: /\bvacant (lot|building)\b|\bempty lot\b/, option: /\bvacant\b/i, isPublic: true },
  { id: "home", said: /\b(apartment|my (home|house|unit|room|kitchen|bathroom|bedroom|basement|yard)|in my building|apartamento)\b/, option: /\b(apartment|residential)\b/i, isPublic: false },
];

const SPANISH = /[áéíóúñ¿¡]|\b(ruido|vecin[oa]s?|calefaccion|basura|baches?|cucarachas|apartamento|edificio|hay|muy|los|del|tengo|necesito)\b/;

/**
 * A description with more than one problem, split into one description per kind of
 * problem ("no hot water and the elevator is broken" → the hot water, the elevator).
 * Parts with no kind of their own ("my building", "the landlord won't fix it") go with
 * each. Returns one part when there is only one kind.
 */
export function splitProblems(description: string): string[] {
  const parts = normalize(description).split(/\s*(?:,|;|\band also\b|\balso\b|\bplus\b|\band\b|\by también\b|\by\b)\s*/).filter((x) => x.length > 1);
  if (parts.length < 2) return [description];
  const fam = parts.map((p) => parseQuery(p).families);
  const kinds = [...new Set(fam.flat())];
  if (kinds.length < 2) return [description];
  const context = parts.filter((_, i) => fam[i].length === 0).join(" ");
  const out: string[] = [];
  for (const k of kinds) {
    const own = parts.filter((_, i) => fam[i][0] === k);
    if (own.length) out.push([...own, context].filter(Boolean).join(" "));
  }
  return out.length > 1 ? out.slice(0, 3) : [description];
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
  if (call911) score += q.danger.kinds.length ? 6 : -3;
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

/**
 * Enough of the person's own problem words in the article's title or summary to call it
 * strong. Problem words are the word list's (weight 2 or more), not every word of the description.
 *
 * Evidence is counted per word-list entry, not per word (beta retest 6, 2026-11-09). One entry's
 * words are one thing the person said: "dirty" adds dirty, litter and trash, and an article
 * sharing two of them (Litter Basket Complaint) was rated strong for "bathroom in my house is
 * dirty". And the evidence must include the problem itself (an entry with a family, or a
 * danger): context alone (a vehicle, a building, a street) is never strong. "landlord didn't
 * install a carbon monoxide detector" was rated strong for Vehicle Stored on Residential
 * Property on "car" (inside "carbon") plus "residential" (from "landlord").
 *
 * Strong, then, is two entries that include a problem, or one problem entry whose words few
 * titles in the pool share. One entry whose words several titles share ("construction" in
 * Buildings & Property) is never strong (beta retest 3: the Construction Site No Smoking Sign
 * article was rated strong for 6am jackhammering), unless it names the article: more than half
 * of the article title's own words are the person's, and the article beats every other title
 * with that word by 3 points or more. Beta retest 4: "no heat in my apartment" (Heat or Hot
 * Water Complaint in a Residential Building) and "illegal fireworks every night" (Fireworks
 * Complaint) had dropped to "close call".
 */
export function strongEvidence(q: Query, best: ArticleSummary, pool: ArticleSummary[], scores?: Map<string, number>): boolean {
  const title = stems(best.title);
  const desc = stems(best.description);
  const own = [...q.terms].filter(([t, w]) => w >= 2 && (title.has(t) || desc.has(t))).map(([t]) => t);
  if (own.length === 0) return false;
  const units = new Set(own.flatMap((t) => [...(q.sources.get(t) ?? [])]));
  if (![...units].some((u) => q.problemSources.has(u))) return false;
  if (units.size >= 2) return true;
  const rivals = pool.filter((a) => a.ka_number !== best.ka_number && own.some((t) => stems(a.title).has(t)));
  if (rivals.length <= 1) return true;
  if (!scores || !own.some((t) => title.has(t))) return false;
  const named = [...title].filter((t) => !GENERIC_TITLE.has(t));
  const mine = named.filter((t) => q.terms.has(t)).length;
  if (mine * 2 <= named.length) return false;
  const s1 = scores.get(best.ka_number) ?? 0;
  const s2 = Math.max(0, ...rivals.map((a) => scores.get(a.ka_number) ?? 0));
  return s1 - s2 >= 3;
}
/** Title words that say what kind of page it is, not what the problem is. */
const GENERIC_TITLE = new Set(["complaint", "report", "request"].map(stem));

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
  const out = scored.map((x) => x.c);
  if (q.danger.kinds.length) {
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
const AGENCY_IN_TEXT = /\b((?:Department|Office|Administration|Commission|Police Department|Fire Department) (?:of |for )?[A-Z][A-Za-z&'’ ]+?)\s\(([A-Z]{2,6})\)/g;

/**
 * Agencies an article's own text names, as "Name (ACRONYM)". A possessive is not part of
 * the name: "the Department of Housing Preservation and Development's (HPD) ..." is the
 * Department of Housing Preservation and Development (HPD). Beta retest 5, 2026-11-09:
 * the Carbon Monoxide article's agency carried the stray "'s".
 */
export function agenciesNamedIn(text: string): string[] {
  return [...new Set([...text.matchAll(AGENCY_IN_TEXT)].map((m) => `${m[1].trim().replace(/['’]s?$/, "")} (${m[2]})`))];
}

function scoreAction(q: Query, x: ContentAction, section: string, ignore: Set<string>): number {
  const s = stems(`${x.name ?? ""} ${x.problem_detail ?? ""} ${section}`);
  let n = 0;
  for (const [t, w] of q.terms) if (s.has(t) && !ignore.has(t)) n += w;
  // The place the person named decides between options split by place (PLACES).
  const where = `${x.name ?? ""} ${section}`;
  const said = PLACES.filter((p) => q.places.includes(p.id));
  const commonArea = /\bpublic area\b/i.test(where) && !/\b(hallway|lobby|stairs?|stairwell|public area|common area|basement|laundry)\b/.test(q.text);
  // "Street" is weaker: it is in many option names ("City Vehicle Parked on the Sidewalk").
  const hit = said.filter((p) => p.option.test(where));
  if (hit.length) n += commonArea || hit.every((p) => p.id === "street") ? 3 : 6;
  else if (said.length && said.every((p) => p.isPublic) && PLACES.find((p) => p.id === "home")!.option.test(where)) n -= 3;
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

/** When 311 lists no single agency (beta retest 3, 2026-11-09: the field was blank). */
export const AGENCY_NOT_LISTED = "agency not listed by 311";
export const AGENCY_DEPENDS = "depends on which report option fits; see agencies";

/**
 * The agency, never blank. From the report option 311 lists; for an article with no report
 * option, the one agency its own text names ("The Department of Transportation (DOT)
 * maintains ..."); else one of the two plain lines above. agency_source says which.
 */
function agencyOf(fromAction: string | null, actionCount: number, text: string): { agency: string; agency_source: string } {
  if (fromAction) return { agency: fromAction, agency_source: "report option" };
  if (actionCount) return { agency: AGENCY_DEPENDS, agency_source: "the article's report options go to more than one agency or place" };
  const named = agenciesNamedIn(text);
  if (named.length === 1) return { agency: named[0], agency_source: "named in the article's text; 311 lists no report option for it" };
  return { agency: AGENCY_NOT_LISTED, agency_source: "311 lists no report option for this article" };
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
  // A report option for a venue the person did not name (Barbecuing's only option is for a
  // park or beach; a neighbor's grill is not in one) is never picked, and the answer says
  // so (beta test 2026-11-08). Venues only: a park, school or highway, not "street".
  const elsewhere = (x: (typeof actions)[number]) => {
    const where = `${x.name ?? ""} ${x.section}`;
    return PLACES.some((p) => p.venue && p.option.test(where) && !q.places.includes(p.id));
  };
  let otherPlace: string | null = null;
  if (!best && distinct === 1) best = actions[0];
  if (best && elsewhere(best)) {
    if (distinct === 1) otherPlace = best.name ?? best.section;
    best = null;
  }
  const bestSection = best ? a.sections.find((s) => s.name === best!.section) : null;
  // No report option picked: the section whose name shares the person's words, if any
  // (Graffiti's "USPS Mailbox" section has no report option, only what to do).
  let matchedSection: { name: string; says: string } | null = null;
  if (!best) {
    let top = 0;
    for (const sec of a.sections) {
      if (/^911\b/.test(sec.name)) continue;
      const sw = stems(sec.name);
      let n = 0;
      for (const [t, w] of q.terms) if (sw.has(t) && !titleWords.has(t)) n += w;
      if (n > top) {
        top = n;
        matchedSection = { name: sec.name, says: sentences(sec.text).slice(0, 3).join(" ") };
      }
    }
  }
  const all = a.sections.map((s) => s.text).join("\n");
  const problems = [...new Set(actions.map((x) => x.problem).filter((p): p is string => Boolean(p)))];
  const agencies = [...new Set(actions.map((x) => x.agency).filter((p): p is string => Boolean(p)))];
  const named = agenciesNamedIn(all).slice(0, 4);
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
    ...agencyOf(best?.agency ?? (agencies.length === 1 && !otherPlace ? agencies[0] : null), actions.length, all),
    problem_type: best?.problem ?? null,
    problem_detail: best?.problem_detail ?? null,
    best_action: best ? { section: best.section, name: best.name } : null,
    problem_types: problems,
    agencies,
    ...(actions.length ? {} : { agencies_named_in_text: named, no_reportable_action: "The article lists no report option with an agency and problem type. Follow what its text says." }),
    ...(actions.length && !best
      ? {
          no_best_action: otherPlace
            ? `This is the closest 311 article, but not an exact match: its only report option is "${otherPlace}", for a place your words did not name. Read the article to see whether the City takes this report.`
            : "The article's report options go to different agencies or problem types, and your words did not pick one. They are all in report_actions.",
        }
      : {}),
    ...(otherPlace ? { exact_match: false as const } : {}),
    ...(matchedSection ? { matched_section: matchedSection } : {}),
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
 * From portal.311.nyc.gov/about-nyc-311/, read 2026-11-07, word for word:
 *   "We’re here to answer your call 24 hours a day, 7 days a week, 365 days a year.
 *    Call 311 or 212-NEW-YORK (212-639-9675) to connect with us: Outside of New York
 *    City / Using a Voice over Internet Protocol (VoIP) provider / Using 711 or a
 *    teletypewriter (TTY) service / Using a Video Relay Service (VRS)"
 *   "Send a text to 311-692 24 hours a day, 7 days a week, 365 days a year. Message and
 *    data rates may apply."
 *   "Download the NYC311 App: File and track service requests on the go using your
 *    smartphone or tablet." (Android and Apple store links on the same page)
 *   "NYC311 speaks your language! Our call center can help you in over 175 languages and
 *    dialects when you ask to speak to an interpreter. Our website can be translated into
 *    more than 100 languages using the menu at the top right corner of each page."
 * Online reporting is on each article's page.
 */
const ABOUT = "https://portal.311.nyc.gov/about-nyc-311/";
export const LANGUAGE_HELP = {
  says: "NYC311 speaks your language! Our call center can help you in over 175 languages and dialects when you ask to speak to an interpreter. Our website can be translated into more than 100 languages using the menu at the top right corner of each page.",
  source: `quote of ${ABOUT}`,
};
export const REACH_311 = {
  source: ABOUT,
  checked: "2026-11-07",
  ways: [
    { method: "311 Online", how: "Open the article's page (portal_url) and use its report option.", url: `${PORTAL}/`, source: "BetaNYC wording" },
    {
      method: "NYC311 app",
      how: "File and track service requests on the go using your smartphone or tablet.",
      android: "https://play.google.com/store/apps/details?id=gov.nyc.doitt.ThreeOneOne",
      apple: "https://apps.apple.com/us/app/nyc-311/id324897619",
      source: `quote of ${ABOUT}`,
    },
    {
      method: "phone",
      how: "Call 311, or 212-NEW-YORK (212-639-9675) from outside New York City, with a VoIP provider, or with 711, TTY, or a Video Relay Service. Answered 24 hours a day, 7 days a week, 365 days a year.",
      source: `paraphrase of ${ABOUT}`,
    },
    { method: "text", how: "Send a text to 311-692 24 hours a day, 7 days a week, 365 days a year. Message and data rates may apply.", source: `quote of ${ABOUT}` },
    { method: "language help", how: LANGUAGE_HELP.says, source: LANGUAGE_HELP.source },
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

export const CATEGORIES_SHAPE = { category_id: z.string().regex(CATEGORY_ID).optional(), offset: z.number().int().min(0).optional() };
/** Articles per page in list_311_categories (beta test 2026-11-08: one category was 11.5k characters). */
export const ARTICLE_PAGE = 20;

const oldest = (xs: Fetched<unknown>[]) => xs.map((x) => x.fetched_at).sort()[0] ?? null;

type OneMatch = {
  routed: Category[];
  articlesScored: number;
  pool: ArticleSummary[];
  best: Match | null;
  alternatives: Alternative[];
  unreadable: string | null;
};

/** One description against 311's articles: route, score, read the best in full. */
async function matchOne(q: Query, client: ContentClient, cats: Category[], used: Fetched<unknown>[], categoryId: string | undefined, limit: number): Promise<OneMatch> {
  let routed: Category[];
  if (categoryId) {
    const c = cats.find((x) => x.id === categoryId);
    if (!c) throw new Error(`311 has no category ${categoryId}. list_311_categories lists them.`);
    routed = [c];
  } else {
    routed = routeCategories(q, cats);
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
  const top = ranked.slice(0, limit);
  const s1 = top[0]?.score ?? 0;
  const s2 = top[1]?.score ?? 0;
  // Only the best match is read in full (one GetContent request); the others are
  // listed from their summaries, which keeps a question to a few requests.
  let best: Match | null = null;
  const alternatives: Alternative[] = [];
  let unreadable: string | null = null;
  for (const [i, x] of top.entries()) {
    if (i === 0) {
      try {
        const art = await client.article(x.a.ka_number);
        used.push(art);
        const conf =
          s1 >= 9 && s1 - s2 >= 2 && strongEvidence(q, x.a, ranked.map((r) => r.a), new Map(ranked.map((r) => [r.a.ka_number, r.score])))
            ? "strong: the best fit by a clear margin"
            : s1 >= 9
              ? "close call: the next match scored nearly as well; read both"
              : "possible: few of your words matched; check the article";
        best = describeArticle(q, art.value, 1, x.score, x.hits, conf, x.cats, art);
        continue;
      } catch (err) {
        if (!(err instanceof NotFoundError)) throw err;
        unreadable = `${x.a.ka_number} is listed in its category but the API returned no article for it.`;
      }
    }
    alternatives.push({ rank: i + 1, title: x.a.title, ka_number: x.a.ka_number, portal_url: articleUrl(x.a.ka_number), summary: x.a.description, score: x.score, matched_words: x.hits, found_in_categories: x.cats });
  }
  return { routed, articlesScored: pool.size, pool: [...pool.values()].map((x) => x.a), best, alternatives, unreadable };
}

/** The New York calendar date of an ISO timestamp (its UTC date runs a day ahead every evening). */
function nycDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso));
}

function matchLine(m: Match): string {
  return (
    `Best match: "${m.title}" (${m.ka_number})` +
    (m.agency_source === "report option" ? `, handled by the ${m.agency}` : "") +
    (m.problem_type ? `, 311 problem type "${m.problem_type}"` : "") +
    `. Confidence ${m.confidence.split(":")[0]}. Article text as of ${nycDate(m.article_fetched_at)}.`
  );
}

/** Every error from these tools starts with the safety line (QA round 2 on #23). */
async function safely<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message.startsWith(SAFETY_LINE) ? message : `${SAFETY_LINE} ${message}`);
  }
}

export function howToReport(args: z.infer<z.ZodObject<typeof HOW_SHAPE>>, client: ContentClient = contentClient(), data: BoardStatData = boardstatData()) {
  return safely(() => howToReportInner(args, client, data));
}

async function howToReportInner(args: z.infer<z.ZodObject<typeof HOW_SHAPE>>, client: ContentClient, data: BoardStatData) {
  if (args.community_district !== undefined && args.council_district !== undefined) throw new Error("Give community_district or council_district, not both.");
  if (args.last_days !== undefined && args.community_district === undefined && args.council_district === undefined) {
    throw new Error("last_days counts reports in a district; give community_district or council_district with it.");
  }
  const q = parseQuery(args.description);
  const used: Fetched<unknown>[] = [];
  let cats: Fetched<Category[]>;
  try {
    cats = await client.categories();
  } catch (err) {
    // A danger is answered without 311's content: the City's own 911 line is built in.
    if (q.danger.kinds.length) return offlineDanger(q, err);
    throw err;
  }
  used.push(cats);
  const limit = args.limit ?? 3;

  // More than one problem: one match per problem (the first is the main answer).
  const parts = args.category_id ? [args.description] : splitProblems(args.description);
  const mainQ = parts.length > 1 ? withDanger(parseQuery(parts[0]), q) : q;
  const main = await matchOne(mainQ, client, cats.value, used, args.category_id, limit);
  const others: { for_words: string[]; best_match: Match | null; alternatives: Alternative[] }[] = [];
  for (const part of parts.slice(1)) {
    const pq = parseQuery(part);
    const m = await matchOne(pq, client, cats.value, used, undefined, 2);
    if (m.best && m.best.ka_number === main.best?.ka_number) continue;
    others.push({ for_words: pq.matched, best_match: m.best, alternatives: m.alternatives });
  }

  const lead = main.best;
  const alternatives = main.alternatives;
  // Safety first (QA round 1 on #23): a danger leads with 911, quoting the City only
  // when the City article is the danger detected; every answer carries SAFETY_LINE.
  const atHand = [...main.pool];
  const noMatch = !lead && !alternatives.length;
  const emergency = emergencyLead(q.danger, atHand, { noMatch });
  let first_line: string;
  if (emergency) {
    first_line = emergency.call_911;
  } else if (lead && /^call 911\b/i.test(lead.summary) && lead.confidence.startsWith("strong")) {
    first_line = lead.summary; // the matched article itself says to call 911 (e.g. "Drug Sale")
  } else if (lead) {
    first_line = matchLine(lead);
  } else if (alternatives.length) {
    first_line = `Possible match: "${alternatives[0].title}" (${alternatives[0].ka_number}). Its details could not be read; open the link.`;
  } else {
    // Every no-match answer leads with 911: the description may be an emergency the keywords missed.
    first_line = GENERIC_911;
  }

  const searchWords = [...q.terms.entries()].filter(([, w]) => w > 1).map(([t]) => t).slice(0, 6);
  const no_match = !noMatch
    ? null
    : {
        message: "No 311 article matched this description well enough to suggest one. Try other words, browse with list_311_categories, or search 311 Online.",
        portal_search_url: `${PORTAL}/search/?q=${encodeURIComponent(searchWords.join(" ") || "report a problem")}`,
        portal_search_note: "The search link carries the matched words, not your description, so no address goes into the link.",
      };

  const crimeAsked = q.danger.past_crime || q.danger.kinds.some((k) => k.id === "crime") || CRIME_WORDS.test(normalize(args.description));

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
    safety_line: SAFETY_LINE,
    safety_line_source: SAFETY_LINE_SOURCE,
    assistant_instruction: ASSISTANT_INSTRUCTION,
    first_line,
    emergency,
    best_match: lead,
    alternatives,
    ...(others.length ? { other_problems: others, other_problems_note: "Your description names more than one problem; each is matched on its own. Report each one separately." } : {}),
    ...(main.unreadable ? { note: main.unreadable } : {}),
    no_match,
    ...(crimeAsked ? { crime: CRIME_POINTER } : {}),
    ...(q.spanish ? { language_help: LANGUAGE_HELP } : {}),
    ...(q.corrected.length ? { spelling_corrected: q.corrected } : {}),
    how_to_reach_311: REACH_311,
    not_filed: NOT_FILED,
    ...(args.borough ? { borough: args.borough, borough_note: "311's articles apply citywide; the borough does not change the match. Give it when you report." } : {}),
    in_your_district,
    searched: {
      categories: main.routed.map((c) => ({ id: c.id, name: c.name })),
      articles_scored: main.articlesScored,
      words_recognized: q.matched,
    },
    source: {
      name: "NYC 311 Public API, content operations (GetCategory, GetContentList, GetContent): the articles on 311 Online",
      url: "https://api-portal.nyc.gov/api-details#api=nyc-311-public-api",
      fetched_at: oldest(used),
      ...(lead ? { best_match_article_as_of: lead.article_fetched_at } : {}),
    },
    caveats: [
      "The match is made by BetaNYC from keywords, not by the City. Read the article before you report.",
      lead ? `The article's text is as of ${lead.article_fetched_at}. 311 articles change with the season (for example, when DSNY takes snow complaints); the link shows the current page.` : null,
      "The 311 problem type is the one the article names. NYC Open Data calls it complaint_type and sometimes writes it in capitals (\"HEAT/HOT WATER\"). Some articles name an agency but no problem type.",
      `Only the categories listed under searched were read. If the match looks wrong, list_311_categories shows the rest, and category_id searches one of them.`,
      NOT_FILED,
    ].filter((x): x is string => Boolean(x)),
    ...(stale.length ? { stale: true as const, warning: stale[0].warning } : {}),
  };
  return redactAll(out);
}

/** A danger when 311's content cannot be read: the City's built-in 911 line, and why it is built in. */
function offlineDanger(q: Query, err: unknown) {
  const emergency = emergencyLead(q.danger, BUILT_IN_911)!;
  if (emergency.ka_number) emergency.source += ` (the City's words, built into this server as read ${BUILT_IN_911_READ}, because 311's content could not be reached just now)`;
  return redactAll({
    safety_line: SAFETY_LINE,
    safety_line_source: SAFETY_LINE_SOURCE,
    assistant_instruction: ASSISTANT_INSTRUCTION,
    first_line: emergency.call_911,
    emergency,
    best_match: null,
    alternatives: [],
    no_match: null,
    content_unavailable: `311's articles could not be reached, so only the safety answer is given. ${err instanceof Error ? err.message : String(err)}`,
    how_to_reach_311: REACH_311,
    not_filed: NOT_FILED,
    caveats: ["Danger detection here is keyword-based. Call 911 first if anyone may be in danger.", NOT_FILED],
    source: { name: `The City's 911 lines from 311's articles, built into this server (read ${BUILT_IN_911_READ})`, url: PORTAL, fetched_at: null as string | null },
    stale: undefined as true | undefined,
    warning: undefined as string | undefined,
  });
}

/** A part of a split description keeps the whole description's danger reading. */
function withDanger(part: Query, whole: Query): Query {
  return { ...part, danger: whole.danger, terms: new Map([...part.terms, ...[...whole.terms].filter(([t]) => whole.danger.kinds.some((k) => k.terms.map(stem).includes(t)))]) };
}

export function list311Categories(args: z.infer<z.ZodObject<typeof CATEGORIES_SHAPE>>, client: ContentClient = contentClient()) {
  return safely(() => list311CategoriesInner(args, client));
}

const SAFETY_FIELDS = { safety_line: SAFETY_LINE, assistant_instruction: ASSISTANT_INSTRUCTION } as const;

async function list311CategoriesInner(args: z.infer<z.ZodObject<typeof CATEGORIES_SHAPE>>, client: ContentClient) {
  const cats = await client.categories();
  const kids = (id: string | null) => cats.value.filter((c) => c.parent_id === id);
  const source = { name: "NYC 311 Public API, GetCategory and GetContentList", url: "https://api-portal.nyc.gov/api-details#api=nyc-311-public-api" };
  const node = (c: Category): Record<string, unknown> => {
    const children = kids(c.id);
    return { id: c.id, name: c.name, description: c.description, portal_url: c.url, ...(children.length ? { subcategories: children.map(node) } : { has_articles: c.id !== "311-19" }) };
  };
  if (!args.category_id) {
    // A summary (beta test 2026-11-08: the whole tree was 33k characters): each top category
    // with its description, and its subcategories by id and name only.
    // Subcategories as "id name" text, a level down written "id name (id name; ...)".
    const brief = (c: Category): string => {
      const children = kids(c.id);
      return `${c.id} ${c.name}${children.length ? ` (${children.map(brief).join("; ")})` : ""}`;
    };
    return redactAll({
      ...SAFETY_FIELDS,
      categories: kids(null).map((c) => ({ id: c.id, name: c.name, description: c.description, ...(kids(c.id).length ? { subcategories: kids(c.id).map(brief) } : {}) })),
      count: cats.value.length,
      more: "This is a summary. Give a category_id: a category with subcategories lists them with their descriptions; one with none lists its articles, 20 at a time.",
      note: "Only categories with no subcategories hold articles. Give one as category_id here to list its articles, or to how_to_report to search only it. \"A to Z\" (311-19) returns no articles through the API.",
      source: { ...source, fetched_at: cats.fetched_at },
      ...(cats.stale ? { stale: true as const, warning: cats.warning } : {}),
    });
  }
  const c = cats.value.find((x) => x.id === args.category_id);
  if (!c) throw new Error(`311 has no category ${args.category_id}. Call list_311_categories with no category_id to see them.`);
  const children = kids(c.id);
  if (children.length) {
    return redactAll({ ...SAFETY_FIELDS, category: node(c), note: "This category has subcategories; articles are in the ones with no subcategories.", source: { ...source, fetched_at: cats.fetched_at } });
  }
  const list = await client.articleList(c.id);
  const offset = args.offset ?? 0;
  const page = list.value.slice(offset, offset + ARTICLE_PAGE);
  const next = offset + ARTICLE_PAGE < list.value.length ? offset + ARTICLE_PAGE : null;
  return redactAll({
    ...SAFETY_FIELDS,
    category: { id: c.id, name: c.name, description: c.description, portal_url: c.url },
    articles: page.map((a) => ({ ka_number: a.ka_number, title: a.title, summary: a.description, portal_url: articleUrl(a.ka_number) })),
    count: list.value.length,
    showing: !list.value.length
      ? "none"
      : page.length
        ? `${offset + 1} to ${offset + page.length} of ${list.value.length}`
        : pastTheEnd(offset, list.value.length),
    next_page: next === null ? null : { category_id: c.id, offset: next },
    source: { ...source, fetched_at: list.fetched_at },
    ...(list.stale || cats.stale ? { stale: true as const, warning: list.warning ?? cats.warning } : {}),
  });
}

/** Plain words for an offset past the last article (beta retest 1: "showing 42 to 500 of 42"). */
export function pastTheEnd(offset: number, count: number): string {
  const pages = Math.ceil(count / ARTICLE_PAGE);
  const offsets = Array.from({ length: pages }, (_, i) => i * ARTICLE_PAGE).join(", ");
  return `Offset ${offset} is past the end: there ${count === 1 ? "is 1 article" : `are ${count} articles`}, ${ARTICLE_PAGE} per page, so ${pages === 1 ? "1 page (offset 0)" : `pages 1 to ${pages} (offsets ${offsets})`}.`;
}

/** Every string redacted of ZIP codes (City article text carries mailing addresses), then checked. */
function redactAll<T>(value: T): T {
  const out = scrubZipValues(value);
  assertNoZip(out);
  return out;
}

// ─── tool definitions ────────────────────────────────────────────────────────

export const REPORT_TOOLS = [
  {
    name: "how_to_report",
    description:
      "Find how to report a problem to 311, from a plain description ('a pothole on my block', 'no heat in my apartment'). Returns the best 311 articles from the City's own 311 content (title, KA number, link on 311 Online), the agency and the 311 problem type each names (the problem type is NYC Open Data's complaint_type), what the article says to do and what happens next, and the ways to report (311 Online, the NYC311 app, phone 311 or 212-NEW-YORK, text 311-692), all from City text. Every answer starts with 'If anyone is in danger right now, call 911.'; a description that suggests danger, and every no-match answer, leads with a 911 line, in the City's words only when the City article is that danger. IMPORTANT: danger detection here is keyword-based and will miss some emergencies. If anything the person says suggests someone may be in danger or need urgent medical help, tell them to call 911 first, even if this tool did not flag it. Matching is by keyword, done by BetaNYC, and reads only a few 311 categories (listed in searched). Give community_district or council_district to add how often that problem type was reported there (BoardStat). Does not file anything.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        description: { type: "string", minLength: 3, maxLength: 500, description: "The problem in plain words. Not stored and not sent anywhere: only the 311 content is fetched." },
        borough: { type: "string", enum: [...BOROUGHS], description: "Optional. 311's articles are citywide, so this does not change the match; it is noted for the report." },
        ...DISTRICT_JSON,
        last_days: { type: "integer", minimum: 1, maximum: 3660, description: "With a district: count reports over the last N days of data (default 365)." },
        category_id: { type: "string", description: "Search only this 311 category (an id from list_311_categories, e.g. '311-12' for Noise)." },
        limit: { type: "integer", minimum: 1, maximum: 5, description: "How many articles to return (default 3)." },
      },
      required: ["description"],
    },
  },
  {
    name: "list_311_categories",
    description:
      "Browse 311's own topic categories (the ones on 311 Online), or, given a category_id, the articles in it with their KA numbers and links. Use it when how_to_report's match looks wrong, then pass the category_id to how_to_report. Danger detection in these tools is keyword-based and will miss some emergencies: if anything the person says suggests someone may be in danger or need urgent medical help, tell them to call 911 first.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        category_id: { type: "string", description: "A category id such as '311-12' (Noise). Leave out for a summary of all categories." },
        offset: { type: "integer", minimum: 0, description: "Articles to skip (20 per page); next_page.offset." },
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
