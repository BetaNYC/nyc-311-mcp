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
//
// Disclaimers (Noel's decision, 2026-11-08, on #23):
//   - "Not an emergency" or "not urgent" quiets only ambiguous signals (smoke, a crash,
//     water near electricity, a shaking structure). It never quiets HIGH_SEVERITY: someone
//     hurt or not breathing, gas, carbon monoxide, fire, suicide or self-harm.
//   - A past-time word ("last night") quiets a crime only when nothing says the danger is
//     present: "still inside", "still here", "right now", or a named weapon keeps it.

/**
 * On every how_to_report and draft_311_report answer, first in the text and in the structured
 * output, whatever was or was not detected: the danger words will always miss some wording
 * (beta retest 11, 2026-11-09: eight emergencies happening now got no emergency block).
 */
export const SAFETY_LINE = "If someone is hurt or in danger right now, call 911. This tool can miss an emergency.";
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

/** Kinds a "not an emergency" disclaimer never quiets. */
export const HIGH_SEVERITY = new Set(["hurt", "gas", "carbon_monoxide", "fire", "suicide", "water_rescue"]);

/** Words that say a crime is not over, whatever past-time word is near: "still inside", a weapon. */
const PRESENT_DANGER = /\b(right now|happening|still (here|inside|there|in (there|here)|in (the|my|our|his|her|their) \w+)|(is|are|'s|'re) (inside|in (the|my|our) (house|apartment|home|building|room))|guns?|knife|knives|weapons?|pistola)\b/;

export const PAST = /\b(yesterday|last (night|week|month|year|weekend)|days? ago|weeks? ago|months? ago|earlier (today|this week)|the other day)\b/;

/** A vehicle, and a person, for "a bus hit a cyclist" and "a pedestrian was struck by a car". */
const VEHICLE = "(cars?|trucks?|bus(es)?|vans?|vehicles?|taxis?|cabs?|ubers?|drivers?|motorcycles?|scooters?|e-?bikes?|mopeds?|suvs?|garbage trucks?|ambulances?|police cars?)";
const PERSON = "(an? |the |my |his |her |our |some )?(cyclists?|bikers?|bicyclists?|pedestrians?|person|people|man|woman|men|women|kids?|child(ren)?|boy|girl|guy|lady|someone|somebody|delivery (worker|guy|man)|old (man|woman|lady)|students?|workers?|neighbor|son|daughter|mother|father|mom|dad|grandm\\w*|grandf\\w*)";
/** Someone forcing their way in, an intruder inside, someone following the person. */
const FORCED_ENTRY = [
  "(break|breaking|broke|kick|kicking|kicked|bust|busting|force|forcing|pry|prying|smash|smashing)\\w* (down|in|open|into|through) (my|the|our|her|his|their|a) (front |back |apartment |building |bedroom )?(doors?|windows?|apartment|house|home|place)",
  "(trying|tried|tries) to (break|kick|force|bust|pry) (in|into|down|open|through)",
  "(someone|somebody|a (man|guy|woman|stranger|person)|he|she|they|strangers?|people) (is |are |'s |keeps? )?(trying|tries|tried|jiggling|rattling|turning) (my|the|our) (front |back |apartment )?(doors?|doorknobs?|locks?|windows?)",
  "(trying|jiggling|rattling) (it|the (door|knob|handle|lock)) right now",
  "(someone|somebody|a (man|guy|woman|stranger|person)|strangers?|intruders?|people) (is |are |was |were |keeps? )?(trying|tried) to (get|climb|come) (in|into)",
  "(someone|somebody|a (man|guy|woman|stranger|person)|strangers?|an? intruders?|intruders?) (is |are |was |'s )?(in|inside|hiding in) (my|our|the) (apartment|house|home|room|bedroom|bathroom|closet|basement)",
  "(someone|somebody|a (man|guy|woman|stranger|person)|he|she|they) (is |are |'s |keeps? )?(following|stalking|chasing) (me|us|my (kid|son|daughter|child))",
  "(following|stalking) me (home|right now|down the street)",
  // A theft or break-in under way (stage 11 stress set).
  "(is |are |'s |keeps? )?(stealing|robbing|breaking into|breaking (car |the )?windows|smashing (car |the )?windows|trying to (open|steal|break into|get into) (car |the )?(doors?|cars?|windows?))",
].join("|");
const CRIME_WORDS_IN_PROGRESS = /\b(being (robbed|mugged|attacked|stabbed|shot|assaulted|beaten|followed)|getting (robbed|mugged|attacked|stabbed|shot|beaten|jumped)|break(ing)? (in|into)|broke into|(someone|somebody|he|she|they|a (man|guy|woman|person)|people|burglars?|thie(f|ves)) broke in\b|^broke in\b|broke in (last|yesterday|while|and|through|at)\b|breaking-in|burglar\w*|robbery|robbing|mugging|stabb\w*|shoot(ing|er)|shots?|gun ?(fire|shots?)|dragged into|being dragged|forced into a (car|van)|hitting (his|her|their|my|a) (wife|husband|girlfriend|boyfriend|partner|kids?|child|son|daughter|mother|mom|father|dad)|hitting (me|her|him|them)|(punching|kicking|slapping|choking|strangling|beating up|hitting|attacking) (people|someone|somebody|everyone|passengers|riders|(a|the|an|my|his|her) (man|woman|guy|kid|child|boy|girl|person|old (man|woman|lady)|driver|passenger))|(is |keeps )?beating (me|her|him|them|his|my)|threaten\w* (people|someone|somebody|me|us|him|her|them|to (kill|hurt|shoot|stab))|(has|with|pulled|waving|holding|carrying) (a |out a )?(gun|knife|weapon)|guns?|weapons?|knife|knives|assault\w*|attack(ing|ed)?|fight(ing)? (outside|in the street|right now|in the hallway)|domestic violence|beating (him|her|them|someone|somebody|me)|robando|asalt\w*|pistola)\b/;

