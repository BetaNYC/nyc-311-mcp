// Turning what people type into the City's spelling of an address, so it can be
// matched exactly against BoardStat's addresses.parquet (Phase 1, #14).
//
// The core is a port of BoardStat's own address search (BoardStat v2/site/js/index.js,
// normalizeAddress), so this server and the BoardStat page find the same addresses:
//
//   - upper case, periods removed, spaces collapsed
//   - everything after the first comma dropped ("…, Brooklyn, NY 11222")
//   - a trailing ZIP code dropped. It is never used for anything: no ZIP codes (#12).
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
  /** Spellings to look up, the BoardStat-style one first. */
  spellings: string[];
  /** Text after the first comma, dropped (a borough or city name, usually). */
  dropped_after_comma: string | null;
  /** True when a trailing ZIP code was removed. Its value is never kept. */
  dropped_zip: boolean;
};

/** BoardStat's index.js normalizeAddress for a finished address, minus the ZIP code. */
function boardstatSpelling(input: string): {
  words: string[];
  base: string;
  droppedAfterComma: string | null;
  droppedZip: boolean;
} {
  let t = input.toUpperCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const zipMatch = /\b(\d{5})(?:-\d{4})?\s*$/.exec(t);
  const comma = t.indexOf(",");
  // A ZIP code in the dropped part is removed too: no ZIP code is ever returned.
  const droppedAfterComma =
    comma >= 0 ? t.slice(comma + 1).replace(/\b\d{5}(?:-\d{4})?\b/g, "").replace(/[\s,]+$/, "").trim() || null : null;
  t = comma >= 0 ? t.slice(0, comma).trim() : t;
  let droppedZip = false;
  if (zipMatch) {
    const re = new RegExp(`\\s*${zipMatch[1]}(?:-\\d{4})?$`);
    if (re.test(t)) t = t.replace(re, "").trim();
    droppedZip = true;
  }
  const base = t;
  const words = t
    .split(" ")
    .filter(Boolean)
    .map((w) => w.replace(/^(\d+)(ST|ND|RD|TH)$/, "$1"));
  if (words.length > 2 && /^\d/.test(words[0]) && DIRECTIONS[words[1]]) words[1] = DIRECTIONS[words[1]];
  const last = words.length - 1;
  if (last > 0 && SUFFIXES[words[last]]) words[last] = SUFFIXES[words[last]];
  return { words, base, droppedAfterComma, droppedZip };
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
 * gives ["350 5 AVENUE", "350 FIFTH AVENUE"] and reports the dropped ", NEW YORK, NY 10118".
 */
export function citySpellings(input: string): CitySpelling {
  const { words, base, droppedAfterComma, droppedZip } = boardstatSpelling(input);
  const spellings: string[] = [];
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
  return { spellings, dropped_after_comma: droppedAfterComma, dropped_zip: droppedZip };
}

/** Placeholder addresses in the City's data, not real places: "-999 RODNEY ST", "*** WEB/MAP CALL SOURCE". */
export function isPlaceholderAddress(address: string): boolean {
  return /^-\d/.test(address) || address.startsWith("*");
}
