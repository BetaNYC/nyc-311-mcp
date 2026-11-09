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
import { ASSISTANT_INSTRUCTION, BUILT_IN_911, BUILT_IN_911_READ, PAST, RECURRING, assessDanger, CRIME_POINTER, CRIME_WORDS, emergencyLead, GENERIC_911, normalize, SAFETY_LINE, SAFETY_LINE_SOURCE, type DangerAssessment } from "./emergency.js";

// ─── words ────────────────────────────────────────────────────────────────────

const STOP = new Set(
  "a an the my our your his her their its on in at of to is are was were and or for from there here it this that these those me i we you he she they has have had been be by with as am pm all some any very just really so too about into onto over under up down out off again won't wont can't cant don't dont isn't not no yes what when where who how why which while because since every each would could should will can do does did get got keep keeps kept still now today tonight night day week weeks month months year years ago one two three four five lot lots el la los las de del en mi mis un una muy hay y que es por con".split(
    " "
  )
);
const IRREGULAR: Record<string, string> = { mice: "mouse", neighbour: "neighbor", neighbours: "neighbor", mould: "mold", children: "child", people: "person", geese: "goose", buses: "bus", busses: "bus", parking: "parking", parked: "parked", parks: "park", blocked: "blocked", blocking: "blocked", blocks: "block" };

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
  /**
   * The terms are other words for one thing ("dirty", "litter", "trash"), so an article sharing
   * several of them has still matched one thing the person said (strongEvidence). Without this,
   * each term is its own facet of the problem ("missed" + "collection"), and an article sharing
   * several facets matches more of what was said.
   */
  synonyms?: true;
};

// A pickup that did not happen: the City's Missed Trash, Recycling, or Compost Collection
// article (KA-01788), not a litter basket. Beta retest 2026-11-08: "sanitation skipped our
// garbage pickup" got Litter Basket Complaint.
const MISSED_COLLECTION = /\b(nobody|no one|sanitation|they|dsny) (never )?(collected|picked up|took)\b[^.]{0,20}\b(trash|garbage|recycling|compost|bins?|bags?)\b|\b(trash|garbage|recycling|compost)( bins?| bags?)? (was |were )?(not|never) (collected|picked up)\b|\b(trash|garbage|recycling|compost|bulk\w*|furniture|mattress\w*|sanitation|dsny)\b[^.]{0,20}\b(pick ?-?ups?|collections?)\b[^.]{0,20}\b(never (happened|came|showed)|didn'?t (happen|come|show)|was missed|got missed|was skipped)\b|\b(skipped|missed|didn'?t (come|pick)|never (came|picked)|forgot)\b[^.]{0,40}\b(pick ?-?ups?|collections?|garbage|trash|recycling|compost)\b|\b(not|never|wasn'?t|weren'?t) (been )?(picked up|collected)\b|\bno recogieron\b/;
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
const NO_WATER = /\bwater pressure\b[^.]{0,20}\b(dropped|drops|is low|went down|is weak|is gone|almost nothing)\b|\b(no|without|lost|losing) (running )?water\b|\bwater (is |was |has been |got )?(off|out|shut off|turned off)\b|\b(low|weak|no) water pressure\b|\bno hay agua\b/;
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

// Tree roots lifting a sidewalk, or bees in a tree: not a fallen tree.
const ROOTS_OR_BEES = /\b(tree )?roots?\b[^.]{0,40}\b(push\w*|lift\w*|rais\w*|crack\w*|break\w*|buckl\w*|heav\w*)\b|\b(bees?|wasps?|hornets?|yellow ?jackets?|beehives?|hives?)\b/;
/**
 * A highway: an expressway, an interstate, a ramp, or a parkway the City runs as one (Belt, Cross
 * Island, Grand Central, Jackie Robinson, Hutchinson River, Henry Hudson, Bronx River, Shore,
 * Korean War Veterans, ...). Eastern, Ocean, Pelham, Mosholu and other parkways are city streets
 * (beta retest 12: a pothole on Eastern Parkway was sent to the highway article and the draft
 * refused). "Parkway" alone is a street.
 */
