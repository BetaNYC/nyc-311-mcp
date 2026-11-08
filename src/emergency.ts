// Danger and urgency in a plain description, for how_to_report (#17) and the report
// draft (#18). Safety comes first: the cost of a missed emergency is far higher than
// the cost of an unneeded 911 line, so every answer carries SAFETY_LINE, and a
// description that suggests danger leads with a 911 line.
//
// Wording rules (QA round 1 on #23):
//   - A 911 line quotes a City article only when that article's title is the danger
//     detected (DANGERS[].city): "Gas Leak" for a gas smell, never "Assault" for a
//     break-in. Otherwise the line is BetaNYC's own, and labeled so.
//   - The City articles quoted are in 311's Safety & Crime category (311-68); their
//     summaries begin "Call 911 to report ..." (recorded 2026-11-07).
//   - 988 is given for suicide and self-harm because the City's own Suicide article
//     (KA-01635, read 2026-11-07) says so: "When people call, text, or chat 988, they
//     will be connected to trained counselors".
//   - Where it is truly ambiguous (a crash with no word about injury), the answer
//     carries the standing line but does not lead with 911.

export const SAFETY_LINE = "If anyone is in danger right now, call 911.";
export const SAFETY_LINE_SOURCE = "BetaNYC wording, on every answer.";
export const GENERIC_911 = "If anyone is in danger right now, call 911. 311 is for problems that are not emergencies.";

export type DangerKind = {
  id: string;
  label: string;
  when: RegExp;
  /** Matches that are not this danger ("smoke cigarettes", "no one was hurt"). */
  unless?: RegExp;
  /** The title of the City "Call 911" article that may be quoted for it. */
  city?: RegExp;
  /** Search words for 311 articles. */
  terms: string[];
};

const PAST = /\b(yesterday|last (night|week|month|year|weekend)|days? ago|weeks? ago|months? ago|earlier (today|this week)|the other day)\b/;