/** A condition that recurs: a habit or a pattern, not one event in progress. */
export const RECURRING = /\b(every (single )?(morning|night|day|evening|afternoon|week|weekend|time|hour|weekday|sunday|saturday|friday)|every few (days|hours|minutes|nights|weeks)|each (morning|night|day|evening)|always|all the time|most (nights|days|mornings|evenings)|on weekends|daily|nightly|regularly|for (days|weeks|months|years)|constantly|usually|often|whenever|keeps? (on )?\w+ing|again and again|day after day|night after night)\b/;
/** Words that say a danger is happening now, which a recurrence word does not quiet. */
// Beta retest 11, 2026-11-09: the recurring rule switched off six emergencies said to be happening
// now ("…and now he isn't moving", "…and one just fell through"). Any of these, anywhere in the
// description, keeps every danger on: a missed emergency is far worse than an extra 911 line.
const HAPPENING_NOW = new RegExp(
  [
    "\\b(right now|happening now|now|at the moment|currently|this minute|as we speak|today|tonight|just|suddenly)\\b",
    "\\b(can'?t (breathe|get out|wake (him|her|them) up|move|swim)|isn'?t (breathing|moving|responding|waking)|not (breathing|moving|responding)|stopped breathing|won'?t (wake|move|respond)( up)?)\\b",
    "\\b(turning blue|bleeding|trapped|stuck inside|pinned|spreading|getting worse|on fire|flames|can'?t see|filling (up )?with|full of smoke|people (are )?(still )?inside|someone (is )?(still )?inside|help|screaming|yelling for|crying for)\\b",
    "\\b(is|are|'s|'re)\\s+(\\w+\\s+)?(filling|pouring|burning|smoking|bleeding|choking|drowning|falling|collapsing|sparking|attacking|fighting|shooting|stabbing|breaking|trying|spreading|sinking|lying|waving|threatening|chasing|following|hitting|beating|seizing|shaking|convulsing)\\b",
  ].join("|")
);
/** Smoke from wiring, an outlet, an appliance or a battery is a fire starting: never quieted. */
const ELECTRICAL_SMOKE = /\b(outlets?|sockets?|electrical|wiring|wires?|panel|breaker|fuse ?box|appliances?|chargers?|batter(y|ies)|e-?bikes?|scooters?|space heaters?|extension cords?|power strips?|boiler rooms?|meter rooms?|basement)\b/;
/** Hurt signals that may be sleep or a habit; the hard ones are never quieted. */
const SOFT_HURT = /\b(passed out|collapsed|fainted|not moving|unconscious|unresponsive)\b/;
const HARD_HURT = /\b(bleeding|not breathing|isn'?t breathing|stopped breathing|can'?t breathe|seizures?|heart attack|chest pains?|stroke|overdos\w*|choking|turning blue|injured|hurt)\b/;