export const HIGHWAY = /\b(highways?|expressways?|expwy|interstates?|i-\d+|exit ramps?|on-?ramps?|off-?ramps?|fdr( drive)?|bqe|lie|turnpike|thruway|(belt|cross island|grand central|jackie robinson|interborough|hutchinson river|hutch|henry hudson|bronx river|korean war veterans|shore|laurelton|southern state|northern state|taconic|sprain brook|saw mill( river)?|clearview|van wyck|whitestone|major deegan|sheridan|bruckner|cross bronx|gowanus|prospect|staten island|west shore|nassau) (parkway|pkwy|expressway|expwy|highway))\b/;
// A vehicle left for a long time, with no plates or flat tires: Abandoned Vehicle, not Illegal Parking.
const ABANDONED_VEHICLE = /\b(abandoned(?! (a |the )?(shopping )?carts?| (building|house|home|apartment|store|property|lot|church|school|factory)s?\b)|derelict(?! (building|house|property)s?\b)|junk car|no (license )?plates?|hasn'?t moved|not moved|been (sitting|there) for|been (sitting|parked|left|there)\b[^.]{0,30}\bfor (a |over a |more than a |two |three |several |many )?(weeks?|months?|years?)\b|flat tires?|missing (wheels?|tires?))/;
// A car's window smashed, a car broken into: damage to property, a crime that is usually over.
const VEHICLE_DAMAGE = /\b(smash\w*|broke|broken|shatter\w*|bust\w*|kick\w*|key(ed)?|scratch\w*|slash\w*)\b[^.]{0,40}\b(cars?|vehicles?|trucks?|vans?)\b|\b(cars?|vehicles?|trucks?|vans?)'?s? (windows?|windshields?|mirrors?|tires?)\b[^.]{0,20}\b(smash\w*|broken|shatter\w*|slash\w*)\b|\bbroke into (my|the|a|our) (car|vehicle|truck|van)\b/;
// A landlord locking a tenant out.
const LOCKOUT = /\b(padlock\w*|(turn|turned|shut|shutting|cut|cutting) off (my|our|the) (electricity|power|lights|gas|water|heat)[^.]{0,30}\b(to (force|get|make|push) (me|us|them)|so (i|we|they) (leave|move))|(removed|threw out|took|put out) (all )?(my|our) (belongings|stuff|things|furniture)|chang(ed|es|ing) the locks?|lock(ed|ing|s)? (me|us|them|my \w+|the tenants?) out|locked out of (my|our) (apartment|home|unit|room)|lockout|won'?t let (me|us) (back )?in(to)?\b|illegal(ly)? evict\w*|evicted (me|us) (without|with no)|threw (me|us|my (stuff|things|belongings)) out)\b/;
// Pests or dirt in a place that makes or sells food: Food Safety Complaint (KA-01111, "an
// unsanitary restaurant, deli, grocery, ..."). Stage 9 stress set: "a restaurant has rats in the
// kitchen" got Rat or Mouse Complaint, rated strong.
const FOOD_PLACE = "(restaurants?|delis?|bodegas?|grocer(y|ies)|supermarkets?|markets?|cafeterias?|bakery|bakeries|cafes?|pizzeria|food carts?|food trucks?|takeout|take-out)";
const FOOD_PLACE_PESTS = new RegExp(`\\b(rats?|mice|mouse|roach(es)?|cockroach(es)?|flies|bugs|vermin|pests?|hair|dirty|filthy|unsanitary|moldy|spoiled|rotten)\\b[^.]{0,40}\\b${FOOD_PLACE}\\b|\\b${FOOD_PLACE}\\b[^.]{0,40}\\b(rats?|mice|mouse|roach(es)?|cockroach(es)?|flies|bugs|vermin|pests?|hair|dirty|filthy|unsanitary|moldy|spoiled|rotten|expired|sells? expired|out of date)\\b`);
// A vehicle blocking a bike lane, crosswalk, bus stop or bus lane: Illegal Parking (KA-01986).
// An animal in or at the trash is the animal path (Wild Animal, Rat or Mouse), not litter (beta
// retest 14: "a raccoon is living in the trash cans behind my building" got Litter Basket).
const ANIMAL_IN_TRASH = /\b(raccoons?|possums?|opossums?|skunks?|rats?|mice|squirrels?|coyotes?|foxe?s?|stray (cats?|dogs?)|pigeons?|seagulls?)\b[^.]{0,40}\b(trash|garbage|cans?|bins?|bags?|dumpsters?)\b/;
const BIKE_LANE_BLOCKED = /\b(cars?|trucks?|vans?|vehicles?|someone|people|drivers?)\b[^.]{0,30}\b(block(s|ed|ing)?|park(s|ed|ing)? (in|on))\b[^.]{0,10}\b(the |a )?(crosswalks?|bus stops?|bus lanes?)\b|\b(park(ed|ing)|double[- ]?parked|block(s|ed|ing)?|stopp(ed|ing)|standing|idling|sitting)\b[^.]{0,40}\bbike lanes?\b|\bbike lanes?\b[^.]{0,30}\b(blocked|is blocked|full of (cars|trucks)|always blocked)\b|\b(cars?|trucks?|vans?|vehicles?|ubers?|taxis?|cabs?)\b[^.]{0,20}\bin (the |a |my )?bike lanes?\b/;
// The subway, an MTA bus or a station (not a gas, police or fire station).
const TRANSIT = /(?<!school |yellow |kid'?s |son'?s |daughter'?s )\b(my bus|the bus (never|didn'?t|was late|is late|skipped|is always late)|bus (never|didn'?t) (came|come|show\w*)|subways?|subway (station|stop|car|platform)s?|train stations?|mta|metrocard|omny|metro ?north|lirr|(the )?[a-z0-9] train|bus (driver|operator)s?|on the bus|select bus|express bus)\b/;
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
  { when: /\b(noise|noisy|loud|music|blasting|bass|yell(?!ow)|shout|scream|bang|pound|stomp|stereo|speakers?|tv\b|television|racket|barks?\b|barking|honk\w*|horns? (blar|honk)\w*|blaring|jingl\w*|howl\w*|yap\w*|whin(e|es|ing)\b|revv\w*|rev(s)? (their |the |its )?engines?|mufflers?|drum(s|ming)?\b|wakes? (me|us) up|keeps? (me|us) (up|awake)|can'?t sleep|hums? loud\w*)/, // A TV, a stereo or speakers left on the sidewalk is not noise (beta retest 12: "someone left a
    // broken TV on the sidewalk" got Noise from Street or Sidewalk, rated strong): those object
    // words count as noise only with a sound word.
    onlyIf: (t) => !/^[^.]*\b(tv|television|stereo|speakers?)\b/.test(t) || /\b(noise|noisy|loud|blast\w*|blaring|volume|hear|music|bass|all night|late|turned up|playing|plays|yell\w*|scream\w*|bang\w*|stomp\w*|bark\w*|shout\w*|racket|honk\w*|alarm|party|parties|drum\w*|jingl\w*|howl\w*|revv\w*|hum\w*|wakes?|can'?t sleep|keeps? (me|us) (up|awake))\b/.test(t),
    terms: ["noise"], categories: ["Noise"], family: "noise" },
  { when: /\bice cream (trucks?|vans?)\b/, terms: ["ice", "cream", "truck"], weight: 3, categories: ["Noise"] },
  { when: /\b(ruido|música alta|musica alta|fiesta|gritos)/, terms: ["noise"], categories: ["Noise"], family: "noise", spanish: true },
  // "Next door" is a neighbor unless what is next door is a business (beta.13 stress set: "the
  // boxing gym next door is loud" got Noise from Neighbor).
  { when: /\b(neighbou?rs?|next ?do?or|upstairs|downstairs|apartment (above|below)|across the hall|my building|the building|vecin[oa]s?)\b/, onlyIf: (t) => /\b(neighbou?rs?|upstairs|downstairs|apartment|across the hall|vecin[oa]s?)\b/.test(t) || !/\b(store|shop|bodega|deli|business|gym|studio|warehouse|factory|garage|auto shop|body shop|laundromat|car wash|salon|church|mosque|synagogue|temple|bar|club|restaurant|school|construction|site)\b/.test(t), terms: ["neighbor"], weight: 2 },
  { when: /\b(bar|bars|club|nightclub|lounge|restaurant)\b/, terms: ["bar", "club", "restaurant"], weight: 2, against: ["neighbor"] },
  { when: /\b(store|shop|bodega|deli|business|gym|studio|warehouse|factory|garage|auto shop|body shop|laundromat|car wash|salon|church|mosque|synagogue|temple)\b/, terms: ["store", "business"], weight: 1 },
  { when: /\b(sidewalk|on the street|in the street|outside|on my block|corner|acera|calle)\b/, terms: ["street", "sidewalk"], weight: 1 },
  // Whole words only: "carbon monoxide" is not a car (beta retest 6, 2026-11-09: "landlord didn't
  // install a carbon monoxide detector" got Vehicle Stored on Residential Property, rated strong).
  { when: /\b(car|cars|trucks?|vehicles?|motorcycles?|mopeds?|horns?|honk\w*|engines?|idling|carros?|coches?)\b/, terms: ["vehicle"], weight: 2 },
  { when: IDLING, unless: /\b(noise|noisy|loud|music|blasting|honk\w*|horn)\b/, terms: ["idling", "vehicle"], weight: 3, against: ["noise", "illegal", "parking"], categories: ["Air"], family: "idling" },
  { when: /\b(construction|jackhammer|drilling|demolition|crane|scaffold)/, terms: ["construction"], weight: 3, against: ["smoking", "sign"], categories: ["Noise", "Buildings & Property"], family: "noise" },
  // A jackhammer or drill is noise, and work before or after the allowed hours is the City's
  // "Noise from After Hours Construction" option on Noise from Construction (KA-01091).
  // Beta retest 3, 2026-11-09: "a construction site starts jackhammering at 6am" got the
  // Construction Site No Smoking Sign article on the word "construction".
  { when: /\b(jackhammer\w*|pile[- ]?driv\w*|drilling|demolition)\b/, unless: /\b(dust\w*|asbestos|debris|unsafe|without (a )?permit|illegal\w*)\b/, terms: ["noise", "construction", "jackhammer"], weight: 3, against: ["smoking", "sign", "dust", "permit"], categories: ["Noise"], family: "noise" },
  { when: new RegExp(`\\b(construction|jackhammer\\w*|drilling|demolition)\\b[^.]*${AFTER_HOURS}|${AFTER_HOURS}[^.]*\\b(construction|jackhammer\\w*|drilling|demolition)\\b`), terms: ["noise", "after", "hours"], weight: 2, against: ["smoking", "sign", "dust"], categories: ["Noise"], family: "noise" },
  { when: /\b(alarm)/, unless: /\b(smoke|carbon monoxide|co) (alarm|detector)/, terms: ["alarm", "noise"], weight: 3, categories: ["Noise"], family: "noise" },
  { when: /\b(car (was |got )?hit|hit my car|accident|crash(ed)?|collision|fender[- ]bender)\b/, onlyIf: (t) => !RECURRING.test(t), terms: ["accident", "vehicle"], weight: 3, categories: ["Safety & Crime"], family: "crash" },
  // Crashes that keep happening at one place: a traffic condition to fix, not one accident.
  { when: /\b(accidents?|crash(es|ed)?|collisions?|almost (hit|get hit|got hit)|near misses|speeding|run (the )?red lights?|running (the )?red lights?)\b/, onlyIf: (t) => RECURRING.test(t), terms: ["traffic", "safety", "condition"], weight: 3, against: ["rules", "ticket"], categories: ["Streets & Highways"], family: "traffic_safety" },
  { when: /\bsmok(e|es|ing)\b[^.]{0,25}\b(cigarettes?|cigars?|weed|marijuana|hallway|stairwell|lobby|building)\b|\b(cigarette|secondhand|second-hand) smoke\b/, onlyIf: (t) => !new RegExp(DETECTOR).test(t) || /\b(cigarettes?|cigars?|weed|marijuana|smokers?|smoking)\b/.test(t), terms: ["smoke", "free", "air", "act", "complaint"], weight: 3, categories: ["Tenants", "Public Health"], family: "smoking" },
  { when: /\b(smell|smells|odor|odour|stink\w*|fumes|exhaust)\b/, unless: /\bgas\b/, terms: ["odor", "smell"], synonyms: true, weight: 2, categories: ["Air"], family: "odor" },
  // Chimney and vent words only when said: an odor alone is not chimney smoke (with the Air
  // category recorded, "cooking odor" tied with Chimney or Ventilation Smoke; 2026-11-08).
  { when: /\b(chimney|chimneys|vents?|ventilation|exhaust)\b/, terms: ["ventilation", "chimney"], weight: 2, categories: ["Air"] },
  { when: /\b(dog|dogs|barking|barks|howl\w*|yapp?\w*|animal|perro)\b/, terms: ["dog", "animal"], weight: 2 },
  // A party or a crowd is noise; whose noise (a neighbor, the street, a bar) picks the article.
  // Not "party" or "crowd" as search words: they pulled in Noise from Large Party or Crowd
  // (KA-01591), whose only text is "Call 911 to report a large, loud party that has potential
  // for danger" (beta retest 8: "loud party next door at 2am" led with 911). Noise from Neighbor
  // (KA-01017) and Noise from Street or Sidewalk (KA-01092: "loud music, parties") take reports.
  { when: /\b(party|parties|dj|crowds?|block party)\b/, unless: /\b(permits?|apply|application)\b/, terms: ["noise"], weight: 2, against: ["permit"], categories: ["Noise"], family: "noise" },
  { when: /\bfireworks?\b|\bfuegos artificiales\b/, terms: ["fireworks"], weight: 3, categories: ["Noise", "Safety & Crime"], family: "fireworks" },
  // Parking and vehicles
  { when: /\b(parked|parking|double[- ]?park(s|ed|ing)?|park(ed)? illegally|mal estacionad\w*|estacionad\w*)\b/, unless: new RegExp(`${ABANDONED_VEHICLE.source}|\\b(parking )?(tickets?|summons(es)?|violations?|fines?)\\b|\\b(on|onto|into|hit|hits|hitting|over|crushed) (a|my|the|our|someone'?s) parked (cars?|vehicles?)\\b|\\b(parking )?meters?\\b|\\bmuni-?meters?\\b|${STREET_SIGN.source}|${IDLING.source}`), // "my parked car" names a car, not a parking problem (beta retest 10: a smashed car window
    // and a stolen bag got Illegal Parking, rated strong).
    onlyIf: (t) => /\b(parked|parking|double[- ]?park(s|ed|ing)?|park(ed)? illegally|mal estacionad\w*|estacionad\w*)\b/.test(t.replace(/\b(my|a|the|our|his|her|their|someone'?s|another|neighbor'?s) parked (cars?|vehicles?|trucks?|vans?|motorcycles?|scooters?)\b|\b(from|of|in|inside|behind|out of) (a|the|my|someone'?s|his|her) (cars?|trucks?|vans?|vehicles?|suvs?) parked\b/g, " ")),
    terms: ["parking", "illegal", "vehicle"], categories: ["Parking", "Tickets & Tows"], family: "parking" },
  // A parking meter: the City's Parking Meter Complaint or Request (KA-01240), not Illegal Parking.
  { when: /\b(parking )?meters?\b|\bmuni-?meters?\b/, unless: /\bwater meters?\b/, terms: ["parking", "meter", "complaint"], weight: 3, against: ["illegal"], categories: ["Parking"], family: "meter" },
  { when: /\bhydrant/, terms: ["hydrant"], weight: 2, categories: ["Water", "Sidewalks"] },
  { when: /\bdriveway/, terms: ["driveway", "blocked"], weight: 3, against: ["commercial"], categories: ["Parking"], family: "parking" },
  // Stage 8 stress set: "a car with flat tires has been sitting on my street for a month" found nothing.
  { when: ABANDONED_VEHICLE, unless: /\babandoned (dogs?|cats?|animals?|pets?|puppy|puppies|kittens?)\b/, terms: ["abandoned", "vehicle"], weight: 3, categories: ["Tickets & Tows", "Parking"], family: "parking" },
  { when: /\b(no|without|missing) (license )?plates?\b/, terms: ["without"], weight: 3 },
  { when: /\bwith (a )?(license )?plates?\b/, terms: ["with"], weight: 3 },
  // A vehicle in a bike lane is Illegal Parking (KA-01986: "Blocking a: ... Bike lane"); the Bike
  // Lane article (KA-01260) is upkeep and says "Illegal Parking to report a vehicle blocking a
  // bike lane". Beta retest 8, 2026-11-09: "a car is parked in the bike lane every single day"
  // got Bike Lane, rated strong.
  { when: /\bbike lane\b/, unless: BIKE_LANE_BLOCKED, terms: ["bike", "lane"], weight: 3, categories: ["Bikes", "Parking"], family: "bike_lane" },
  { when: BIKE_LANE_BLOCKED, terms: ["illegal", "parking", "parked", "vehicle"], weight: 3, against: ["bike", "lane", "meter"], categories: ["Parking"], family: "parking" },
  // Housing (category "Tenants")
  { when: /\b(heat|heating|radiators?|boiler|freezing|cold apartment|no heat|calefacci[oó]n|no hay calor)\b/, onlyIf: (t) => (!/\bboilers?\b/.test(t) || /\b(heat|heating|hot water|cold|freezing|radiators?)\b/.test(t)) && (!NOT_A_HOME.test(t) || HOME_WORDS.test(t)), // Hot weather is not a heating complaint ("this heat is unbearable", "no AC").
    // (The onlyIf above also keeps it off for a place that is not a home, a library or an office.)
    unless: /\b(heat ?waves?|heat (is|was) (unbearable|terrible|awful|crazy|killing|brutal|intense)|in this heat|the heat outside|too hot|so hot|no (ac|a\/c|air ?condition\w*)|sweltering|heat advisory|heat index)\b/,
    terms: ["heat"], weight: 3, categories: ["Tenants"], family: "heat" },
  { when: /\b(hot water|agua caliente)\b/, terms: ["hot", "water", "heat"], weight: 2, categories: ["Tenants"], family: "heat" },
  { when: NO_WATER, unless: /\bhot water\b/, terms: ["water", "pressure", "temperature"], weight: 3, against: ["heat", "leak", "main"], categories: ["Tenants", "Water"], family: "no_water" },
  { when: /\b(apartment|landlord|super|superintendent|tenant|my unit|my building|rent|apartamento|casero|due[ñn]o|edificio)\b/, terms: ["apartment", "residential", "building"], weight: 1, against: ["commercial", "nycha", "loft"], categories: ["Tenants"] },
  // A room of one's home says the place is a residence (stage 8 stress set: "mice keep getting
  // into my kitchen cabinets" got Rat or Mouse Complaint, not Residential Pest Complaint).
  // Pests only: for other problems the room's word tips a specific article (Mold Complaint)
  // toward the general Apartment Maintenance Complaint.
  { when: /\bmy (kitchen|bathroom|bedroom|living room|closet)s?\b/, unless: /\b(apartment|landlord|super|superintendent|tenant|my unit|my building)\b/, onlyIf: (t) => /\b(mice|mouse|rats?|rodents?|roach(es)?|cockroach(es)?|pests?|vermin|fleas|flies|bed ?bugs?)\b/.test(t), terms: ["residential"], weight: 2, categories: ["Tenants"] },
  // A lockout: Illegal Eviction or Lockout (KA-02518), whose City text says "Call 911 to report
  // ... landlords who lock out tenants". Beta retest 8: "the landlord changed the locks and won't
  // let me back in" got Apartment Maintenance, rated strong.
  { when: LOCKOUT, terms: ["illegal", "eviction", "lockout"], weight: 3, against: ["prevention", "notice", "commercial", "good", "cause"], categories: ["Tenants", "Safety & Crime"], family: "lockout" },
  { when: /\b(harass\w*|forcing (me|us) out|trying to (evict|force)|threaten\w* to evict|cut(ting)? off (my|our) (services|utilities|heat|water|gas|electricity)|acoso|acosando)\b/, terms: ["harass", "tenant"], weight: 3, categories: ["Tenants"], family: "harassment" },
  // Bed bugs: the City's Bed Bug Complaint (KA-01236), its own article. Beta retest 2026-11-08.
  // Bed bugs on something dumped outside are dumping, not a home's bed bugs (beta retest 11).
  { when: /\bbed ?bugs?\b|\bchinches\b/, unless: /\b(dump(ed|ing)?|left (out )?on the (curb|sidewalk|street)|on the (curb|sidewalk|street))\b/, terms: ["bed", "bug", "complaint"], weight: 3, categories: ["Tenants", "Pests & Wildlife"], family: "pests" },
  // Only inside or on one's own property is private: "in front of my house" is the sidewalk.
  // A roof, a fire escape, a balcony or a yard is private property (beta retest 11: "a dead bird on
  // my fire escape" got Dead Animal on Public Property, rated strong).
  { when: DEAD_ANIMAL, unless: /\b(apartment|(in|inside|on|under) (my|our|the|his|her|their) (home|house|yard|backyard|basement|property|roof|rooftop|porch|deck|fire escape|balcony|terrace|stoop|air ?conditioner|window ?sill)|my (yard|backyard|basement)|roof (next door|of)|in (my|the|our) building|inside)\b/, terms: ["dead", "animal", "public", "property"], weight: 3, against: ["private"], categories: ["Pests & Wildlife", "Sidewalks"], family: "dead_animal" },
  // Rodents and insects apart: a roach is not a rat. Beta retest 6 stress set: "roaches all over
  // my kitchen" got Rat or Mouse Complaint, rated strong, because one word list gave it "rat" too.
  // (The rodent list keeps "roach": with it, Residential Pest Complaint, whose summary names mice
  // and roaches, stays ahead of Rat or Mouse Complaint for rodents at home, as tested since round 1.)
  // At a subway station or on a bus: the MTA (KA-01014: "Report rats and other animals at MTA locations").
  { when: /\b(mice|mouse|rats?|rodents?|ratas?|ratones|roedores)\b/, unless: new RegExp(`${FOOD_PLACE_PESTS.source}|${TRANSIT.source}`), terms: ["pest", "mouse", "roach", "rat"], weight: 3, categories: ["Tenants", "Pests & Wildlife"], family: "pests" },
  { when: /\b(roach(es)?|cockroach(es)?|pests?|vermin|fleas|flies(?! (over|around|by|past|low|through|into|across|overhead|above))|cucarachas|chinches)\b/, unless: TRANSIT, terms: ["pest", "roach"], weight: 3, categories: ["Tenants", "Pests & Wildlife"], family: "pests" },
  { when: /\b(mold|mould|mildew|moho|hongos)\b/, terms: ["mold"], weight: 3, categories: ["Tenants"], family: "mold" },
  { when: /\b(toilet|sink|plumbing|pipes?|shower|bathtub|tub|clogged|faucet|inodoro|lavamanos)\b/, unless: PARK_RESTROOM, terms: ["maintenance", "plumbing"], weight: 2, categories: ["Tenants"], family: "repair" },
  { when: /\b(paint|plaster|ceiling|walls?|cracks?|cracked|peeling|pintura|techo)\b/, unless: /\b(sidewalk|street|road|pavement|curb|acera|calle|graffiti|spray[- ]?paint\w*|tagg(ed|ing)|excavat\w*|foundation)\b/, terms: ["maintenance", "paint"], weight: 2, categories: ["Tenants"], family: "repair" },
  { when: /\b(door|doors|locks?|windows?|puerta|ventana)\b/, unless: new RegExp(`${LOCKOUT.source}|${VEHICLE_DAMAGE.source}|\\bfire escape\\b|\\b(coming|blowing|getting|comes|blows) (in|into|through) (my |the |our )?(windows?|doors?)\\b|\\bgraffiti\\b`), terms: ["maintenance", "door", "window"], weight: 2, against: ["guard"], categories: ["Tenants"], family: "repair" },
  // A detector the owner did not put in is the same complaint as a broken one: owners must install
  // smoke and carbon monoxide detectors (KA-01074, "Smoke Detectors" and its CO section). Beta
  // retest 6, 2026-11-09: "landlord didn't install a CO detector" got no housing article at all.
  { when: new RegExp(`${DETECTOR}[^.]{0,30}\\b(broken|missing|not working|doesn'?t work|dead|removed|chirp\\w*|beep\\w*|needs? (a )?(new )?batter\\w*|batter(y|ies) (is |are )?(low|dead|dying))|\\b(no|missing|broken|without (a |any )?)\\s?${DETECTOR}|${NOT_PUT_IN}[^.]{0,25}${DETECTOR}|${DETECTOR}[^.]{0,40}\\b(never|not)( been)? (install\\w*|put (in|up)|provid\\w*|replac\\w*)`), terms: ["maintenance", "apartment"], weight: 3, against: ["installation"], categories: ["Tenants"], family: "repair" },
  { when: /\b(leak|leaking|leaks|dripping|drips|water coming|water (is )?pouring|pouring (in|through|down)|flooding|flooded|gotera|fuga de agua|filtraci[oó]n)\b/, unless: new RegExp(`${STREET_FLOOD.source}|${TRANSIT.source}`), onlyIf: (t) => !isStreetLeak(t) && !(HYDRANT_WATER.test(t) && !INDOOR_WATER.test(t)) && !(WATER_MAIN.test(t) && !INDOOR_WATER.test(t)), terms: ["leak", "water"], against: ["meter"], weight: 3, categories: ["Tenants", "Water"], family: "leak" },
  { when: /\b(elevators?|lifts?|escalators?|ascensor|elevador)\b/, unless: new RegExp(`${TRANSIT.source}|\\b(sleep(s|ing)?|passed out|lying|lives?|living) (in|on) (the|an?) (elevator|lift)`), terms: ["elevator", "escalator"], synonyms: true, weight: 3, against: ["inspector", "inspection", "permit", "code"], categories: ["Buildings & Property"], family: "elevator" },
  // A fire escape or exit only when something blocks it (stage 9: "pigeons on my fire escape").
  { when: /\bfire escapes?\b[^.]{0,40}\b(block\w*|obstruct\w*|bars?|gates?|locked|cluttered|full of|covered)\b|\b(block\w*|obstruct\w*|bars?|gates?|locked|cluttered) [^.]{0,40}\bfire escapes?\b|\b(blocked|locked) (building )?exits?\b/, terms: ["fire", "escape", "exit", "blocked"], weight: 3, categories: ["Buildings & Property"], family: "exit" },
  // Streets and sidewalks
  // On a highway, an exit ramp or a parkway: Pothole or Cave-In on Highway (KA-01106).
  { when: new RegExp(`\\b(potholes?|cave[- ]?in|sinkholes?)\\b[^.]{0,40}${HIGHWAY.source}|${HIGHWAY.source}[^.]{0,30}\\b(potholes?|cave[- ]?in|sinkholes?)\\b`), terms: ["pothole", "highway"], weight: 3, against: ["street"], categories: ["Streets & Highways"], family: "pothole" },
  { when: /\b(pothole|potholes|hole in the (road|street)|cave[- ]?in|sinkhole|crater|bache|baches|hoyo en la calle)/, terms: ["pothole", "cave", "street"], weight: 3, categories: ["Streets & Highways"], family: "pothole" },
  { when: /\b(tree )?roots?\b[^.]{0,40}\b(push\w*|lift\w*|rais\w*|crack\w*|break\w*|buckl\w*|uproot\w*|heav\w*)\b|\b(sidewalk|acera)\b[^.]{0,50}\b(crack\w*|crumbl\w*|broken|uneven|raised|trip\w*|damaged|hole|lifted|buckl\w*)\b|\bcrumbling (sidewalk|acera)\b|\b(crack\w*|broken|uneven|damaged) (sidewalk|acera)\b/, terms: ["broken", "sidewalk"], weight: 3, categories: ["Sidewalks"], family: "sidewalk" },
  // A walk signal is Pedestrian Signal Complaint or Request (KA-01047, "Walk/Don't Walk"), not
  // the traffic signal article (beta retest 9).
  { when: /\b(walk (signals?|signs?|lights?)|don'?t walk|pedestrian (signals?|lights?)|countdown (timers?|clocks?|signals?)|crossing signals?)\b/, terms: ["pedestrian", "signal"], weight: 3, against: ["traffic", "bicycle", "bridge", "plaza", "safety"], categories: ["Sidewalks", "Streets & Highways"], family: "signal" },
  { when: /\b(traffic (light|signal)|stop ?light|signal|walk sign|red light|sem[aá]foro)\b/, unless: /\b(walk (signals?|signs?|lights?)|don'?t walk|pedestrian (signals?|lights?)|countdown|crossing signals?)\b/, terms: ["traffic", "signal"], weight: 3, categories: ["Streets & Highways", "Sidewalks"], family: "signal" },
  { when: STREET_SIGN, terms: ["street", "sign", "complaint"], weight: 3, against: ["request", "purchase", "highway", "advertising", "building"], categories: ["Streets & Highways"], family: "street_sign" },
  // A sign that came down: the "Street Sign Fallen, Dangling, or Leaning" option (KA-01063).
  { when: new RegExp(`${STREET_SIGN.source}[^.]{0,40}\\b${SIGN_DOWN}\\b|\\b${SIGN_DOWN}\\b[^.]{0,30}${STREET_SIGN.source}`), terms: ["fallen", "dangling", "leaning"], weight: 2 },
  // A bus stop shelter: the City's Bus Stop Shelters article (KA-01071). Beta retest 3, 2026-11-09.
  { when: /\bbus (stop )?shelters?\b|\bbus stop\b[^.]{0,30}\b(glass|smashed|broken|shattered|damaged|cracked)\b/, terms: ["bus", "stop", "shelter", "complaint"], weight: 3, against: ["bike", "sheltered"], categories: ["Sidewalks", "Streets & Highways"], family: "bus_shelter" },
  // A street vendor: the City's Street Vendor Complaint (KA-02152). Beta retest 3, 2026-11-09:
  // "someone is selling food on the street without a permit" found nothing.
  { when: /\b(vendors?|vending|peddl\w*|sellers?|hawkers?)\b|\bsell(s|ing)?\b[^.]{0,40}\b(on the street|on the sidewalk|in the street|on my block|on the corner|without a (permit|license))\b|\bfood (carts?|trucks?)\b/, unless: /\b(drugs?|weed|marijuana|counterfeit|fake|food poisoning|sick|ill|vomit\w*|threw up|throwing up|cigarettes?|loosies|vapes?|tobacco)\b/, terms: ["street", "vendor", "complaint"], weight: 3, against: ["art", "tax", "contract"], categories: ["Sidewalks", "Streets & Highways"], family: "vendor" },
  { when: /\b(unlicensed|without a (permit|license)|no (permit|license)|illegal(ly)? (vend\w*|sell\w*))\b/, terms: ["unlicensed"], weight: 2 },
  { when: /\b(street ?lights?|lamp ?posts?|light poles?|poste de luz)\b/, terms: ["street", "light"], weight: 3, categories: ["Streets & Highways", "Sidewalks"], family: "street_light" },
  // "tree" adds only tree, and "branch" only branch: one entry giving both made Fallen Tree or
  // Branch strong for anything said about a tree (beta retest 9: "a swarm of bees on the tree").
  { when: /\bbranch(es)?\b/, unless: ROOTS_OR_BEES, terms: ["branch"], weight: 3, categories: ["Sidewalks", "Streets & Highways"], family: "tree" },
  { when: /\b(trees?|branch(es)?|limbs?)\b[^.]{0,30}\b(fell|fallen|falling|came down|coming down|knocked (down|over)|blew (down|over)|toppled|uprooted|snapped|broke off|split)\b|\b(fallen|downed|toppled|uprooted) (trees?|branch(es)?|limbs?)\b/, unless: ROOTS_OR_BEES, terms: ["fallen"], weight: 3, against: ["destruction", "dead", "pruning"], categories: ["Sidewalks", "Streets & Highways"], family: "tree" },
  { when: /\b(trees?|[aá]rbol)\b/, unless: ROOTS_OR_BEES, terms: ["tree"], weight: 3, categories: ["Sidewalks", "Streets & Highways"], family: "tree" },
  // A standing dead or dying tree: the City's Dead Tree article (KA-02006), not Fallen Tree
  // or Branch, unless the person says it fell. Beta retest 2026-11-08.
  { when: /\b(dead|dying)\b[^.]{0,20}\b(trees?|[aá]rbol)\b|\btrees?\b[^.]{0,40}\b(dead|dying)\b/, unless: /\b(fell|fallen|falling|came down|knocked down|blew down|toppled)\b/, terms: ["dead"], weight: 3, against: ["fallen"], family: "tree" },
  // A sidewalk shed or scaffold left up: the City's Scaffold or Sidewalk Shed Complaint (KA-02291).
  { when: /\b(sidewalk|construction) sheds?\b|\bscaffold\w*/, unless: /\b(loud|noise|noisy|banging|drilling|music|yelling|hammering)\b/, terms: ["scaffold", "sidewalk", "shed", "complaint"], weight: 3, against: ["permit"], categories: ["Sidewalks", "Buildings & Property"], family: "scaffold" },
  // Snow on a sidewalk: Snow or Ice on Sidewalk (KA-01397), not the street article (beta retest 8).
  { when: /\b(snow|ice(?! cream)|icy|unshoveled|unshoveled|slush)\b[^.]{0,50}\bsidewalks?\b|\bsidewalks?\b[^.]{0,40}\b(snow|ice(?! cream)|icy|unshoveled|slush)\b/, terms: ["sidewalk"], weight: 3, against: ["highway"] },
  { when: /\b(snow|ice(?! cream)|icy|unshoveled|shovel|slush|plow|nieve|hielo)/, terms: ["snow", "ice"], synonyms: true, weight: 3, categories: ["Sidewalks", "Streets & Highways"], family: "snow" },
  // Water
  { when: STREET_FLOOD, terms: ["street", "flooding", "ponding"], weight: 3, categories: ["Streets & Highways"], family: "street_flooding" },
  { when: /\b(water ?mains?|main (broke|burst|break)|gushing|water (all )?over the street|water in the street)/, onlyIf: (t) => !INDOOR_WATER.test(t) && !(HYDRANT_WATER.test(t) && !WATER_MAIN.test(t)), terms: ["water", "main", "break"], weight: 3, against: ["building", "meter"], categories: ["Water", "Sidewalks"], family: "water" },
  { when: HYDRANT_WATER, terms: ["fire", "hydrant", "complaint", "leak", "running"], weight: 3, against: ["building", "request", "permit"], categories: ["Water", "Sidewalks"], family: "water" },
  { when: STREET_LEAK, onlyIf: isStreetLeak, terms: ["water", "leak", "street", "sidewalk"], weight: 3, against: ["building", "apartment", "meter", "commercial", "drinking"], categories: ["Sidewalks", "Streets & Highways"], family: "water" },
  // Trash
  { when: TRASH_INDOORS, unless: /\b(trash|garbage|litter|recycling|public) (cans?|baskets?|bins?)\b|\bbaskets?\b/, terms: ["apartment", "maintenance", "complaint"], weight: 3, against: ["gutter", "sidewalk", "street", "basket", "lot"], categories: ["Tenants"], family: "building_trash" },
  { when: /\b(trash|garbage|litter|rubbish|debris|dirty|filthy|broken glass|dog (poop|waste)|basura|sucio)/, unless: new RegExp(`${MISSED_COLLECTION.source}|${TRASH_INDOORS.source}|${PARK_RESTROOM.source}|${DIRTY_AT_HOME.source}|${ANIMAL_IN_TRASH.source}|\\b(raccoons?|possums?|opossums?|skunks?|rats?|mice|pigeons?)\\b[^.]{0,30}\\b(getting|get|got|going|digging|into)\\b`), terms: ["dirty", "litter", "trash"], synonyms: true, weight: 2, categories: ["Cleaning", "Collection & Disposal"], family: "trash" },
  { when: DIRTY_AT_HOME, unless: new RegExp(`${PARK_RESTROOM.source}|${TRASH_INDOORS.source}|${NOT_HOME.source}`), terms: ["apartment", "maintenance"], weight: 2, against: ["basket", "gutter", "sidewalk", "street"], categories: ["Tenants"] },
  // Trash inside a building is not a public litter basket ("trash in the lobby" got Litter
  // Basket once that article was recorded, 2026-11-08); a can, basket or bin said wins.
  { when: /\b(trash|garbage|litter|recycling|public) (cans?|baskets?|bins?)\b|\b(litter )?baskets?\b/, unless: ANIMAL_IN_TRASH, terms: ["basket"], weight: 3 },
  { when: /\b(lobby|hallways?|stairwells?|stairs|basement|laundry room|elevator|inside (my|the|our) building|in (my|the|our) building)\b/, unless: /\b(trash|garbage|litter|recycling|public) (cans?|baskets?|bins?)\b|\bbaskets?\b/, terms: [], against: ["basket"] },
  // Furniture alone is not dumping ("passes out on the couch"); dumped, left out, or on the street is.
  { when: /\b(dump|dumped|dumping)\b|\b(mattress(es)?|couch(es)?|sofas?|furniture|tires|appliances?|tvs?|televisions?|computers?|monitors?|microwaves?|fridges?|refrigerators?|air conditioners?|electronics)\b[^.]{0,40}\b(left|dumped|abandoned|thrown|on the (curb|sidewalk|street|corner)|in the (street|lot|alley)|outside)\b|\b(left|dumped|abandoned|threw|thrown) (out )?(a |an |the |some |old |broken )*(tvs?|televisions?|computers?|monitors?|microwaves?|fridges?|refrigerators?|air conditioners?|electronics|mattress(es)?|couch(es)?|sofas?)\b/, terms: ["dump", "illegal"], weight: 3, categories: ["Cleaning"], family: "dumping" },
  { when: MISSED_COLLECTION, terms: ["collection", "missed"], weight: 3, categories: ["Collection & Disposal"], family: "collection" },
  // Homelessness
  { when: /\b(sleep(s|ing)?|passed out|lying|lays?|lies) (out )?(on|in) (a |the |my )?(park )?(bench(es)?|doorways?|stoops?|sidewalks?|streets?|subway|vestibule|lobby|stairwell|steps|elevator|hallway|laundry room)\b|\b(homeless|encampments?|tents?\b|unhoused|sleeping (on|in) the|living on the street|person sleeping|sin hogar|campamento)/, terms: ["homeless", "encampment", "outreach"], weight: 3, categories: ["Safety & Crime", "Homelessness"], family: "homeless" },
  // Graffiti: the City's Graffiti article (KA-02070), not a building repair. Beta test 2026-11-08.
  { when: /\b(graffiti|grafitti|graffitti|grafiti|spray[- ]?paint\w*|tagg(ed|ing)|tags? (on|all over))\b/, unless: /\b(odor|fumes|smell\w*|sell\w*|sale|minors?)\b/, terms: ["graffiti"], weight: 3, categories: ["Sidewalks", "Streets & Highways"], family: "graffiti" },
  // Grills: the City's Barbecuing article (KA-02228), the closest the City has to grill smoke;
  // its non-emergency smoke route is for chimneys and vents only. Beta test 2026-11-08.
  { when: /\b(grill|grills|grilling|bbq|barbe?cu\w*|barbequ\w*|hibachi)\b/, terms: ["barbecuing"], weight: 3, categories: ["Parks & Recreation", "Air"], family: "barbecue" },
  // Parks: a park is a place, not a home, so a park's own report option wins (rats in a park
  // go to Parks, not to HPD's at-home form). "Park" alone, never "parking" or "parked".
  { when: /(?<!double[- ])\b(parks?|playgrounds?|greenway|ball ?fields?|dog runs?)\b/, terms: ["park"], weight: 2, categories: ["Parks & Recreation"] },
  { when: /\b(bench|benches|swings?|slides?|see-?saws?|jungle gym|monkey bars|water fountains?|drinking fountains?|(basketball|handball|tennis) (court|hoop)s?)\b/, terms: ["park", "maintenance"], weight: 3, categories: ["Parks & Recreation"], family: "park_maintenance" },
  { when: PARK_RESTROOM, terms: ["park", "maintenance"], weight: 3, against: ["apartment", "residential", "meter", "garage", "illegal"], categories: ["Parks & Recreation"], family: "park_maintenance" },
  // Illness from food: the City's Food Poisoning article (KA-02051). Beta retest 2026-11-08.
  { when: /\bfood poisoning\b|\bintoxicaci[oó]n alimentaria\b|\b(sick|ill|vomit\w*|threw up|throwing up)\b[^.]{0,40}\b(ate|eating|food|meal|restaurant|takeout)\b|\b(ate|eating)\b[^.]{0,40}\b(sick|ill|vomit\w*|threw up|throwing up)\b/, terms: ["food", "poisoning", "illness"], weight: 3, against: ["noise"], categories: ["Public Health"], family: "food_illness" },
  // The subway and MTA buses: the City's Buses and Subways article (KA-01014), whose "Bus or
  // Subway Complaint" section sends "maintenance, comfort, or cleanliness issues in a station or
  // on a bus or train" to the MTA. Not a building elevator (Buildings) or a litter basket. Beta
  // retest 7, 2026-11-09: a subway station elevator got Elevator or Escalator Complaint.
  { when: TRANSIT, unless: /\bschool bus\w*|\byellow bus\w*|\b(kid|kids|son|daughter|child|children)'?s? (yellow |school )?bus\b|\baccess-?a-?ride\b|\bparatransit\b|\b(exposed (him|her)sel(f|ves)|flash(ed|ing|er)|masturbat\w*|lewd|grop\w*)\b/, terms: ["bus", "subway"], weight: 3, against: ["elevator", "escalator", "basket", "building", "school", "lane", "camera", "construction", "pass", "fair", "arrival", "sign", "port", "authority"], categories: ["Public Transportation"], family: "transit" },
  // Animals (category "Pets", recorded 2026-11-09). A dog off its leash: Unleashed Dog (KA-01051),
  // "a dog that is not leashed in a park or other public place". Beta retest 7: "people let their
  // dogs run off leash in the park" got Dog or Animal Waste.
  { when: /\b(off[- ]?(the[- ])?leash(es|ed)?|unleashed|without (a |their |its )?leash(es)?|no leash(es)?|not on (a |their |its )?leash(es)?|not leashed)\b/, terms: ["unleashed", "dog"], weight: 3, against: ["waste", "noise", "license", "restaurant"], categories: ["Pets", "Parks & Recreation"], family: "unleashed_dog" },
  // A stray or abandoned animal: Stray or Abandoned Animal (KA-02300). An aggressive one is a
  // danger (emergency.ts, the City's Dangerous Animal article: call 911).
  { when: /\b(stray|abandoned|loose|roaming|lost) (dogs?|cats?|animals?|pets?|pit ?bulls?|puppy|puppies|kittens?)\b|\b(dogs?|cats?|animals?) (is |are )?(roaming|wandering|running loose|on the loose)\b/, terms: ["stray", "abandoned", "animal"], weight: 3, against: ["waste", "noise", "dead", "vehicle", "property"], categories: ["Pets"], family: "stray_animal" },
  // Something broken or out: a complaint about a problem, not a request for a new one or an
  // inspection or a permit. Context only (weight 1, no family): it breaks ties such as
  // Elevator or Escalator Complaint against Elevator or Escalator Inspection, and Street Light
  // Complaint against Street Light Installation or Relocation Request (beta retest 7).
  { when: /\b(broken|broke|not working|isn'?t working|doesn'?t work|out of (service|order)|(is|are|has been|have been|went|been) out|stopped working|stuck|damaged|busted)\b/, terms: ["problem", "complaint"], weight: 1 },
  // Beta retest 8, 2026-11-09: City articles that exist and were not found, from their own titles
  // and summaries (test/fixtures/content/, recorded 2026-11-09 read-only).
  // Noise from Helicopter (KA-02267).
  { when: /\b(helicopters?|choppers?)\b/, terms: ["helicopter", "noise"], weight: 3, categories: ["Noise"], family: "helicopter" },
  // Manhole Cover Complaint (KA-01669): "missing, sunken, raised, damaged, noisy, or steaming".
  { when: /\bmanholes?\b/, unless: /\b(overflow\w*|flood\w*|sewage)\b/, terms: ["manhole", "cover", "complaint"], weight: 3, against: ["installation", "permit", "flooding"], categories: ["Streets & Highways", "Noise"], family: "manhole" },
  // Pavement Marking Complaint or Request (KA-01100): "missing or faded pavement markings".
  { when: /\b(crosswalks?|lane|street|road|pavement|stop line)s? ?(paint|lines?|markings?|stripes?)\b[^.]{0,30}\b(faded|fading|worn|missing|gone|disappear\w*)\b|\b(faded|worn|missing) (crosswalks?|lane lines?|road lines?|street lines?|markings?|stripes?)\b/, terms: ["pavement", "marking", "complaint"], weight: 3, against: ["request", "apartment", "lead"], categories: ["Streets & Highways"], family: "markings" },
  // Taxi Complaint (KA-01241): "rudeness, unsafe driving, refusing a request, ... route complaints".
  { when: /\b(taxis?|cabs?|cabbie|taxi ?drivers?|cab ?drivers?|green cab|yellow cab|ubers?|lyfts?|car service)\b/, unless: /\b(honk\w*|horns?|idl\w*|parked|parking|blocking)\b/, terms: ["taxi", "complaint"], weight: 3, against: ["compliment", "lost", "receipt", "medallion", "insurance", "accessible", "surcharge"], categories: ["Taxis & Car Services"], family: "taxi" },
  // Illegal Animal (KA-02255): "By law, most farm, wild, and exotic animals cannot be kept as pets."
  { when: /\b(roosters?|hens?|chickens|goats?|pigs?|sheep|farm animals?|snakes?|monkeys?|exotic (animals?|pets?)|illegal (pets?|animals?))\b[^.]{0,40}\b(backyard|yard|apartment|kept|keeps?|keeping|raising|as a pet|crow\w*|next door|neighbor\w*)\b|\b(keeps?|kept|keeping|raising|raises|has|have|owns?)\b[^.]{0,30}\b(roosters?|hens|chickens|goats?|pigs?|farm animals?|snakes?|monkeys?|exotic (animals?|pets?))\b/, terms: ["illegal", "animal"], weight: 3, against: ["exhibition", "permit", "facility"], categories: ["Pets", "Pests & Wildlife"], family: "illegal_animal" },
  // Wild Animal (KA-01790): wildlife, how to report wild animals.
  { when: /\b(raccoons?|possums?|opossums?|skunks?|coyotes?|wildlife|wild animals?|foxe?s?)\b/, unless: DEAD_ANIMAL, terms: ["wild", "animal"], weight: 3, against: ["exhibition", "permit", "roundworm"], categories: ["Pests & Wildlife"], family: "wildlife" },
  // Citi Bike (KA-02221): "report an equipment maintenance problem".
  { when: /\bciti ?bikes?\b/, terms: ["citi", "bike"], weight: 3, categories: ["Parks & Recreation", "Bikes"], family: "citi_bike" },
  // Cable Complaint (KA-01058): "a problem with a cable TV, phone, or internet provider".
  { when: /\b(internet|cable (tv|company|provider|box|bill)|wi-?fi|broadband|spectrum|optimum|fios|internet provider|cable provider)\b/, terms: ["cable", "complaint"], weight: 3, against: ["online", "pay"], categories: ["Tenants"], family: "cable" },
  // Stolen Property (KA-01219): "Call 911 to report stolen property". A theft that is over gets
  // the crime pointer (precinct, Crime Stoppers) instead of a 911 first line (articleSays911).
  { when: /\b(stole|stolen|steal\w*|theft|swiped|took my|taken|grabbed my)\b/, unless: /\b(stole|stolen|steal\w*|took) (my |the |a |his |her |our )?(cars?|vehicles?|trucks?|motorcycles?|scooters?)\b|\b(cars?|vehicles?|trucks?|motorcycles?) (was |got |were )?stolen\b|\b(identity|benefits?|ebt|snap|money|deposit|immigra\w*|notario|scam\w*|fraud\w*)\b/, terms: ["stolen", "property"], weight: 3, categories: ["Safety & Crime"], family: "theft" },
  // Pigeons (Pigeon Droppings or Odor, KA-02280).
  { when: /\bpigeons?\b/, unless: new RegExp(`${DEAD_ANIMAL.source}|\\b(injured|hurt|broken (wing|leg)|bleeding|limping|sick|can'?t fly)\\b`), terms: ["pigeon", "droppings", "odor"], weight: 3, against: ["exhibition", "trapping", "netting"], categories: ["Pests & Wildlife", "Pets", "Air"], family: "pigeons" },
  // Stage 9 stress set (2026-11-09): City articles that a near miss pulled away from.
  // Food Safety Complaint (KA-01111).
  { when: FOOD_PLACE_PESTS, unless: /\b(food poisoning|sick|vomit\w*|threw up)\b/, terms: ["food", "safety", "complaint", "unsanitary"], weight: 3, against: ["rat", "mouse", "residential", "poison", "sign"], categories: ["Public Health"], family: "food_safety" },
  // Boiler Complaint (KA-02047): a boiler's own problem, not no heat.
  { when: /\bboilers?\b/, onlyIf: (t) => !/\b(heat|heating|hot water|cold|freezing|radiators?|smoke|chimney|soot)\b/.test(t), terms: ["boiler", "complaint"], weight: 3, against: ["inspection", "permit", "registration", "violation", "heap"], categories: ["Buildings & Property", "Noise"], family: "boiler" },
  // Film or Television Production Complaint (KA-01461).
  { when: /\b(film\w*|filming|movie|tv show|television|photo shoot|production)\b[^.]{0,40}\b(shoot\w*|crew|set|trucks?|block\w*|parking|noise|lights?)\b|\b(shooting|filming) (a |an )?(movie|film|show|commercial|tv)\b/, terms: ["film", "television", "production", "complaint"], weight: 3, against: ["permit", "parking", "illegal"], categories: ["Noise", "Streets & Highways"], family: "film" },
  // Tree Pruning (KA-01794) and Chained Bike (KA-02218), not Fallen Tree or Branch.
  { when: /\b(prun\w*|trim\w*|overgrown|cut back)\b/, unless: /\b(fell|fallen|came down|broke off|snapped)\b/, onlyIf: (t) => /\btrees?\b|\bbranch/.test(t), terms: ["tree", "pruning"], weight: 3, against: ["fallen", "stump"], family: "tree" },
  { when: /\b(chained|locked|abandoned|derelict) (up )?(bikes?|bicycles?)\b|\b(bikes?|bicycles?)\b[^.]{0,20}\b(chained|locked) to\b/, terms: ["chained", "bike"], weight: 3, against: ["fallen", "branch", "lane", "share", "rack"], categories: ["Sidewalks", "Bikes"], family: "chained_bike" },
  // Sewer Backup (KA-01510): "sewage water coming out of a toilet, sink drain, or bathtub drain".
  { when: /\bsewage\b[^.]{0,40}\b(back\w*|coming (up|out)|into (my|the|our))\b|\bsewer\b[^.]{0,20}\bback\w*|\bbacking up\b[^.]{0,30}\b(toilet|drain|basement|sink|tub)\b/, terms: ["sewer", "backup"], weight: 3, against: ["odor", "line"], categories: ["Tenants", "Water"], family: "sewer" },
  // Loose Syringes (KA-02475).
  { when: /\b(needles?|syringes?|sharps)\b/, unless: /\bsewing\b/, terms: ["loose", "syringe", "needle"], weight: 3, categories: ["Sidewalks", "Parks & Recreation"], family: "syringe" },
  // Cigarette Sale Complaint (KA-02627).
  { when: /\b(loose cigarettes|loosies|sell\w* (loose |single )?(cigarettes?|vapes?|e-?cigarettes?|tobacco)|(cigarettes?|vapes?|tobacco) to (kids|minors|children|teens?))\b/, terms: ["cigarette", "sale", "complaint"], weight: 3, against: ["tax", "registration", "shop"], categories: ["Safety & Crime"], family: "cigarettes" },
  // Crane or Derrick Complaint (KA-02053).
  { when: /\b(cranes?|derricks?)\b/, unless: /\bcrane (fly|flies)\b/, terms: ["crane", "derrick", "complaint"], weight: 3, against: ["permit"], categories: ["Buildings & Property"], family: "crane" },
  // Trash or broken glass in a park or playground: Park Maintenance Complaint (KA-01060, "unclean conditions").
  { when: new RegExp(`\\b(trash|garbage|litter|broken glass|glass|debris|dirty|filthy|(beer )?cans|bottles|cups|wrappers)\\b[^.]{0,40}\\b${PARK_PLACE}\\b|\\b${PARK_PLACE}\\b[^.]{0,30}\\b(trash|garbage|litter|broken glass|glass|debris|dirty|filthy|(beer )?cans|bottles)\\b`), unless: PARK_RESTROOM, terms: ["park", "maintenance"], weight: 3, against: ["basket", "sidewalk", "gutter"], categories: ["Parks & Recreation"], family: "park_maintenance" },
  // Gas for cooking turned off: Apartment Maintenance Complaint (KA-01074, "Cooking gas that has
  // been shut off"). A gas smell is a danger (emergency.ts) and is never this.
  { when: /\b(cooking gas|gas (stove|range|service|burners?|oven))\b[^.]{0,40}\b(off|shut|doesn'?t (light|work)|won'?t (light|work)|not working)\b|\b(turned|shut|cut) (off )?the gas\b|\bgas\b[^.]{0,30}\b(turned|shut|cut) off\b|\bno (cooking )?gas\b/, unless: /\b(smell\w*|odor|leak\w*|rotten eggs?)\b/, terms: ["apartment", "maintenance"], weight: 3, against: ["heat", "permit", "company"], categories: ["Tenants"], family: "gas_off" },
  // Wild animals indoors.
  { when: /\bbats? (flew|flying|got|is|in)\b|\ba bat\b[^.]{0,20}\b(apartment|house|home|room|inside)\b/, unless: /\bbaseball\b/, terms: ["wild", "animal"], weight: 3, against: ["exhibition", "permit"], categories: ["Pests & Wildlife"], family: "wildlife" },
  // Beta retest 9, 2026-11-09: City articles that exist and were not found.
  // Bees or Wasps Complaint (KA-02230).
  { when: /\b(bees?|wasps?|hornets?|yellow ?jackets?|beehives?|(bee|wasp|hornet)s? nests?)\b/, unless: /\bbeekeep\w*/, terms: ["bees", "wasps", "complaint"], weight: 3, against: ["beekeeping", "tree", "fallen"], categories: ["Pests & Wildlife"], family: "bees" },
  // Drinking Water (KA-01402): "odor, taste, discoloration".
  { when: /\b(tap|drinking|faucet|sink) water\b[^.]{0,30}\b(brown|yellow|cloudy|discolor\w*|dirty|rusty|smells?|tastes?|milky|black)\b|\bwater (from|out of) (my|the) (tap|faucet|sink)\b[^.]{0,20}\b(brown|yellow|cloudy|discolor\w*|dirty|rusty|smells?|tastes?|milky|black)\b|\b(brown|cloudy|rusty|discolored) (tap |drinking )?water\b/, terms: ["drinking", "water"], weight: 3, against: ["lead", "leak", "main", "pressure"], categories: ["Water", "Tenants"], family: "drinking_water" },
  // Pedestrian Ramp Complaint (KA-02276).
  { when: /\b(curb|pedestrian|wheelchair|corner) ramps?\b/, terms: ["pedestrian", "ramp", "complaint"], weight: 3, against: ["request"], categories: ["Sidewalks"], family: "ramp" },
  // Building Construction Complaint (KA-01797): "done without a permit".
  { when: /\b(build\w*|construct\w*|renovat\w*|extension|addition|work)\b[^.]{0,40}\b(without (a )?permits?|no permits?)\b|\billegal (construction|conversion|extension|addition)\b/, unless: /\b(vendors?|vending|selling|sells?|food carts?|parking|parked|permit (sign|plate))\b/, terms: ["building", "construction", "complaint"], weight: 3, against: ["permit", "sign", "smoking", "sidewalk", "street"], categories: ["Buildings & Property"], family: "construction" },
  // Catch Basin or Sewer Odor (KA-02315).
  { when: /\b(sewer|sewage|drains?|catch basins?|storm drains?|grates?)\b[^.]{0,40}\b(smell\w*|odou?rs?|stinks?|stench)\b|\b(smell\w*|odou?rs?|stinks?|stench)\b[^.]{0,40}\b(sewer|sewage|street drains?|storm drains?|catch basins?)\b/, unless: /\b(backing up|backed up|coming (up|out) of (my|the) (toilet|sink|tub|drain))\b/, terms: ["catch", "basin", "sewer", "odor"], weight: 3, against: ["restaurant", "neighbor", "dry", "nail"], categories: ["Air", "Streets & Highways"], family: "sewer_odor" },
  // Lewd Act (KA-01576), Hate Crime (KA-01561), Child Abuse (KA-01221): their own words only
  // (SENSITIVE_ARTICLES keeps them out otherwise).
  { when: /\b(exposed (him|her)sel(f|ves)|exposing (him|her)sel(f|ves)|flash(ed|ing|er)|masturbat\w*|lewd)\b/, terms: ["lewd", "act"], weight: 3, categories: ["Safety & Crime"], family: "lewd" },
  { when: /\b(hate crimes?|swastikas?|racial slurs?|antisemit\w*|homophobic|racist (graffiti|attacks?|threats?))\b/, terms: ["hate", "crime"], weight: 3, categories: ["Safety & Crime"], family: "hate" },
  { when: /\b(abus\w*|neglect\w*|mistreat\w*|starv\w*)\b[^.]{0,30}\b(child|children|kids?|son|daughter|baby|toddler)\b|\b(child|children|kids?|baby)\b[^.]{0,30}\b(abus\w*|neglect\w*)\b/, terms: ["child", "abuse"], weight: 3, categories: ["Safety & Crime"], family: "child_abuse" },
  // Stage 10 stress set (2026-11-09): schools, construction, health, pets, consumer, immigration,
  // benefits. City articles from the recorded category lists.
  { when: /\bschool bus(es)?\b|\byellow bus(es)?\b|\b(kid|kids|son|daughter|child|children)'?s? (yellow |school )?bus\b|\bbus (driver )?(for|to) (my |the )?(kid|kids|son|daughter|child|children|school)\b/, terms: ["school", "bus", "complaint"], weight: 3, against: ["subway", "metrocard", "pass"], categories: ["Public Transportation"], family: "school_bus" },
  { when: /\b(schools?|classrooms?|school (cafeteria|building|gym|bathroom))\b/, unless: /\bschool bus|after[- ]school|school (zone|crossing)|crossing guard/, onlyIf: (t) => /\b(heat|cold|leak\w*|broken|repair\w*|mice|mouse|rats?|roach\w*|mold|maintenance|no (heat|water)|dirty|toilets?|bathrooms?)\b/.test(t), terms: ["school", "maintenance", "complaint"], weight: 3, against: ["apartment", "residential", "bus"], categories: ["Maintenance"], family: "school_maintenance" },
  { when: /\b(parking )?(tickets?|summons(es)?)\b/, onlyIf: (t) => /\b(parking|parked|meter|sign|camera)\b/.test(t), terms: ["parking", "ticket", "dispute"], weight: 3, against: ["payment", "plan", "copy", "advocate", "business"], categories: ["Tickets & Tows"], family: "ticket" },
  { when: /\bdust\w*\b/, unless: /\blead\b/, terms: ["dust", "complaint"], weight: 3, against: ["noise", "lead"], categories: ["Air", "Buildings & Property"], family: "dust" },
  { when: /\bexcavat\w*|\b(foundation|building)\b[^.]{0,30}\b(undermin\w*|crack\w*|sinking|shifting)\b[^.]{0,40}\b(construction|digging|next door|excavat\w*)\b/, terms: ["excavation", "undermining", "building"], weight: 3, against: ["permit", "apartment"], categories: ["Buildings & Property"], family: "excavation" },
  { when: /\basbestos\b/, terms: ["asbestos", "complaint"], weight: 3, against: ["investigator", "notification"], categories: ["Buildings & Property", "Public Health"], family: "asbestos" },
  { when: /\b(demolition|demolishing|tearing down)\b[^.]{0,40}\b(unsafe|illegal\w*|without (a )?permit|no permit)\b|\b(unsafe|illegal) demolition\b/, terms: ["building", "demolition", "complaint"], weight: 3, against: ["permit", "rat"], categories: ["Buildings & Property"], family: "demolition" },
  { when: /\b(notarios?|immigra\w*)\b[^.]{0,60}\b(fraud\w*|scam\w*|charg\w*|took my money|money|fees?|paid)\b|\b(charg\w*|scam\w*|took (my|their) money)\b[^.]{0,40}\b(immigrants?|immigration|notarios?)\b/, terms: ["immigration", "fraud"], weight: 3, categories: ["Safety & Crime"], family: "immigration_fraud" },
  { when: /\b(ambulances?|emts?|paramedics?)\b[^.]{0,40}\b(rude|late|slow|took forever|never came|complain\w*|treated)\b/, terms: ["ambulance", "complaint"], weight: 3, categories: ["Safety & Crime"], family: "ambulance" },
  { when: /\bcooling towers?\b/, terms: ["cooling", "tower", "complaint"], weight: 3, against: ["registration"], categories: ["Buildings & Property"], family: "cooling_tower" },
  { when: /\b(dogs?|cats?|animals?|pit ?bulls?)\b[^.]{0,20}\b(bit|bitten|bites)\b[^.]{0,20}\b(me|my (son|daughter|kid|child|husband|wife)|a (person|man|woman|kid|child|boy|girl)|someone|him|her)\b/, terms: ["animal", "bite"], weight: 3, against: ["waste"], categories: ["Pets", "Public Health"], family: "animal_bite" },
  { when: /\b(dogs?|cats?|pets?|puppy|kitten)\b[^.]{0,20}\b(got (loose|out|away)|ran away|is (lost|missing)|went missing)\b|\blost (my )?(dogs?|cats?|pets?)\b/, terms: ["lost", "found", "pet"], weight: 3, categories: ["Pets"], family: "lost_pet" },
  { when: /\bdog licen[cs]e\w*/, terms: ["dog", "license"], weight: 3, against: ["guard"], categories: ["Pets"], family: "dog_license" },
  { when: /\b(pet (stores?|shops?)|sell\w* (sick )?(puppies|kittens|pets))\b/, terms: ["pet", "sale", "complaint"], weight: 3, categories: ["Pets"], family: "pet_sale" },
  { when: /\b(left|leaves|leaving|keeps?|kept) (his|her|their|a|the) (dogs?|cats?|pets?) (outside|out|chained|tied)\b[^.]{0,30}\b(cold|heat|snow|rain|all (day|night)|without (food|water))\b/, terms: ["animal", "abuse"], weight: 3, categories: ["Pets", "Safety & Crime"], family: "animal_abuse" },
  { when: /\b(illegal hotel|airbnb|short[- ]term rental|vacation rental|renting (it|rooms?|the apartment) (out )?(by the night|nightly|to tourists))\b/, terms: ["short", "term", "rental", "hotel"], weight: 3, against: ["registration"], categories: ["Buildings & Property", "Safety & Crime"], family: "illegal_hotel" },
  // Beta retest 10 (2026-11-09): child care, lead paint, a security deposit, an overcharge.
  // Child Care Complaint (KA-02240): "a day care facility, child care provider, or after school program".
  { when: /\b(day ?cares?|daycares?|child ?care (centers?|providers?|programs?)|preschools?|nursery schools?|pre-?k)\b/, terms: ["child", "care", "complaint"], weight: 3, against: ["business", "tax", "performance", "financial", "pathways"], categories: ["Consumers"], family: "child_care" },
  // Lead Paint (KA-02134): "lead paint, peeling paint, or lead dust due to construction".
  { when: /\blead[- ]based\b|\blead (paint|dust|poison\w*|levels?)\b|\b(paint|dust)\b[^.]{0,70}\blead\b(?! (to|me|us|you|them|the way))|\blead\b[^.]{0,30}\b(paint|dust)\b/, terms: ["lead", "paint"], weight: 3, against: ["drinking", "water", "service", "line"], categories: ["Tenants"], family: "lead" },
  // Rent Security Deposits and Interest (KA-01616).
  { when: /\bsecurity deposits?\b|\b(my|the) deposit back\b/, terms: ["rent", "security", "deposit"], weight: 3, categories: ["Tenants"], family: "deposit" },
  // Overcharge (KA-02136): "a business charging more than the posted or advertised price".
  // Criminal Mischief (KA-01537): "vandalism, or criminal activity that has damaged property". A
  // car window smashed overnight is a crime that is over: the crime pointer answers it (a
  // precinct report), not a 911 first line (articleSays911).
  { when: VEHICLE_DAMAGE, unless: /\b(accident|crash\w*|hit and run|collision|tree fell|branch fell)\b/, terms: ["criminal", "mischief", "vandalism", "damaged", "property"], weight: 3, against: ["parked", "parking", "driveway", "commercial", "stored"], categories: ["Safety & Crime"], family: "vandalism" },
  // Tow Truck Complaint (KA-02149).
  { when: /\btow(ed|ing)?\b[^.]{0,40}\b(overcharg\w*|charg\w*|fees?|rude|damag\w*|illegal\w*|private lot|without)\b|\b(tow truck|towing company|tow company)\b/, terms: ["tow", "truck", "complaint"], weight: 3, against: ["guide", "reclaim"], categories: ["Consumers"], family: "tow" },
  { when: /\bovercharg\w*|\bcharg(ed|es|ing) (me )?(more|extra|double|twice)\b|\bmore than the (posted|advertised|shelf|listed|marked) price\b|\bprice (on the shelf|tag) (was|is) (different|lower)\b/, unless: /\btow(ed|ing)?\b/, terms: ["overcharge"], weight: 3, categories: ["Consumers"], family: "overcharge" },
  // A dead animal on private property (a roof, a fire escape, a yard): Dead Animal on Private
  // Property (KA-03451), an information page, so never strong.
  { when: DEAD_ANIMAL, onlyIf: (t) => /\b(roofs?|rooftops?|fire escapes?|balcon(y|ies)|terraces?|yards?|backyards?|porch(es)?|stoops?|window ?sills?|air ?conditioners?)\b/.test(t), terms: ["dead", "animal", "private", "property"], weight: 3, against: ["public"], categories: ["Pests & Wildlife"], family: "dead_animal" },
  // Vacant Building Complaint (KA-01901): an abandoned or open building, not a vehicle.
  { when: /\b(abandoned|vacant|empty|derelict|boarded[- ]up)\b[^.]{0,10}\b(buildings?|houses?|homes?|properties|property|stores?)\b/, onlyIf: (t) => /\b(open|unsecured|unlocked|squatt\w*|people (are )?(living|going|sleeping|hanging out)|doors?|windows?|falling apart|collapsing|fire hazard|break(ing)? in|kids (go|get) in|junkies|drug use)\b/.test(t) && !/\b(sidewalk|curb|street)\b[^.]{0,30}\b(crumbl\w*|crack\w*|broken)\b/.test(t), terms: ["vacant", "building", "complaint"], weight: 3, against: ["lot", "vehicle", "land"], categories: ["Buildings & Property"], family: "vacant_building" },
  // Dog or Animal Waste (KA-02247), a gym membership (KA-01558), a dry cleaner (KA-02186), a dog run's gate.
  { when: /\b(pick(s|ing)? up after (their|his|her|the) dogs?|dog (poop|waste|mess|feces|droppings|doo-?doo|crap|shit))\b/, terms: ["dog", "animal", "waste"], weight: 3, against: ["noise", "license"], categories: ["Sidewalks", "Pets", "Cleaning"], family: "dog_waste" },
  { when: /\b(gyms?|health (club|spa)|fitness (center|club))\b[^.]{0,40}\b(membership|cancel\w*|charg\w*|contract|refund)\b|\bcancel (my )?(gym )?membership\b/, terms: ["gym", "membership", "complaint"], weight: 3, categories: ["Consumers"], family: "gym" },
  { when: /\bdry cleaners?\b/, unless: /\b(smell\w*|odor|fumes|chemical)\b/, terms: ["dry", "cleaner", "complaint"], weight: 3, against: ["odor"], categories: ["Consumers"], family: "dry_cleaner" },
  { when: /\bdog runs?\b/, onlyIf: (t) => /\b(gate|fence|broken|doesn'?t close|won'?t close|dirty|lights?|water|surface)\b/.test(t), terms: ["park", "maintenance"], weight: 3, against: ["unleashed", "license"], categories: ["Parks & Recreation"], family: "park_maintenance" },
  // A street that was never plowed: Snow or Ice on Street or Highway (KA-02296).
  { when: /\b(never|wasn'?t|hasn'?t been|not|haven'?t) (been )?plow\w*|\bunplowed\b|\bplow(s|ed)? (never|didn'?t|skipped)\b/, unless: /\bsidewalks?\b/, terms: ["street", "highway", "snow"], weight: 3, against: ["sidewalk", "building"], categories: ["Streets & Highways"], family: "snow" },
  // A fire escape that is rusted, loose or broken: Apartment Maintenance Complaint (KA-01074, "Safety issues, such as fire escape ...").
  { when: /\bfire escapes?\b[^.]{0,30}\b(rust\w*|wobbl\w*|loose|broken|crack\w*|collaps\w*|falling apart|damaged|unsafe|shaky)\b/, terms: ["apartment", "maintenance"], weight: 3, against: ["heat", "blocked", "exit"], categories: ["Tenants"], family: "repair" },
  // Noise from Lawn Equipment (KA-01101).
  { when: /\b(leaf ?blowers?|lawn ?mowers?|weed ?whackers?|landscap\w* (equipment|crew)|hedge trimmers?)\b/, terms: ["noise", "lawn", "equipment"], weight: 3, against: ["park", "rules"], categories: ["Noise"], family: "noise" },
  // Catch Basin Complaint (KA-01084): a sewer grate or catch basin clogged or broken.
  { when: /\b(sewer grates?|storm drains?|catch basins?|street drains?|drains? (on|in) (my|the) (street|corner|block))\b[^.]{0,30}\b(clogged|blocked|full|backed up|covered|broken|missing|caved)\b|\b(clogged|blocked) (sewer|storm drain|catch basin|street drain)/, terms: ["catch", "basin", "complaint"], weight: 3, against: ["odor", "apartment", "installation", "dumping"], categories: ["Streets & Highways", "Sidewalks", "Water"], family: "catch_basin" },
  // An animal stuck in a chimney, a wall or a vent: Wild Animal (KA-01790), not chimney smoke.
  { when: /\b(squirrels?|raccoons?|birds?|bats?|possums?|opossums?|animals?)\b[^.]{0,20}\b(stuck|trapped|living|nesting) in (my|the|our) (chimney|wall|walls|vent|attic|ceiling)\b/, terms: ["wild", "animal"], weight: 3, against: ["chimney", "smoke", "ventilation"], categories: ["Pests & Wildlife"], family: "wildlife" },
  // A rec center, a public pool or a park building with a repair problem: Park Maintenance
  // Complaint (KA-01060, "a maintenance problem in a City park, pool, recreation center").
  { when: /\b(rec(reation)? cent(er|re)s?|public pools?|park (building|house|field ?house)s?)\b/, onlyIf: (t) => /\b(no (hot )?water|no heat|cold water|broken|leak\w*|dirty|filthy|mold|out of order|locked|closed|flood\w*|lights? out|toilets?|showers?|locker rooms?)\b/.test(t), terms: ["park", "maintenance"], weight: 3, against: ["apartment", "residential", "heat"], categories: ["Parks & Recreation"], family: "park_maintenance" },
  // Injured or Sick Animal (KA-01789): an animal hurt, hit by a car, or sick (emergency.ts sends
  // these to the animal path, not the medical 911 line).
  { when: /\b(cats?|kittens?|dogs?|pupp(y|ies)|birds?|pigeons?|squirrels?|raccoons?|animals?|pets?|deer|geese|goose|ducks?|possums?|opossums?)\b[^.]{0,40}\b(hurt|injured|bleeding|limping|sick|dying|hit by a (car|truck|bus)|got hit|run over|broken (leg|wing))\b|\b(hurt|injured|bleeding|limping|sick|dying) (cat|kitten|dog|puppy|bird|pigeon|squirrel|raccoon|animal|pet|deer|goose|duck)s?\b/, unless: /\b(dead|like|as if|sounds like)\b/, terms: ["injured", "sick", "animal"], weight: 3, against: ["dead", "abuse", "bite", "waste"], categories: ["Pests & Wildlife", "Pets"], family: "injured_animal" },
  // Burning Garbage (KA-01518): "Call 911 to report burning garbage ...".
  { when: /\bburn(s|ed|ing)? (the |their |some )?(garbage|trash|tires|rubbish|leaves|wood|furniture)\b|\b(garbage|trash) (is |was )?(burning|on fire)\b/, terms: ["burning", "garbage"], weight: 3, categories: ["Safety & Crime", "Air"], family: "burning" },
  // Drag Racing (KA-02046).
  { when: /\b(drag|street) rac\w*|\bracing (down|up|on|through|in) (my|the|our)\b|\b(race|races|racing) (up and down|around) (my|the|our)\b|\bburnouts?\b|\bdoing donuts\b/, terms: ["drag", "racing"], weight: 3, categories: ["Safety & Crime"], family: "drag_racing" },
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
   * Where each weighted word came from, as units of evidence (strongEvidence): "c3:heat" for a
   * facet of word-list entry 3, "c3" for an entry whose words are synonyms (all one unit), or
   * a danger kind ("d:gas").
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
    for (const t of c.terms) add(t, c.weight ?? 2, c.synonyms ? from : `${from}:${stem(t)}`);
    for (const t of c.against ?? []) against.add(stem(t));
    for (const cat of c.categories ?? []) if (!categories.includes(cat)) categories.push(cat);
    if (c.family && !families.includes(c.family)) families.push(c.family);
    if (c.spanish) spanish = true;
  }
  // A danger adds its words and always searches Safety & Crime, where the City's "Call 911" articles are.
  // An animal attacking people is the City's Dangerous Animal article, not the general danger
  // one, though "attacking" is also a crime word.
  const ownArticle = danger.kinds.some((k) => k.id === "domestic_violence" || k.id === "dangerous_animal");
  for (const k of danger.kinds) {
    // Domestic violence or a dangerous animal: the City's own article, not the general danger one.
    problemSources.add(`d:${k.id}`);
    if (!(ownArticle && k.id === "crime")) for (const t of k.terms) add(t, 3, `d:${k.id}:${stem(t)}`);
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
  { id: "highway", said: HIGHWAY, option: /\bhighway\b/i, isPublic: true, venue: true },
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
/**
 * Words that name a domain of City service. When the description uses one and the best article's
 * title and summary never do, the match rests on other words and is never strong. Stage 10 stress
 * set (2026-11-09): "a school bus driver was speeding" got Buses and Subways, "I got a parking
 * ticket" Illegal Parking, "a notario took my money" Stolen Property, all rated strong.
 */
const DOMAIN_WORDS: [RegExp, RegExp][] = [
  [/\bschools?\b/, /\bschool/i],
  [/\b(tickets?|summons(es)?)\b/, /\b(ticket|summons|violation)/i],
  [/\b(immigra\w*|immigrants?|notarios?|asylum|green card|visa|citizenship)\b/, /\bimmigra/i],
  [/\b(snap|ebt|food stamps|cash assistance|medicaid|medicare|wic|benefits?)\b/, /\b(snap|ebt|cash assistance|medicaid|medicare|benefit)/i],
  [/\b(tax|taxes|refunds?)\b/, /\b(tax|refund)/i],
  [/\b(idnyc|id card)\b/, /\bidnyc/i],
  [/\b(access-?a-?ride|paratransit)\b/, /\b(access-a-ride|paratransit|accessible)/i],
  [/\b(vouchers?|cityfheps|fheps|section 8|scrie|drie|rent freeze)\b/, /\b(voucher|fheps|section 8|rent freeze|scrie|drie)/i],
  [/\b(insurance|insurer)\b/, /\binsurance/i],
  [/\b(ferry|ferries)\b/, /\bferr(y|ies)/i],
  [/\b(day ?cares?|daycares?|child ?care|preschools?|nursery schools?)\b/, /\b(child care|day care)/i],
  [/\b(ambulances?|emts?|paramedics?)\b/, /\bambulance/i],
];
export function domainMismatch(text: string, a: ArticleSummary): boolean {
  const on = `${a.title} ${a.description}`;
  // A school named as a place ("in front of the school", "at the school corner") is a location, not the domain.
  const t = text.replace(/\b(near|in front of|outside|by|at|across from|next to|around|behind) (the |a |my \w+'?s? )?school( corner| zone| building| entrance)?\b/g, " ");
  return DOMAIN_WORDS.some(([said, own]) => said.test(t) && !own.test(on));
}

/** A summary that only informs: it starts "Learn", "Get", "Apply", ... and offers no report or complaint. */
export const isInfoOnly = (summary: string) => INFORMATIONAL.test(summary) && !/\b(report|complain\w*|complaint)\b/i.test(summary);

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
  // A "Call 911" article is lifted only when it shares a word with the danger detected: a gun
  // threat lifted Cannabis Sale Outside, another 911 article, into the alternatives (beta retest 10).
  // It must be the City's article for the danger (its title), or name it in its title in two
  // words or more: one shared word ("outside", "dangerous") is not the danger.
  const dangerTerms = new Set(q.danger.kinds.flatMap((k) => k.terms.map(stem)));
  const forDanger = q.danger.kinds.some((k) => k.city?.test(a.title)) || [...title].filter((t) => dangerTerms.has(t)).length >= 2;
  if (call911) score += q.danger.kinds.length && forDanger ? 6 : -3;
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
 * Evidence is counted in units, not words. An entry whose words are synonyms (Concept.synonyms)
 * is one unit: "dirty" adds dirty, litter and trash, and an article sharing two of them (Litter
 * Basket Complaint) was rated strong for "bathroom in my house is dirty" (beta retest 6). Other
 * entries' words are facets, one unit each: "skipped our garbage pickup" adds missed and
 * collection, and Missed Trash, Recycling, or Compost Collection shares both. (Beta retest 7:
 * counting every entry as one unit dropped that, "rodents in my building" and "a homeless
 * person on my block needs help" to "close call".) And the evidence must include the problem
 * itself (an entry with a family, or a danger): context alone (a vehicle, a building, a
 * street) is never strong. "landlord didn't install a carbon monoxide detector" was rated
 * strong for Vehicle Stored on Residential Property on "car" (inside "carbon") plus
 * "residential" (from "landlord").
 *
 * Strong, then, is two units that include a problem, or one problem unit whose words few
 * titles in the pool share. One unit whose words several titles share ("construction" in
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
  if (![...units].some((u) => q.problemSources.has(sourceOf(u)))) return false;
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
/** The entry a unit of evidence belongs to: "c12:heat" → "c12"; "d:gas:leak" → "d:gas". */
function sourceOf(unit: string): string {
  const p = unit.split(":");
  return p[0] === "d" ? `d:${p[1]}` : p[0];
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
/** An authority named in the text: "the Metropolitan Transportation Authority (MTA)" (beta retest 7: subway answers named no agency). */
const AUTHORITY_IN_TEXT = /\b((?:[A-Z][A-Za-z&]+ )+Authority)\s\(([A-Z]{2,6})\)/g;
const AGENCY_IN_TEXT = /\b((?:Department|Office|Administration|Commission|Police Department|Fire Department) (?:of |for )?[A-Z][A-Za-z&'’ ]+?)\s\(([A-Z]{2,6})\)/g;

/**
 * Agencies an article's own text names, as "Name (ACRONYM)". A possessive is not part of
 * the name: "the Department of Housing Preservation and Development's (HPD) ..." is the
 * Department of Housing Preservation and Development (HPD). Beta retest 5, 2026-11-09:
 * the Carbon Monoxide article's agency carried the stray "'s".
 */
export function agenciesNamedIn(text: string): string[] {
  const found = [...text.matchAll(AGENCY_IN_TEXT), ...text.matchAll(AUTHORITY_IN_TEXT)];
  return [...new Set(found.map((m) => `${m[1].trim().replace(/^The /, "").replace(/['’]s?$/, "")} (${m[2]})`))];
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
    confidence_note: undefined as string | undefined,
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

export const NO_MATCH_LINE = "No 311 article matched this description. If anyone is in danger right now, call 911.";
export const EMERGENCY_CONFIDENCE = "strong: the City's own article for the danger detected; call 911 first";
export const EMERGENCY_CONFIDENCE_NOTE = "Call 911 first (first_line). This confidence rates only this 311 article as a follow-up, not the emergency.";

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

/**
 * Articles about abuse, sexual crimes, exploitation, suicide or hate, which must never be shown
 * on a generic word: each is matched only when the description uses its own words (or the
 * danger of the same kind was detected). Beta retest 9, 2026-11-09: "a child fell into the river
 * and is struggling" best-matched Child Pornography on the one word "child". Audited against
 * every article title in the recorded category lists (test/fixtures/content/GetContentList).
 */
export const SENSITIVE_ARTICLES: { title: RegExp; needs: RegExp }[] = [
  { title: /pornograph|sexual material|lewd|prostitut|obscen/i, needs: /\b(porn\w*|sexual\w*|sex|nude|naked|obscen\w*|lewd|explicit|expos(ed|ing) (him|her|them)sel(f|ves)|flash(ed|ing|er)|prostitut\w*|escorts?|solicit\w*|masturbat\w*)\b/ },
  { title: /sexual harassment/i, needs: /\bsexual\w*/ },
  { title: /sexual assault/i, needs: /\b(sexual\w*|rap(e|ed|ist|ing)|molest\w*|grop\w*|assaulted me sexually)\b/ },
  { title: /child abuse|elder abuse|animal abuse/i, needs: /\b(left|leaves|leaving|keeps?|kept) (his|her|their|a|the) (dogs?|cats?|pets?) (outside|out|chained|tied)\b|\b(abus\w*|neglect\w*|mistreat\w*|cruel\w*|starv\w*|beat(s|en|ing)? (the|my|his|her|their|a)|hits? (the|his|her|their|a) (kid|child|dog|cat|mother|father|grand\w*)|kick(s|ed|ing) (the|his|her|their|a) (dog|cat)|exploit\w*)\b/ },
  { title: /medicare fraud or abuse/i, needs: /\b(medicare|medicaid|fraud\w*|billing)\b/ },
  { title: /human trafficking/i, needs: /\b(traffick\w*|forced (labor|to work|prostitution)|held against (my|her|his|their) will|passport taken)\b/ },
  { title: /abandoned baby/i, needs: /\b(abandon\w*|left alone|dumped|safe haven)\b[^.]{0,40}\b(baby|babies|infant|newborn)\b|\b(baby|babies|infant|newborn)\b[^.]{0,40}\b(abandon\w*|left alone|dumped)\b/ },
  { title: /^suicide$|suicide prevention/i, needs: /\b(suicid\w*|kill(ing)? (my|him|her|them)sel(f|ves)|end (it all|(my|his|her|their) li(fe|ves))|want(s)? to die)\b/ },
  { title: /hate crime/i, needs: /\b(hate|hateful|racist|racial|slurs?|antisemit\w*|homophob\w*|transphob\w*|islamophob\w*|swastikas?|bias)\b/ },
  { title: /domestic violence/i, needs: /\b(domestic|husband|wife|boyfriend|girlfriend|partner|spouse|ex)\b/ },
  { title: /overdose/i, needs: /\b(overdos\w*|od'?(ing|ed)?|pills|drugs?|fentanyl|heroin|narcan|naloxone|unresponsive)\b/ },
  // Family, protective and end-of-life articles (beta retest 16: "Foster Care Agency Complaint"
  // was offered as an alternative for trash outside a daycare).
  { title: /foster care/i, needs: /\b(foster\w*)\b/ },
  { title: /adult protective|protective services/i, needs: /\b(protective|vulnerable adult|elderly|elder|exploit\w*|neglect\w*|abus\w*|can'?t care for)\b/ },
  { title: /death investigation/i, needs: /\b(died|dead|death|body|deceased|corpse|passed away)\b/ },
  { title: /funeral|cemetery/i, needs: /\b(funeral|cemetery|burial|grave|headstone|cremat\w*|died|death)\b/ },
  { title: /missing person/i, needs: /\b(missing|disappeared|can'?t find|hasn'?t come home|kidnap\w*|abduct\w*|lost (my|a) (child|kid|son|daughter))\b/ },
  { title: /runaway/i, needs: /\b(runaway|ran away|homeless youth|kicked out)\b/ },
  { title: /\bminors?\b/i, needs: /\b(minors?|kids?|teens?|teenagers?|under ?age|underage|children|students?)\b/ },
];
export function sensitiveAllowed(title: string, q: Pick<Query, "text"> & Partial<Pick<Query, "danger">>, summary = ""): boolean {
  const rule = SENSITIVE_ARTICLES.find((r) => r.title.test(title));
  if (rule && !rule.needs.test(q.text)) return false;
  // Someone hurt is a medical matter: never homeless outreach or another social service (beta
  // retest 11: "a bus hit a cyclist and he's lying in the street" got Homeless Outreach Assistance).
  const hurtDanger = (q.danger?.kinds ?? []).some((k) => ["hurt", "person_hit", "crash", "water_rescue", "tracks", "collapse", "trapped"].includes(k.id));
  if (SOCIAL_SERVICE.test(title) && (MEDICAL.test(q.text) || hurtDanger)) return false;
  // Violence between people is never a building repair (beta retest 12: a man beating a woman in
  // a stairwell got Heat or Hot Water).
  const violence = (q.danger?.kinds ?? []).some((k) => ["crime", "domestic_violence"].includes(k.id));
  if (violence && HOUSING_REPAIR.test(title)) return false;
  // A place that is not a home (a rec center, a school, a library, a gym, an office) never gets a
  // residential housing article (beta retest 14: a rec center's locker room with no hot water got
  // Heat or Hot Water Complaint in a Residential Building).
  if ((RESIDENTIAL_ARTICLE.test(title) || (HOME_REPAIR_SUMMARY.test(summary) && HOUSING_REPAIR.test(title))) && NOT_A_HOME.test(q.text) && !HOME_WORDS.test(q.text)) return false;
  return true;
}
/** Articles for homes: HPD's residential complaints. */
const RESIDENTIAL_ARTICLE = /residential|apartment|tenant|nycha/i;
/** A summary that is about a home: "an apartment, public area of a residential building". */
const HOME_REPAIR_SUMMARY = /\b(apartment|residential building|residential rental)\b/i;
/** Places that are not homes. */
const NOT_A_HOME = /\b(rec(reation)? cent(er|re)s?|community cent(er|re)s?|schools?|librar(y|ies)|gyms?|offices?|stores?|shops?|restaurants?|hospitals?|clinics?|church(es)?|mosques?|synagogues?|(in|at|of) (the |a )?(park|public pool)|subway|station|museum|courthouse|city hall|precinct|shelters?|hotels?|daycare|day care|senior cent(er|re)s?)\b/;
/** Words that say the place is a home. */
const HOME_WORDS = /\b(apartment|my (home|house|unit|building|room|bedroom|kitchen|bathroom)|landlord|super|tenant|rent|lease|nycha|residential)\b/;
/** Building repair articles, never an answer to violence. */
const HOUSING_REPAIR = /heat|hot water|maintenance|pest|mold|elevator|water leak|plumbing|boiler|window guard|lead paint|bed bug/i;
/** Social-service articles an injured person must not be sent to. */
const SOCIAL_SERVICE = /homeless|outreach|shelter|encampment|drop-in|wellness check/i;
/** Words that say someone is hurt or medically at risk. */
export const MEDICAL = /\b(injur\w*|hurt|bleeding|blood|unconscious|unresponsive|not (breathing|moving)|isn'?t (breathing|moving)|won'?t wake|seizures?|overdos\w*|hit by|struck by|run over|collapsed|broken (leg|arm|bones?)|ambulance)\b/;

/**
 * Under a detected danger, a follow-up article must fit the danger: share one of its words in its
 * title or summary ("gas" for a gas leak), or be the City's own article for it. Otherwise it is
 * left out, so a gas hiss "from the meter" never gets Parking Meter Complaint (beta retest 13).
 * Dangers with no search words of their own (water near electricity) leave the articles alone.
 */
export function fitsDanger(a: ArticleSummary, q: Pick<Query, "danger">): boolean {
  const withWords = q.danger.kinds.filter((k) => k.terms.length);
  if (!withWords.length) return true;
  if (q.danger.kinds.some((k) => k.city?.test(a.title))) return true;
  const own = new Set([...stems(a.title), ...stems(a.description)]);
  return withWords.some((k) => k.terms.some((t) => own.has(stem(t))));
}

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
    .filter((x) => sensitiveAllowed(x.a.title, q, x.a.description))
    .filter((x) => fitsDanger(x.a, q))
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
        // An article whose 911 is only for danger (CONDITIONAL_911) is never the strong answer
        // to a description with no danger in it (beta retest 8: a neighbor's loud party).
        const conditional911 = /^call 911\b/i.test(x.a.description) && CONDITIONAL_911.test(x.a.description) && !q.danger.kinds.length;
        // An information page, with nothing to report, is never the strong answer (beta retests 8
        // and 9: Bike Lane upkeep; Pigeon Droppings Health Effects for a neighbor feeding pigeons).
        const infoOnly = isInfoOnly(x.a.description);
        // A word naming another domain (a school, a ticket, a benefit, immigration) that the
        // article never mentions: the article is about something else (domainMismatch).
        const otherDomain = domainMismatch(q.text, x.a);
        const conf =
          !conditional911 && !infoOnly && !otherDomain && s1 >= 9 && s1 - s2 >= 2 && strongEvidence(q, x.a, ranked.map((r) => r.a), new Map(ranked.map((r) => [r.a.ka_number, r.score])))
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

/**
 * A "Call 911" summary whose 911 is conditional: "a large, loud party that has potential for
 * danger" (KA-01591), "a situation that might cause danger", "reckless driving in progress".
 * Such an article leads with 911 only when a danger was detected in the person's own words.
 * Beta retest 8, 2026-11-09: "loud party next door at 2am" led with the Large Party article's
 * "Call 911", rated strong, though nothing in it suggests danger.
 */
export const CONDITIONAL_911 = /\b(potential for danger|might cause danger|danger to life|in progress|dangerous|hazardous|threat\w*|endanger\w*|immediate)\b/i;

/** A crime told as done: "stole", "keyed", "smashed", "spray painted". */
const DONE_ACT = /\b(stole|keyed|smashed|slashed|broke|took|spray[- ]?painted|painted|wrote|tagged|damaged|vandalized|scratched|dented|robbed|burglarized)\b/;
/** Words that say a theft or damage is already over: found afterwards, overnight, while away. */
const OVER_ALREADY = /\b(overnight|this morning|while (i|we) (was|were) (away|asleep|out|at work|sleeping)|when (i|we) (got|came) (back|home|out)|(i|we) found|woke up (to|and)|in the morning)\b/;

/**
 * Whether the matched article's own "Call 911" leads the answer. Its 911 must be unconditional
 * (the City sends every such report to 911: a lockout, a drug sale), or a danger must have been
 * detected; and not for a crime the person says is over (the crime pointer answers that).
 */
export function articleSays911(summary: string, q: Pick<Query, "danger" | "text">): boolean {
  if (!/^call 911\b/i.test(summary)) return false;
  if (q.danger.kinds.length) return true;
  if (q.danger.past_crime || PAST.test(q.text) || OVER_ALREADY.test(q.text)) return false;
  // A pattern ("every weekend", "keeps") is reported, not called in as it happens; the article's
  // own 911 text is still in the answer (call_911).
  if (q.danger.recurring) return false;
  // So is a crime told in the past tense with nothing happening now ("someone keyed my car").
  if (DONE_ACT.test(q.text) && !/\b(right now|happening now|is (still )?(here|there|inside)|in progress)\b/.test(q.text)) return false;
  return !CONDITIONAL_911.test(summary);
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
  // An emergency answer's confidence (beta retest 8: every one read "close call", as if the 911
  // article tied with another). When the best match is the City's article for the danger
  // detected, it is the strong answer; otherwise the rating is for the 311 article as a
  // follow-up, and says so.
  if (emergency && lead) {
    if (emergency.ka_number && lead.ka_number === emergency.ka_number) lead.confidence = EMERGENCY_CONFIDENCE;
    else lead.confidence_note = EMERGENCY_CONFIDENCE_NOTE;
  }
  let first_line: string;
  if (emergency) {
    first_line = emergency.call_911;
  } else if (lead && articleSays911(lead.summary, q) && lead.confidence.startsWith("strong")) {
    first_line = lead.summary; // the matched article itself says to call 911 (e.g. "Drug Sale", "Illegal Eviction or Lockout")
  } else if (lead) {
    first_line = matchLine(lead);
  } else if (alternatives.length) {
    first_line = `Possible match: "${alternatives[0].title}" (${alternatives[0].ka_number}). Its details could not be read; open the link.`;
  } else {
    // A no-match answer still names 911, since the description may be an emergency the keywords
    // missed, but in words that are not an emergency's first line (beta retest 9: a reader of
    // first lines could not tell the two apart).
    first_line = NO_MATCH_LINE;
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
      "Find how to report a problem to 311, from a plain description ('a pothole on my block', 'no heat in my apartment'). Returns the best 311 articles from the City's own 311 content (title, KA number, link on 311 Online), the agency and the 311 problem type each names (the problem type is NYC Open Data's complaint_type), what the article says to do and what happens next, and the ways to report (311 Online, the NYC311 app, phone 311 or 212-NEW-YORK, text 311-692), all from City text. Every answer starts with '" + SAFETY_LINE + "'; a description that suggests danger, and every no-match answer, leads with a 911 line, in the City's words only when the City article is that danger. IMPORTANT: danger detection here is keyword-based and will miss some emergencies. If anything the person says suggests someone may be in danger or need urgent medical help, tell them to call 911 first, even if this tool did not flag it. Matching is by keyword, done by BetaNYC, and reads only a few 311 categories (listed in searched). Give community_district or council_district to add how often that problem type was reported there (BoardStat). Does not file anything.",
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