export const DANGERS: DangerKind[] = [
  {
    id: "fire",
    label: "fire",
    when: /\b(on fire|fire\b(?!\s*(hydrant|escape|alarm box|extinguisher|department|code|safety|truck|house|station|inspection|exit|drill|pit|place|lane|zone|works?))|flames?|blaze|incendio|fuego|something('s| is) burning|(house|building|car|apartment|kitchen) is burning)/,
    unless: /\b(fireplace|fireworks?|fired (me|him|her|them)|ceasefire|campfire)\b/,
    city: /^Fire Emergency$/,
    terms: ["fire", "emergency"],
  },
  {
    id: "smoke",
    label: "smoke",
    when: /\b(smoke (is )?(coming|pouring|billowing|filling|everywhere)|(full of|filled with|lots of|thick|black|heavy) smoke|smoke from (the|a|my|our|their) (building|apartment|window|vent|roof|basement|hallway)|humo)\b/,
    unless: /\b(smok(e|es|ing) (a |the )?(cigarettes?|cigars?|weed|marijuana|pot|vapes?|hookah|joints?|blunts?)|cigarette smoke|smoke[- ]free|second[- ]?hand smoke)\b/,
    city: /^Smoke or Fumes$/,
    terms: ["smoke", "fumes"],
  },
  {
    id: "gas",
    label: "a gas smell or leak",
    when: /\b(gas (smell|leak|odor|odour)|smells? (of|like) gas|smell(ing)? (of )?gas|gas is leaking|leaking gas|olor a gas|fuga de gas)\b/,
    city: /^Gas Leak$/,
    terms: ["gas", "leak"],
  },
  {
    id: "carbon_monoxide",
    label: "carbon monoxide",
    when: /\b((carbon monoxide|co)( (detector|alarm|monitor|sensor))? (is |keeps |started |has been )?(going off|beeping|sounding|ringing|alarming|went off)|carbon monoxide (leak|poisoning|in|from|smell)|(detector|alarm) (says|shows|reads) (carbon monoxide|co))\b/,
    city: /^Carbon Monoxide$/,
    terms: ["carbon", "monoxide"],
  },
  {
    id: "electric",
    label: "downed wires or sparking",
    when: /\b(((power|electric(al)?|live|utility) )?(lines?|wires?|cables?) (is |are |has |have )?(down|fell|fallen|falling|sparking|arcing|smoking|on the (ground|street|sidewalk))|down(ed)? (power |electric(al)? |live |utility )?(lines?|wires?|cables?)|(power|electric) lines? down|sparking|sparks (are )?(coming|flying|shooting)|cables? sueltos?)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "explosion",
    label: "an explosion",
    when: /\b(explo(sion|ded|des|ding)|blew up|explosi[oó]n)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "water_electric",
    label: "water near electricity",
    when: /\b(water|flood\w*|leak\w*)\b[^.]{0,40}\b(outlets?|electrical|electric|wires?|wiring|panel|breaker)\b|\b(outlets?|electrical|wiring|panel|breaker)\b[^.]{0,40}\b(water|flood\w*|wet)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "crime",
    label: "a crime in progress",
    when: /\b(being (robbed|mugged|attacked|stabbed|shot|assaulted|beaten|followed)|getting (robbed|mugged|attacked|stabbed|shot|beaten|jumped)|break(ing)? (in|into)|broke into|breaking-in|burglar\w*|robbery|robbing|mugging|stabb\w*|shoot(ing|er)|shots? (fired|being fired)|gun ?(fire|shots?)|(has|with|pulled|waving|holding|carrying) (a |out a )?(gun|knife|weapon)|guns?|weapons?|knife|knives|assault\w*|attack(ing|ed)?|fight(ing)? (outside|in the street|right now|in the hallway)|domestic violence|beating (him|her|them|someone|somebody|me)|robando|asalt\w*|pistola)\b/,
    unless: /\b((toy|nail|glue|water|squirt|heat|caulk(ing)?|staple|spray) guns?|gun (permit|license|laws?)|knife sharpening)\b/,
    city: /^(Assault|Gunshot)$/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "hurt",
    label: "someone hurt or in medical danger",
    when: /\b(hurt|injured|injury|injuries|bleeding|unconscious|not breathing|can'?t breathe|passed out|collapsed|seizure|heart attack|overdos\w*|choking|fainted|not moving|herid[oa]s?|sangrando|inconsciente|no respira)\b/,
    unless: /\b(no ?one|nobody|no body|none of us|not|wasn'?t|weren'?t|isn'?t|aren'?t|without|didn'?t)\s+(\w+\s+){0,2}(hurt|injur\w*)\b/,
    city: /^(Medical Emergency|Overdose)$/,
    terms: ["medical", "emergency"],
  },
  {
    id: "crash",
    label: "a crash with someone hurt",
    // A crash alone is ambiguous ("my car was hit"): it leads with 911 only with "hurt" (below).
    when: /\b(hit by a (car|truck|bus|vehicle|bike|cyclist|scooter)|run over|crash(ed)?|collision|accident)\b/,
    city: /^Accident with Injury$/,
    terms: ["accident", "injury"],
  },
  {
    id: "child",
    label: "a child alone or someone missing",
    when: /\b(child|children|kid|kids|baby|toddler|infant|niño|niña)\b[^.]{0,30}\b(alone|unattended|locked in|in a hot car|left in)\b|\bhot car\b|\b(missing|lost|kidnapp?\w*|abduct\w*) (child|kid|person|son|daughter|baby|girl|boy)\b|\b(child|kid|person|son|daughter|baby|girl|boy|mom|dad|mother|father) (is |has gone |went )?missing\b|\b(kidnapp?\w*|abduct\w*)\b/,
    city: /^Missing Person$/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "suicide",
    label: "suicide or self-harm",
    when: /\b(suicid\w*|kill (my|him|her|them)sel(f|ves)|self[- ]harm\w*|hurt(ing)? (my|him|her|them)sel(f|ves)|end (my|his|her|their) li(fe|ves)|want(s)? to die|quitarse la vida)\b/,
    city: /^Suicide$/,
    terms: ["suicide"],
  },
  {
    id: "collapse",
    label: "a collapse",
    when: /\b(building|ceiling|wall|roof|scaffold\w*|balcony|stairs?|staircase|floor|facade|façade|crane|sidewalk shed)\b[^.]{0,20}\b(collaps\w*|caving in|caved in|falling down|about to (fall|collapse)|is falling|fell (in|down))\b|\bcollapse\b|\bderrumb\w*/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "trapped",
    label: "someone trapped",
    when: /\b(trapped|stuck in (an |the |a )?elevator|(someone|somebody|people|person|kid|child|man|woman) (is |are )?stuck|atrapad[oa]s?)\b/,
    terms: ["dangerous", "situation", "location"],
  },
];

/** The City's 988 sentence, from KA-01635 (Suicide), read 2026-11-07. */
export const CITY_988 = {
  text: "When people call, text, or chat 988, they will be connected to trained counselors that are part of the existing Lifeline network.",
  ka_number: "KA-01635",
  url: "https://portal.311.nyc.gov/article/?kanumber=KA-01635",
};

const NOT_EMERGENCY = /\b(not an emergency|non[- ]?emergency|no emergency|isn'?t an emergency|not urgent|no es una emergencia)\b/;
const URGENT = /\b(urgent|emergency|emergencia|right now|immediately|asap|help me|please help|dangerous|danger|peligro\w*)\b/;

export type DangerAssessment = {
  /** Danger kinds found, in DANGERS order. Empty when none, or when the person said it is not an emergency. */
  kinds: DangerKind[];
  /** Words in the description that suggested each kind. */
  suggested_by: string[];
  /** A past crime ("robbed last week"): no 911 lead, a pointer to the City's crime tip and precinct articles. */
  past_crime: boolean;
  /** The person said it is not an emergency. */
  not_emergency: boolean;
  /** An urgent word with no recognized danger: a no-match answer leads with 911. */
  urgent: boolean;
};

/** Normalize as the matcher does: lower case, curly apostrophes straight, single spaces. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

export function assessDanger(description: string): DangerAssessment {
  const text = normalize(description);
  const found: DangerKind[] = [];
  const by: string[] = [];
  for (const k of DANGERS) {
    const m = text.match(k.when);
    if (!m) continue;
    if (k.unless && k.unless.test(text) && !otherMatch(text, k)) continue;
    found.push(k);
    by.push(m[0].trim());
  }
  const notEmergency = NOT_EMERGENCY.test(text);
  let kinds = found;
  // A crash alone is ambiguous ("my car was hit"): it counts only with someone hurt,
  // or a person hit ("hit by a car", "run over").
  if (kinds.some((k) => k.id === "crash") && !kinds.some((k) => k.id === "hurt") && !/\b(hit by a|run over)\b/.test(text)) {
    kinds = kinds.filter((k) => k.id !== "crash");
  }
  // A crime word with a past-time word is a past crime: a pointer, not a 911 lead.
  const pastCrime = kinds.some((k) => k.id === "crime") && PAST.test(text) && !/\bright now\b|\bhappening\b/.test(text);
  if (pastCrime) kinds = kinds.filter((k) => k.id !== "crime");
  if (notEmergency) kinds = [];
  return {
    kinds,
    suggested_by: notEmergency ? [] : by.filter((_, i) => kinds.includes(found[i])),
    past_crime: pastCrime,
    not_emergency: notEmergency,
    urgent: !notEmergency && URGENT.test(text),
  };
}

/** For "unless" rules: does the danger word appear again outside the excused phrase? */
function otherMatch(text: string, k: DangerKind): boolean {
  if (!k.unless) return true;
  const rest = text.replace(new RegExp(k.unless.source, "g"), " ");
  return k.when.test(rest);
}

export type ArticleLike = { ka_number: string; title: string; description: string };

export type EmergencyLead = {
  call_911: string;
  /** Where the wording comes from: a City article, or BetaNYC. */
  source: string;
  ka_number: string | null;
  portal_url: string | null;
  suggested_by: string[];
  dangers: string[];
  also_988?: typeof CITY_988;
};

/**
 * The 911 line for a description, or null when it does not suggest danger.
 * `articles` are the City articles at hand (title and summary); one is quoted only
 * when its title is the City article for a detected danger and its summary starts
 * "Call 911".
 */
export function emergencyLead(a: DangerAssessment, articles: ArticleLike[], opts: { noMatch?: boolean } = {}): EmergencyLead | null {
  const kinds = a.kinds;
  if (!kinds.length) {
    if (opts.noMatch && a.urgent) {
      return { call_911: GENERIC_911, source: "BetaNYC wording: an urgent word, and no 311 article matched.", ka_number: null, portal_url: null, suggested_by: [], dangers: [] };
    }
    return null;
  }
  let quoted: ArticleLike | null = null;
  // Crash with someone hurt: the City's "Accident with Injury" before "Medical Emergency".
  const order = a.kinds.some((k) => k.id === "crash") && a.kinds.some((k) => k.id === "hurt") ? ["crash", ...kinds.map((k) => k.id)] : kinds.map((k) => k.id);
  for (const id of order) {
    const k = kinds.find((x) => x.id === id);
    if (!k?.city) continue;
    const hit = articles.find((x) => k.city!.test(x.title) && /^call 911\b/i.test(x.description) && titleFits(k, x.title, a));
    if (hit) {
      quoted = hit;
      break;
    }
  }
  const lead: EmergencyLead = quoted
    ? {
        call_911: firstSentence(quoted.description),
        source: `311 article ${quoted.ka_number} ("${quoted.title}"), https://portal.311.nyc.gov/article/?kanumber=${quoted.ka_number}`,
        ka_number: quoted.ka_number,
        portal_url: `https://portal.311.nyc.gov/article/?kanumber=${quoted.ka_number}`,
        suggested_by: a.suggested_by,
        dangers: kinds.map((k) => k.label),
      }
    : {
        call_911: GENERIC_911,
        source: "BetaNYC wording: no City article for this danger was at hand to quote.",
        ka_number: null,
        portal_url: null,
        suggested_by: a.suggested_by,
        dangers: kinds.map((k) => k.label),
      };
  if (kinds.some((k) => k.id === "suicide")) lead.also_988 = CITY_988;
  return lead;
}

/** "Call 911 to report carbon monoxide emission or poisoning. Learn about …" → the first sentence. */
function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]+[.!?]/);
  return m ? m[0] : text;
}

/** Within a kind with two City articles, the one the words point to. */
function titleFits(k: DangerKind, title: string, a: DangerAssessment): boolean {
  const said = a.suggested_by.join(" ");
  if (k.id === "crime") return title === "Gunshot" ? /shot|gun ?fire|shooting/.test(said) : /assault|attack|stabb|beat|asalt/.test(said);
  if (k.id === "child") return /missing|lost|kidnap|abduct/.test(said);
  if (k.id === "hurt") return title === "Overdose" ? /overdos/.test(said) : !/overdos/.test(said);
  return true;
}

/**
 * Where to turn for a crime that is not happening now, from the City's own articles
 * (read 2026-11-07): KA-02668 "Crime Stoppers Tip" ("You can anonymously report a tip
 * about a crime ... The City accepts tips regarding individuals wanted for past
 * felony crimes.") and KA-01027 "Police Precincts and PSAs" ("Find a precinct or
 * police service area (PSA) for a specific address.").
 */
export const CRIME_POINTER = {
  if_happening_now: "Call 911.",
  past_crime: [
    { title: "Crime Stoppers Tip", ka_number: "KA-02668", url: "https://portal.311.nyc.gov/article/?kanumber=KA-02668", says: "You can anonymously report a tip about a crime. The City accepts tips regarding individuals wanted for past felony crimes." },
    { title: "Police Precincts and PSAs", ka_number: "KA-01027", url: "https://portal.311.nyc.gov/article/?kanumber=KA-01027", says: "Find a precinct or police service area (PSA) for a specific address." },
  ],
  source: "311 articles KA-02668 and KA-01027 (summaries and text, read 2026-11-07). 'Call 911' for a crime in progress is BetaNYC wording.",
};

export const CRIME_WORDS = /\b(crime|criminal|police|cops?|nypd|robbed|stolen|theft|burglar\w*|vandal\w*|report a crime|denunciar|polic[ií]a|robo)\b/;
