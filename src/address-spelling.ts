// Turning what people type into the City's spelling of an address, so it can be
// matched exactly against BoardStat's addresses.parquet (Phase 1, #14).
//
// The core is a port of BoardStat's own address search (BoardStat v2/site/js/index.js,
// normalizeAddress), so this server and the BoardStat page find the same addresses:
//
//   - upper case, periods removed, spaces collapsed
//   - everything after the first comma dropped ("…, Brooklyn, NY 11222")
//   - a trailing ZIP code dropped. It is never used for anything: no ZIP codes (#12).
//   - (added here) trailing city, borough and state words without a comma dropped too
//     ("350 5th Ave New York NY 10118", "350 5th Ave Manhattan"); a borough named there
//     is offered as a hint to narrow the match
//   - ordinal endings dropped: 5TH → 5, 42ND → 42
//   - E/W/N/S right after the house number spelled out: 10 W 42 ST → 10 WEST 42 ST
//   - the street-type word expanded, only as the LAST word: AVE → AVENUE, ST → STREET.
//     "ST NICHOLAS AVENUE" keeps its ST, as the City writes it.
//
// One addition, from what the City's spelling in addresses.parquet actually looks like
// (2026-11-07 build): most numbered streets are written as digits ("1000 5 AVENUE",
// 187,399 requests on addresses with a "5" word), but some buildings are written with the
// word ("1295 FIFTH AVENUE", "1530 WEST EIGHTH STREET"), and some buildings appear BOTH
// ways ("350 5 AVENUE" and "350 FIFTH AVENUE"). So a numbered street from FIRST to
// TWELFTH is tried both as digits and as the word. Each spelling is a separate address
// in BoardStat; the answer says which spellings matched.
//
// Not attempted: aliases such as AVENUE OF THE AMERICAS = 6 AVENUE, or ADAM CLAYTON
// POWELL JR BOULEVARD = 7 AVENUE. Those are different strings in the City's data.

const SUFFIXES: Record<string, string> = {
  AVE: "AVENUE", AV: "AVENUE", ST: "STREET", STR: "STREET", RD: "ROAD", BLVD: "BOULEVARD", PL: "PLACE",
  DR: "DRIVE", PKWY: "PARKWAY", LN: "LANE", CT: "COURT", TER: "TERRACE", TERR: "TERRACE", HWY: "HIGHWAY",
  EXPY: "EXPRESSWAY", SQ: "SQUARE", PLZ: "PLAZA", CIR: "CIRCLE", TPKE: "TURNPIKE", BLV: "BOULEVARD",
};
const DIRECTIONS: Record<string, string> = { E: "EAST", W: "WEST", N: "NORTH", S: "SOUTH" };
const STREET_WORDS = new Set(Object.values(SUFFIXES));

const ORDINAL_WORDS = [
  "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH",
  "SEVENTH", "EIGHTH", "NINTH", "TENTH", "ELEVENTH", "TWELFTH",
];
const WORD_TO_NUMBER = new Map(ORDINAL_WORDS.map((w, i) => [w, String(i + 1)]));
const NUMBER_TO_WORD = new Map(ORDINAL_WORDS.map((w, i) => [String(i + 1), w]));

export type CitySpelling = {
  /** Spellings to look up, the BoardStat-style one first. Empty when no street is left (only a house number). */
  spellings: string[];
  /** Text that was dropped: after the first comma, and trailing city, borough or state words. ZIP codes removed. */
  ignored_text: string | null;
  /** True when a ZIP code was removed. Its value is never kept. */
  dropped_zip: boolean;
  /** A borough named in the dropped text ("…, Brooklyn" or "… Ave Manhattan"), if exactly one. */
  borough_hint: Borough | null;
};

export type Borough = "Manhattan" | "Bronx" | "Brooklyn" | "Queens" | "Staten Island";

// Place words people add after the street (", New York, NY 10118"; "… 5th Ave Manhattan").
// Each is a token sequence, matched at the END of the address only, so QUEENS BOULEVARD
// and NEW YORK AVENUE are left alone.
const PLACE_WORDS: { words: string[]; borough?: Borough }[] = [
  { words: ["STATEN", "ISLAND"], borough: "Staten Island" },
  { words: ["THE", "BRONX"], borough: "Bronx" },
  { words: ["BRONX"], borough: "Bronx" },
  { words: ["BROOKLYN"], borough: "Brooklyn" },
  { words: ["MANHATTAN"], borough: "Manhattan" },
  { words: ["QUEENS"], borough: "Queens" },
  { words: ["NEW", "YORK", "CITY"] },
  { words: ["NEW", "YORK"] },
  { words: ["NYC"] },
  { words: ["NY"] },
  { words: ["USA"] },
];
const ZIP_TOKEN = /^\d{5}(?:-\d{4})?$/;
const ZIP_ANYWHERE = /\b\d{5}(?:-\d{4})?\b/g;

function boroughsIn(text: string): Borough[] {
  const t = ` ${text.replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ")} `;
  const found = new Set<Borough>();
  for (const p of PLACE_WORDS) if (p.borough && t.includes(` ${p.words.join(" ")} `)) found.add(p.borough);
  // "New York" or "NY, NY" as the city is Manhattan's postal name. Only when no borough
  // is named ("…, Brooklyn, New York" is Brooklyn), and not "New York City" or "NYC",
  // which mean all five boroughs.
  if (!found.size && / NEW YORK (?!CITY )/.test(t.replace(/ NEW YORK CITY /g, " "))) found.add("Manhattan");
  if (!found.size && / NY NY /.test(t)) found.add("Manhattan");
  return [...found];
}