export const DANGERS: DangerKind[] = [
  {
    id: "fire",
    label: "fire",
    when: /\b(on fire|fire\b(?!\s*(hydrant|escape|alarm box|extinguisher|department|code|safety|truck|house|station|inspection|exit|drill|pit|place|lane|zone|works?))|flames?|blaze|incendio|fuego|something('s| is) burning|(house|building|car|apartment|kitchen) is burning)/,
    // A building fire alarm that keeps going off for no reason is a noise complaint (stage 9 stress
    // set); any smoke or flame said with it is still a danger (the smoke kind, or "fire" again).
    unless: /\bfire alarms?\b[^.]{0,60}\b(every|whenever|each time|all the time|always|constantly|cook\w*|burnt|toast|shower\w*|steam)\b|\b(fireplace|fireworks?|fired (me|him|her|them)|ceasefire|campfire)\b|\bfire alarms?\b[^.]{0,40}\b(for no reason|false alarms?|keeps? going off|goes off all the time|always going off|every (day|night|morning|week)|constantly|randomly|chirp\w*|beep\w*)\b/,
    city: /^Fire Emergency$/,
    terms: ["fire", "emergency"],
  },
  {
    id: "smoke",
    label: "smoke",
    when: /\b(smoke (is |keeps |kept |has been |started )?(coming|pouring|billowing|filling|everywhere|rising)|(keeps |kept )?fill(s|ing|ed) (up )?with smoke|(full of|filled with|filling with|filling up with|lots of|thick|black|heavy) smoke|smoke (coming )?(out of|from) (the|a|my|our|their) (electrical )?(building|apartment|window|vent|roof|basement|hallway|outlet|socket|wall|panel|stove|oven)|(outlets?|sockets?|panel|wires?|wiring|stove|oven|microwave|space heaters?|heaters?|batter(y|ies)|chargers?|e-?bikes?|scooters?|toasters?|dryers?|appliances?|extension cords?|power strips?|laptops?|phones?)\b[^.]{0,25}\b(is |are |keeps |kept |started )?(smoking|smoldering)|smell(s)? (of|like) (smoke|something burning) (from|in) (the )?(outlet|wall|panel|walls)|humo)\b/,
    unless: /\b(smok(e|es|ing) (a |the )?(cigarettes?|cigars?|weed|marijuana|pot|vapes?|hookah|joints?|blunts?)|cigarette smoke|smoke[- ]free|second[- ]?hand smoke)\b/,
    city: /^Smoke or Fumes$/,
    terms: ["smoke", "fumes"],
  },
  {
    id: "gas",
    label: "a gas smell or leak",
    when: /\b(gas (smell|leak|odor|odour)|smells? (of|like) gas|smell(ing)? (of )?gas|gas is leaking|leaking gas|rotten eggs?|(reeks|stinks) (of|like) gas|huele a gas|smells? (of|like) sulfur|gas\b[^.]{0,40}\b(smell|odor)\w*|(smell|odor)\w*[^.]{0,30}\bgas\b(?! station)|olor a gas|fuga de gas)/,
    city: /^Gas Leak$/,
    terms: ["gas", "leak"],
  },
  {
    id: "carbon_monoxide",
    label: "carbon monoxide",
    when: /\b((carbon monoxide|co)( (detector|alarm|monitor|sensor))? (is |keeps |started |has been )?(going off|beeping|beeps?|sounding|ringing|alarming|went off|goes off)|carbon monoxide (leak|poisoning|in|from|smell)|(detector|alarm) (says|shows|reads) (carbon monoxide|co))\b/,
    city: /^Carbon Monoxide$/,
    terms: ["carbon", "monoxide"],
  },
  {
    id: "electric",
    label: "downed wires or sparking",
    when: /\b(((power|electric(al)?|live|utility) )?(lines?|wires?|cables?) (is |are |has |have )?(down|fell|fallen|falling|sparking|arcing|smoking|on the (ground|street|sidewalk))|down(ed)? (power |electric(al)? |live |utility )?(lines?|wires?|cables?)|(power|electric) lines? down|sparking|sparks?\b(?! plugs?)|live wires?|cables? sueltos?)\b/,
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
    when: /\b(water|flood\w*|leak\w*|pouring|dripping)\b[^.]{0,50}\b(outlets?|sockets?|electrical|electric|wires?|wiring|panel|breaker|light fixtures?|fixtures?|ceiling lights?|light)\b|\b(outlets?|sockets?|electrical|wiring|panel|breaker|light fixtures?)\b[^.]{0,40}\b(water|flood\w*|wet)\b/,
    // No search words of its own: the answer still finds the leak article.
    terms: [],
  },
  {
    // The City's Dangerous Animal article (KA-01538): "Call 911 to report animals that are
    // currently threatening or endangering people. This includes animals that are: Aggressive,
    // Ferocious, Vicious, Foaming at the mouth, Showing signs of rabies. Do not call 911 to file
    // a complaint about animals that have bitten other animals." Beta retest 7, 2026-11-09:
    // "a stray dog is roaming the block and looks aggressive" found no article.
    // Before "crime", so an animal attacking people quotes this article, not Assault.
    id: "dangerous_animal",
    label: "a dangerous animal",
    when: /\b(aggressive|vicious|ferocious|rabid|foaming at the mouth)\b[^.]{0,30}\b(dogs?|animals?|pit ?bulls?|raccoons?|coyotes?)\b|\b(dogs?|animals?|pit ?bulls?|raccoons?|coyotes?)\b[^.]{0,40}\b(aggressive|vicious|ferocious|rabid|foaming at the mouth|(lunging at|attacking|chasing|biting) (people|kids|children|someone|somebody|me|us|(a |the |my |our )?(child|kid|person|man|woman|boy|girl|baby|neighbor|jogger)))\b/,
    // The whole sentence is excused, so "a vicious dog bit my dog" is not a 911 case.
    unless: /[^.]*\b(bit|bitten|attacked|attacking)\b[^.]{0,20}\b(my|a|the|another|other|our|his|her|their) (dogs?|cats?|pets?)\b[^.]*/,
    city: /^Dangerous Animal$/,
    terms: ["dangerous", "animal"],
  },
  {
    id: "crime",
    label: "a crime in progress",
    // Forced entry, an intruder, being followed (beta retest 9, 2026-11-09: "someone is trying to
    // break down my front door right now" got Apartment Maintenance and no 911).
    when: new RegExp(`\\b(${FORCED_ENTRY})\\b|${CRIME_WORDS_IN_PROGRESS.source}`),
    unless: /\b(dogs?|cats?|animals?)\b[^.]{0,20}\b(attack(ed|ing|s)?|bit|bitten|bites|biting)\b[^.]{0,10}\b(my|a|the|our|another|other|his|her|their) (dogs?|cats?|pets?|puppy|kitten)\b|\b((toy|nail|glue|water|squirt|heat|caulk(ing)?|staple|spray) guns?|gun hill|gun (permit|license|laws?)|knife sharpening|gun (stores?|shops?|ranges?|shows?)|shot glass(es)?|shots? of (espresso|tequila|whiskey|vodka|liquor)|(flu|covid|vaccine|booster|allergy) shots?|(photo|camera|great|nice) shots?|shot (a |the )?(photo|picture|video)|(sparks?|water|flames?|smoke|steam)\w* (is |are )?shooting out|shooting out of|shoot(ing)? (a |the )?(videos?|photos?|pictures?|film|a film|movies?|scenes?|commercials?|hoops|pool|the breeze)|(video|photo|film|movie) shoot\w*|threaten\w* to (evict|sue|call|report|raise|tow|fine|cut))\b/,
    city: /^(Assault|Gunshot)$/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "hurt",
    label: "someone hurt or in medical danger",
    when: /\b(hurt|injured|injury|injuries|bleeding|unconscious|unresponsive|not breathing|isn'?t breathing|stopped breathing|can'?t breathe|trouble breathing|passed out|collapsed|seizures?|heart attack|chest pains?|stroke|face (is )?drooping|allergic reaction|anaphyla\w*|throat (is )?(swelling|closing)|too many pills|took (a bunch of|all) (the |his |her |my )?pills|won'?t wake up|wont wake up|can'?t wake (him|her|them) up|overdos\w*|od'?ing|odeing|choking|fainted|not moving|isn'?t moving|won'?t move|turning blue|(isn'?t|not) responding|swallowed (a |an |some )?(battery|batteries|bleach|poison|magnets?|pills)|poisoned|fell (out of|off|from) (a |the |his |her |my )?(window|roof|fire escape|scaffold\w*|balcony|ledge|building|stairs)|se cay[oó]|fell and (can'?t|cannot|can not) get up|(he|she|they|i|someone|mom|dad) can'?t (talk|speak|breathe)|herid[oa]s?|sangrando|inconsciente|no respira)\b/,
    unless: /\b(no ?one|nobody|no body|none of us|not|wasn'?t|weren'?t|isn'?t|aren'?t|without|didn'?t)\s+(\w+\s+){0,2}(hurt|injur\w*)\b/,
    city: /^(Medical Emergency|Overdose)$/,
    terms: ["medical", "emergency"],
  },
  {
    id: "crash",
    label: "a crash with someone hurt",
    // A crash alone is ambiguous ("my car was hit"): it leads with 911 only with "hurt" (below).
    when: /\b(hit by a (car|truck|bus|vehicle|bike|cyclist|scooter)|run over|crash(ed)?|collision|accident|flipped (over)?|overturned|rolled over)\b/,
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
    when: /\b(suicid\w*|kill(ing)? (my|him|her|them|your)sel(f|ves)|self[- ]harm\w*|hurt(ing)? (my|him|her|them)sel(f|ves)|cutting (my|him|her|them)sel(f|ves)|(is|been|keeps|started|am|i'?m) cutting\b|end (it all|(my|his|her|their) li(fe|ves))|ending it all|want(s)? to die|(do(es)?n'?t|do(es)? not) want to (live|be alive|be here anymore|wake up)|better off dead|jump(ing)? off (a |the |of )?(bridge|roof|building|ledge)|overdos\w* on purpose|say(ing)? goodbye forever|no reason to live|nothing to live for|quitarse la vida|(just )?want(s)? to (sleep|go to sleep) forever|(what'?s|what is) the point (of|in) (living|life|going on)|(thinking|thought) (about|of) ending it\b|(going|planning) to end it\b|want(s)? to disappear forever|pills and (i'?m|i am) done|(wrote|writing|written|left) (a |my )?goodbye (letter|note)s?|goodbye (letter|note)s? to|cut(ting)? (my|him|her|them)sel(f|ves)|no reason to (keep going|go on|keep living)|wish (i|he|she) (wouldn'?t|won'?t|didn'?t|would not|will not|did not) wake up|(if|when) i (just )?(disappeared|disappear|was gone|were gone|wasn'?t here|weren'?t here)|better off without me|(nobody|no one|no-one) would (even )?(miss|care about) me|(nobody|no one|no-one) would (even )?care if i|(can'?t|cannot|can not) go on(?=\s*$|\s*[.,!;]| anymore| like this| living| with (my |this )?life))\b/,
    city: /^Suicide$/,
    terms: ["suicide"],
  },
  {
    id: "collapse",
    label: "a collapse",
    when: /\b(building|ceiling|wall|roof|scaffold\w*|balcony|stairs?|staircase|floor|facade|façade|crane|sidewalk shed)\b[^.]{0,20}\b(collaps\w*|caving in|caved in|falling down|about to (fall|collapse)|is falling|fell( in| down| onto| on| off)?|shaking|swaying|cracking|tipping|buckling)\b|\bcollapse\b|\b(came|coming|come) crashing down\b|\bderrumb\w*/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "trapped",
    label: "someone trapped",
    when: /\b(trapped|stuck in (an |the |a )?elevator|(stuck|caught|pinned) in (the |a )?(train|subway|bus|elevator) doors?|(someone|somebody|people|person|kids?|children|child|man|woman|driver|passengers?) (is |are )?stuck|stuck[^.]{0,40}\b(with )?(kids|people|children|someone|a person|passengers?) inside|atrapad[oa]s?)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // A person hit by a vehicle, said either way round (beta retest 11: "a bus hit a cyclist and
    // he's lying in the street" got Homeless Outreach Assistance and no 911).
    id: "person_hit",
    label: "a person hit by a vehicle",
    when: new RegExp(`\\b${VEHICLE}\\b[^.]{0,20}\\b(hit|hits|struck|strikes|ran over|runs over|run over|knocked (down|over)|mowed down|plowed into|slammed into|crashed into|rammed)\\b[^.]{0,15}\\b${PERSON}\\b|\\b${PERSON}\\b[^.]{0,20}\\b(was |got |has been |just (got |been )?|is )?(hit|struck|run over|knocked (down|over)|mowed down|doored)\\b[^.]{0,10}\\bby\\b|\\b${PERSON}\\b[^.]{0,30}\\b(got|was|been|just) doored\\b`),
    // A near miss or a worry is not a person hit; the whole sentence is excused.
    unless: /[^.]*\b(almost|nearly|could have|might|will|going to|afraid|worried|scared)\b[^.]*/,
    city: /^Accident with Injury$/,
    terms: ["accident", "injury"],
  },
  {
    // Someone calling for help: the general danger article, never a noise complaint (beta retest
    // 11: "a woman is screaming for help from the apartment above mine" got Noise from Neighbor).
    id: "calling_for_help",
    label: "someone calling for help",
    when: /\b(yelling|screaming|calling|crying|shouting|begging|pleading|banging) (out )?for help\b|\bscreams? for help\b|\bhelp me\b|\bpidiendo ayuda\b|\bsomeone (is )?(screaming|yelling) (help|for help)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // Someone on or pushed onto the tracks (beta retest 11: "a man pushed someone onto the subway
    // tracks" got Buses and Subways and no 911).
    id: "tracks",
    label: "someone on the tracks",
    when: /\b(pushed|shoved|fell|fallen|thrown|jumped|knocked|slipped) (him|her|them|someone|somebody|a (man|woman|person|kid|child))? ?(onto|on|into|down (onto|on)) (the )?(subway |train )?tracks\b|\bon the (subway |train )?tracks\b|\bjump(ed|ing)? in front of (a |the )?(train|subway|bus)\b|\bhit by (a |the )?(train|subway)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // Someone in the water: the general danger article, and its own words, so the answer's
    // best match is never chosen from another word in the description (beta retest 9: "a child
    // fell into the river and is struggling" best-matched the City's Child Pornography article).
    id: "water_rescue",
    label: "someone in the water",
    when: /\b(fell|fallen|falls?|went|broke|crashed) (through|thru) (the )?ice\b|\b(ice|frozen (pond|lake|river))\b[^.]{0,60}\b(fell|fallen|went|broke|crashed) (through|thru|in)\b|\bthrough the ice\b|\b(fell|fallen|jumped|slipped|went|is|are|was|were) (into|in|off) (the |a )?(river|pond|water|harbor|harbour|ocean|lake|pool|bay|creek|canal|east river|hudson|pier|dock)\b|\bdrown\w*|\b(struggling|thrashing|can'?t swim|went under|going under|being swept|swept away) (in the water|in the river|in the pool|in the ocean)?|\b(in the (water|river|pool|ocean|lake))\b[^.]{0,30}\b(struggling|can'?t (swim|get out)|went under|going under|not moving|face ?down)\b|\bse est[aá] ahogando\b/,
    unless: /\b(phone|keys?|wallet|bag|toy|ball|leaves|trash|garbage|car keys)\b[^.]{0,15}\b(fell|went) (into|in)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "at_risk",
    label: "a person at risk",
    when: /\b(jump(ed|ing)? in front of (a |the )?car|(basement|cellar|apartment) is flood\w*[^.]{0,40}\b(is|are) (down there|inside|in there)|(baby|infant|toddler|newborn|elderly|grandm\w*|grandf\w*|grandparent)[^.]{0,30}\b(freezing|too cold|hypotherm\w*|turning blue)|(freezing|too cold)[^.]{0,30}\b(baby|infant|toddler|newborn))\b/,
    // No search words of its own: a baby freezing with no heat still gets the 311 heat article.
    terms: [],
  },
  {
    id: "domestic_violence",
    label: "domestic violence",
    when: /\b(domestic violence|(husband|wife|boyfriend|girlfriend|partner|ex) (is |keeps )?(beating|hitting|hurting|choking) (me|her|him)|hitting (his|her) (wife|husband|girlfriend|boyfriend|partner)|violencia dom[eé]stica)\b/,
    terms: ["domestic", "violence"],
  },
];

/**
 * The City's own domestic violence text, from KA-01217 "Domestic Violence" (911 section,
 * read 2026-11-07). The HOPE Hotline's number is not in the article text, so none is given.
 */
export const CITY_DV = {
  call_911: "Call 911 to report domestic violence, including a crime in progress, impending threat, fear of violence, or past domestic violence.",
  text_911: "If you can't safely call 911, you can send them a text.",
  hope_hotline: "New York City’s 24-Hour HOPE Hotline provides safety planning, referrals, and connections to emergency housing for victims of all crimes, including survivors of domestic violence, in more than 150 languages.",
  ka_number: "KA-01217",
  url: "https://portal.311.nyc.gov/article/?kanumber=KA-01217",
};

/** For the calling assistant: it is the better detector of danger, and is told so (QA round 2 on #23). */
export const ASSISTANT_INSTRUCTION =
  "Danger detection here is keyword-based and will miss some emergencies. If anything the person says suggests someone may be in danger or need urgent medical help, tell them to call 911 first, even if this tool did not flag it.";

/** The City's 988 sentence, from KA-01635 (Suicide), read 2026-11-07. */
export const CITY_988 = {
  text: "When people call, text, or chat 988, they will be connected to trained counselors that are part of the existing Lifeline network.",
  ka_number: "KA-01635",
  url: "https://portal.311.nyc.gov/article/?kanumber=KA-01635",
};

const NOT_EMERGENCY = /\b(not an emergency|non[- ]?emergency|no emergency|isn'?t an emergency|not urgent|no es una emergencia)\b/;
// "Emergency" in a program's name is not urgency: Emergency Rental Assistance, Emergency HEAP,
// emergency food, an emergency contact (stage 10 stress set).
const URGENT = /\b(urgent|emergency(?! (rental|rent|heap|food|assistance|contact|preparedness|housing|shelter|fund|grant|benefit|plan|kit|alert|notification|management|room visit))|emergencia|right now|immediately|asap|help me|please help|dangerous|danger|peligro\w*)\b/;

export type DangerAssessment = {
  /** Danger kinds found, in DANGERS order. A "not an emergency" disclaimer leaves only HIGH_SEVERITY kinds. */
  kinds: DangerKind[];
  /** Words in the description that suggested each kind. */
  suggested_by: string[];
  /** A past crime ("robbed last week"): no 911 lead, a pointer to the City's crime tip and precinct articles. */
  past_crime: boolean;
  /** The person said it is not an emergency. */
  not_emergency: boolean;
  /** The description says the condition recurs ("every night", "always") and nothing says it is happening now. */
  recurring: boolean;
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
  if (kinds.some((k) => k.id === "crash") && !kinds.some((k) => k.id === "hurt") && !/\b(hit by a|run over|flipped( over)?|overturned|rolled over|people (are )?(still )?inside|someone (is )?(still )?inside|trapped|pinned)\b/.test(text)) {
    kinds = kinds.filter((k) => k.id !== "crash");
  }
  // A crime word with a past-time word is a past crime: a pointer, not a 911 lead.
  // It is not past when the words say the danger is present ("still inside", a weapon).
  const crime = DANGERS.find((k) => k.id === "crime")!;
  const present = PRESENT_DANGER.test(text.replace(new RegExp(crime.unless!.source, "g"), " "));
  const pastCrime = kinds.some((k) => k.id === "crime") && PAST.test(text) && !present;
  if (pastCrime) kinds = kinds.filter((k) => k.id !== "crime");
  // A recurring condition ("every morning", "always", "keeps") is not an emergency in progress
  // for the ambiguous signals: smoke, a crash, and someone passed out or not moving. Beta retest
  // 10, 2026-11-09: "black smoke pours out of the chimney next door every morning" and "a man
  // sleeps passed out on a bench in the park every night" led with 911. Clear dangers (fire, gas,
  // carbon monoxide, not breathing, bleeding, a weapon) stay, and so does anything said to be
  // happening now ("right now", "can't breathe", "won't wake up").
  const recurring = RECURRING.test(text) && !HAPPENING_NOW.test(text);
  if (recurring) {
    kinds = kinds.filter((k) => {
      if (k.id === "smoke") return ELECTRICAL_SMOKE.test(text);
      if (k.id === "crash") return false;
      // People walking on the tracks as a habit is quieted; someone pushed, fallen or lying there is not.
      if (k.id === "tracks") return /\b(pushed|shoved|fell|fallen|thrown|jumped|knocked|slipped|lying|train is coming)\b/.test(text);
      if (k.id === "hurt") return !(SOFT_HURT.test(by[found.indexOf(k)]) && !HARD_HURT.test(text));
      // A theft or break-in that keeps happening ("someone keeps stealing packages") is a pattern
      // to report, not one in progress; never with a weapon.
      if (k.id === "crime") return !(/\b(steal|rob|break|smash|trying)\w*/.test(by[found.indexOf(k)]) && !/\b(guns?|knife|knives|weapons?|shoot\w*|stabb\w*|attack\w*)\b/.test(text));
      return true;
    });
  }
  // "Not an emergency" quiets ambiguous signals only, never HIGH_SEVERITY.
  if (notEmergency) kinds = kinds.filter((k) => HIGH_SEVERITY.has(k.id));
  return {
    kinds,
    suggested_by: by.filter((_, i) => kinds.includes(found[i])),
    past_crime: pastCrime,
    not_emergency: notEmergency,
    recurring,
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

/**
 * The City's own "Call 911" summaries for the dangers in DANGERS that name a City article,
 * built in so a danger is answered in the City's words even when 311's content cannot be
 * reached (no key, an empty cache, the API down; beta test 2026-11-08). Copied word for
 * word from GetContentList, read 2026-11-07 (test/fixtures/content/); the live article is
 * used whenever it can be read.
 */
export const BUILT_IN_911_READ = "2026-11-07";
export const BUILT_IN_911: ArticleLike[] = [
  { ka_number: "KA-01543", title: "Fire Emergency", description: "Call 911 to report a fire." },
  { ka_number: "KA-02220", title: "Smoke or Fumes", description: "Call 911 to report smoke or fumes." },
  { ka_number: "KA-02048", title: "Gas Leak", description: "Call 911 to report a gas leak or any gas-related emergency or dangerous condition." },
  { ka_number: "KA-02608", title: "Carbon Monoxide", description: "Call 911 to report carbon monoxide emission or poisoning. Learn about carbon monoxide detector requirements." },
  { ka_number: "KA-01515", title: "Assault", description: "Call 911 to report any type of assault." },
  { ka_number: "KA-01557", title: "Gunshot", description: "Call 911 to report gunfire." },
  { ka_number: "KA-01581", title: "Medical Emergency", description: "Call 911 to report any type of medical or health related emergency." },
  { ka_number: "KA-02907", title: "Overdose", description: "Call 911 to report someone in very bad condition who needs immediate medical help." },
  { ka_number: "KA-01513", title: "Accident with Injury", description: "Call 911 to report an accident in progress." },
  { ka_number: "KA-01046", title: "Missing Person", description: "Call 911 to report someone who may be missing, abducted, or kidnapped. Check if a missing person has been found." },
  { ka_number: "KA-01538", title: "Dangerous Animal", description: "Call 911 to report an animal causing a dangerous or hazardous condition." },
  { ka_number: "KA-01635", title: "Suicide", description: "Call 911 to report that someone is considering suicide or endangering themselves." },
];

export type EmergencyLead = {
  call_911: string;
  /** Where the wording comes from: a City article, or BetaNYC. */
  source: string;
  ka_number: string | null;
  portal_url: string | null;
  suggested_by: string[];
  dangers: string[];
  also_988?: typeof CITY_988;
  domestic_violence?: typeof CITY_DV;
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
  if (kinds.some((k) => k.id === "domestic_violence")) {
    lead.call_911 = CITY_DV.call_911;
    lead.source = `311 article ${CITY_DV.ka_number} ("Domestic Violence"), ${CITY_DV.url}`;
    lead.ka_number = CITY_DV.ka_number;
    lead.portal_url = CITY_DV.url;
    lead.domestic_violence = CITY_DV;
  }
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

export const CRIME_WORDS = /\b(crime|criminal|police|cops?|nypd|robbed|stole|stolen|theft|burglar\w*|vandal\w*|mischief|broke into|took my|smashed (my|the)|keyed|slashed|swastikas?|hate crimes?|vandaliz\w*|catalytic|report a crime|denunciar|polic[ií]a|robo)\b/;