/** BoardStat's index.js normalizeAddress for a finished address, minus ZIP codes and trailing place words. */
function boardstatSpelling(input: string): {
  words: string[];
  base: string;
  ignored: string | null;
  droppedZip: boolean;
  boroughHint: Borough | null;
} {
  let t = input.toUpperCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const ignoredParts: string[] = [];
  let droppedZip = false;
  const comma = t.indexOf(",");
  if (comma >= 0) {
    ignoredParts.push(t.slice(comma + 1));
    t = t.slice(0, comma).trim();
  }
  // Trailing ZIP codes and place words, repeatedly ("350 5TH AVE NEW YORK NY 10118"),
  // keeping at least two words of street.
  let tokens = t.split(" ").filter(Boolean);
  const dropped: string[] = [];
  for (let changed = true; changed && tokens.length > 2; ) {
    changed = false;
    if (ZIP_TOKEN.test(tokens[tokens.length - 1])) {
      tokens = tokens.slice(0, -1);
      droppedZip = true;
      changed = true;
      continue;
    }
    for (const p of PLACE_WORDS) {
      const n = p.words.length;
      if (tokens.length - n >= 2 && tokens.slice(-n).join(" ") === p.words.join(" ")) {
        dropped.unshift(...p.words);
        tokens = tokens.slice(0, -n);
        changed = true;
        break;
      }
    }
  }
  if (dropped.length) ignoredParts.unshift(dropped.join(" "));
  // A five-digit word anywhere after the house number is a ZIP code, never a street.
  const kept = tokens.filter((w, i) => i === 0 || !ZIP_TOKEN.test(w));
  if (kept.length !== tokens.length) droppedZip = true;
  tokens = kept;
  t = tokens.join(" ");
  const ignoredRaw = ignoredParts.join(", ");
  if (ZIP_ANYWHERE.test(ignoredRaw)) droppedZip = true;
  ZIP_ANYWHERE.lastIndex = 0;
  // No ZIP code is ever kept or returned, including in the ignored text.
  const ignored = ignoredRaw.replace(ZIP_ANYWHERE, "").replace(/\s+,/g, ",").replace(/[\s,]+$/, "").replace(/^[\s,]+/, "").replace(/\s+/g, " ").trim() || null;
  const boroughs = ignored ? boroughsIn(ignored) : [];
  const base = t;
  const words = tokens.map((w) => w.replace(/^(\d+)(ST|ND|RD|TH)$/, "$1"));
  if (words.length > 2 && /^\d/.test(words[0]) && DIRECTIONS[words[1]]) words[1] = DIRECTIONS[words[1]];
  const last = words.length - 1;
  if (last > 0 && SUFFIXES[words[last]]) words[last] = SUFFIXES[words[last]];
  return { words, base, ignored, droppedZip, boroughHint: boroughs.length === 1 ? boroughs[0] : null };
}

/** Index of a numbered-street word: a number or ordinal word right before a street type. */
function numberedStreetIndex(words: string[]): number {
  for (let i = 1; i < words.length - 1; i++) {
    const next = words[i + 1];
    if (STREET_WORDS.has(next) && (NUMBER_TO_WORD.has(words[i]) || WORD_TO_NUMBER.has(words[i]))) return i;
  }
  return -1;
}

/**
 * The City spellings to try for what a person typed. "350 Fifth Ave., New York, NY 10118"
 * gives ["350 5 AVENUE", "350 FIFTH AVENUE"], reports "NEW YORK, NY" as ignored, and says a
 * ZIP code was dropped (without its value).
 */
export function citySpellings(input: string): CitySpelling {
  const { words, base, ignored, droppedZip, boroughHint } = boardstatSpelling(input);
  const spellings: string[] = [];
  // Nothing but a house number left ("730 11363" once the ZIP is removed): a lookup
  // would match stray records with no street, so there is nothing to look up.
  if (!words.some((w) => !/^[\d-]+$/.test(w))) {
    return { spellings, ignored_text: ignored, dropped_zip: droppedZip, borough_hint: boroughHint };
  }
  const add = (s: string) => {
    if (s && !spellings.includes(s)) spellings.push(s);
  };
  const i = numberedStreetIndex(words);
  if (i >= 0) {
    const digits = WORD_TO_NUMBER.get(words[i]) ?? words[i];
    const word = NUMBER_TO_WORD.get(digits) as string;
    add([...words.slice(0, i), digits, ...words.slice(i + 1)].join(" "));
    add([...words.slice(0, i), word, ...words.slice(i + 1)].join(" "));
  } else {
    add(words.join(" "));
  }
  // The text as typed (comma part and ZIP already removed), in case it is already the
  // City's spelling and one of the rules above changed it.
  add(base);
  return { spellings, ignored_text: ignored, dropped_zip: droppedZip, borough_hint: boroughHint };
}

/** Placeholder addresses in the City's data, not real places: "-999 RODNEY ST", "*** WEB/MAP CALL SOURCE". */
export function isPlaceholderAddress(address: string): boolean {
  return /^-\d/.test(address) || address.startsWith("*");
}
