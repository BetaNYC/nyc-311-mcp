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
 * On every response from every tool (callTool): the last line of the text, like the end of a
 * doctor's office phone message, and the first field (safety_line) of the structured output,
 * whatever was or was not detected. Danger spotting is a best effort and will miss some wording;
 * this sentence is what the server relies on. Noel's exact words (beta round 17).
 */
export const SAFETY_LINE = "If this is an emergency, or if you think this is an emergency, call 911.";
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
const PERSON = "(him|her|them|me|us|(an? |the |my |his |her |our |some )?(cyclists?|bikers?|bicyclists?|pedestrians?|person|people|man|woman|men|women|kids?|child(ren)?|boy|girl|guy|lady|someone|somebody|delivery (worker|guy|man)|old (man|woman|lady)|students?|workers?|neighbor|son|daughter|mother|father|mom|dad|grandm\\w*|grandf\\w*))";
/** A child: for a child with a hazard (child_hazard). */
const CHILD = "(toddlers?|bab(y|ies)|infants?|kids?|child|children|little (boy|girl|one)|(a |my |his |her |our )?(son|daughter)|niñ[oa]s?)";
const ANIMAL_WORD = /\b(dogs?|cats?|pets?|pupp(y|ies)|kittens?|birds?|pigeons?|squirrels?|raccoons?|animals?|horses?|deer|geese|goose|ducks?|rabbits?|hamsters?|parrots?)\b/;
const PERSON_WORD = /\b(i|i'?m|me|my (mom|dad|mother|father|son|daughter|wife|husband|friend|neighbor|roommate|uncle|aunt|grand\w*|brother|sister|kid|child|baby|partner|boyfriend|girlfriend)|he|she|they|him|her|them|man|woman|men|women|person|people|kid|child|children|baby|toddler|boy|girl|guy|lady|someone|somebody|driver|worker|owner)\b/;
/** An animal hit or run over by a vehicle. */
const ANIMAL_HIT = /\b(cats?|kittens?|dogs?|pupp(y|ies)|birds?|pigeons?|squirrels?|raccoons?|animals?|pets?|deer|geese|goose|ducks?|possums?|opossums?|coyotes?|fox(es)?)\b[^.]{0,20}\b(got |was |been |just )?(hit|struck|run over|ran over)\b/;
/** A person as the object of violence: "a woman", "his girlfriend", "the old man", "someone". */
const PERSON_OBJ = "(an? |the |my |his |her |their |our |some |another )?(woman|man|women|men|girls?|boys?|kids|kid|child|children|teens|person|people|someone|somebody|guy|lady|wife|husband|girlfriend|boyfriend|partner|mother|father|mom|dad|son|daughter|brother|sister|grandm\\w*|grandf\\w*|neighbor|teenager|teen|student|baby|elderly (man|woman)|old (man|woman|lady)|homeless (man|woman|person)|delivery (worker|guy)|driver|passenger)\\b(?! (dolls?|toys?))";
/** Someone forcing their way in, an intruder inside, someone following the person. */
const FORCED_ENTRY = [
  "(break|breaking|broke|kick|kicking|kicked|bust|busting|force|forcing|pry|prying|smash|smashing)\\w* (down|in|open|into|through) (my|the|our|her|his|their|a) (front |back |apartment |building |bedroom )?(doors?|windows?|apartment|house|home|place)",
  "(trying|tried|tries) to (break|kick|force|bust|pry) (in|into|down|open|through)",
  "(someone|somebody|a (man|guy|woman|stranger|person)|he|she|they|strangers?|people) (is |are |'s |keeps? )?(trying|tries|tried|jiggling|rattling|turning) (my|the|our) (front |back |apartment )?(doors?|doorknobs?|locks?|windows?)",
  "(trying|jiggling|rattling) (it|the (door|knob|handle|lock)) right now",
  // One person attacking another, now (beta retest 12: "a man is beating a woman in the stairwell
  // of my building" got Heat or Hot Water and no 911).
  "(is |are |'s |'re )?(beating|hitting|punching|kicking|choking|strangling|stabbing|slashing|attacking|assaulting|slapping|stomping|dragging|shoving|pushing|throwing) (up )?" + PERSON_OBJ,
  "(holding|pushing|forcing|keeping) " + PERSON_OBJ + " (head )?(under|beneath) (the )?water",
  // A weapon being used or shown, anywhere (beta retest 14: "a guy swinging a machete on the
  // platform" found nothing). A blade or a gun is a weapon on its own; a blunt object only when
  // it is swung, waved or used against someone.
  "(swinging|waving|brandishing|pointing|wielding|holding up|pulled out|pulls out|has|with|carrying) (a |an |his |her |their |some kind of )?(big |huge |long )?(machete|axe|ax|hatchet|sword|box ?cutter|razor|blade|switchblade|meat cleaver|cleaver|knife|knives|gun|pistol|rifle|shotgun|firearm|weapon)s?",
  "(swinging|waving|brandishing|wielding) (a |an |his |her |their )?([\\w-]+ )?(baseball )?(bat|pipe|hammer|crowbar|tire iron|metal pole|stick|chain|bottle|brick|chair|shovel|golf club) (at|around|toward|towards|near|in|on|and)",
  "(chasing|threatening|attacking|hitting|beating|going after) " + PERSON_OBJ + " with (a |an |his |her )?(machete|axe|hatchet|knife|bat|pipe|hammer|crowbar|bottle|brick|chain|stick|box ?cutter|gun)",
  "(threatening|robbing|holding up) (the )?(cashier|clerk|driver|people|customers|passengers|someone|me|us) with (a |an )?(box ?cutter|knife|gun|razor|blade|machete)",
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
const ELECTRICAL_SMOKE = /\b(apartments?|hallways?|stairwells?|building|windows?|doors?|grates?|subway|tunnel|engine|roof|basement|outlets?|sockets?|electrical|wiring|wires?|panel|breaker|fuse ?box|appliances?|chargers?|batter(y|ies)|e-?bikes?|scooters?|space heaters?|extension cords?|power strips?|boiler rooms?|meter rooms?|basement)\b/;
/** Hurt signals that may be sleep or a habit; the hard ones are never quieted. */
const SOFT_HURT = /\b(passed out|collapsed|fainted|not moving|unconscious|unresponsive)\b/;
const HARD_HURT = /\b(bleeding|not breathing|isn'?t breathing|stopped breathing|can'?t breathe|seizures?|heart attack|chest pains?|stroke|overdos\w*|choking|turning blue|injured|hurt)\b/;

export const DANGERS: DangerKind[] = [
  {
    id: "fire",
    label: "fire",
    when: /\b(is|are|was|were) (still |now )?(burning|in flames|engulfed)\b|\b(on fire|fire\b(?!\s*(hydrant|escape|alarm box|extinguisher|department|code|safety|truck|house|station|inspection|exit|drill|pit|place|lane|zone|works?))|flames?|blaze|incendio|fuego|something('s| is) burning|(house|building|car|apartment|kitchen) is burning)/,
    // A building fire alarm that keeps going off for no reason is a noise complaint (stage 9 stress
    // set); any smoke or flame said with it is still a danger (the smoke kind, or "fire" again).
    unless: /\b(eyes?|throat|skin|chest|feet|stomach|ears?|nose|mouth|tongue|face|cheeks?|candles?|incense|sage|fireplace|grill|bbq|barbecue|calories|money|cash|bridges|daylight|midnight oil) (is |are |were |was )?(still |now )?burning\b|\b(this|that|it|their|the|his|her)( [\w']+){0,3} (is|was) (straight |so |pure |lowkey |honestly )?fire\b(?! (in|at|on|near|inside|outside|next|down|up|spreading|everywhere|and))|\bfire (sales?|deals?|prices?)\b|\bfired up\b|\b(on fire)\b (deals?|sales?|today with)|\bfire alarms?\b[^.]{0,60}\b(every|whenever|each time|all the time|always|constantly|cook\w*|burnt|toast|shower\w*|steam)\b|\b(fireplace|fireworks?|fired (me|him|her|them)|ceasefire|campfire)\b|\bfire alarms?\b[^.]{0,40}\b(for no reason|false alarms?|keeps? going off|goes off all the time|always going off|every (day|night|morning|week)|constantly|randomly|chirp\w*|beep\w*)\b/,
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
    when: /\b((carbon monoxide|co)( (detector|alarm|monitor|sensor))? (is |keeps |started |has been )?(going off|beeping|beeps?|sounding|ringing|alarming|went off|goes off)|carbon monoxide (leak\w*|poisoning|in|from|smell|detected|levels?|is (here|present|in))|(carbon monoxide|co) (detector|alarm|monitor|sensor)s?\b[^.]{0,30}\b(is |keeps |started |has been |just )?(going off|beeping|sounding|ringing|alarming|went off|goes off)|(detector|alarm) (says|shows|reads) (carbon monoxide|co))\b/,
    // A detector chirping for a low battery is a maintenance complaint (Apartment Maintenance).
    unless: /[^.]*\b(chirp\w*|beep\w*)\b[^.]{0,40}\b(batter(y|ies)|low battery)\b[^.]*/,
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
    unless: /\b(like|as if|as though)\b[^.]{0,40}\b(break|bust|kick|come)\w* (through|down|in)\b|\bbreak(ing)? through (the )?(ceiling|floor|walls?)\b|\b(sell(s|ing)?|sold|buy(s|ing)?|display\w*) (\w+ ){0,2}(knives|guns|weapons|machetes|axes|bats|hammers)\b|\b(heart|panic|asthma|anxiety) attacks?\b|\b(dogs?|cats?|animals?)\b[^.]{0,20}\b(attack(ed|ing|s)?|bit|bitten|bites|biting)\b[^.]{0,10}\b(my|a|the|our|another|other|his|her|their) (dogs?|cats?|pets?|puppy|kitten)\b|\b((toy|nail|glue|water|squirt|heat|caulk(ing)?|staple|spray) guns?|gun hill|gun (permit|license|laws?)|knife sharpening|gun (stores?|shops?|ranges?|shows?)|shot glass(es)?|shots? of (espresso|tequila|whiskey|vodka|liquor)|(flu|covid|vaccine|booster|allergy) shots?|(photo|camera|great|nice) shots?|shot (a |the )?(photo|picture|video)|(sparks?|water|flames?|smoke|steam)\w* (is |are )?shooting out|shooting out of|shoot(ing)? (a |the )?(videos?|photos?|pictures?|film|a film|movies?|scenes?|commercials?|hoops|pool|the breeze)|(video|photo|film|movie) shoot\w*|threaten\w* to (evict|sue|call|report|raise|tow|fine|cut))\b/,
    city: /^(Assault|Gunshot)$/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "hurt",
    label: "someone hurt or in medical danger",
    when: /\b(hurt|injured|injury|injuries|bleeding|unconscious|unresponsive|not breathing|isn'?t breathing|stopped breathing|can'?t breathe|trouble breathing|passed out|collapsed|seizures?|heart attack|chest pains?|stroke|face (is )?drooping|allergic reaction|anaphyla\w*|throat (is )?(swelling|closing)|too many pills|took (a bunch of|all) (the |his |her |my )?pills|won'?t wake up|wont wake up|can'?t wake (him|her|them) up|overdos\w*|od'?ing|odeing|choking|fainted|not moving|isn'?t moving|won'?t move|turning blue|(isn'?t|not) responding|swallowed (a |an |some )?(battery|batteries|bleach|poison|magnets?|pills)|poisoned|fell (out of|off|from) (a |the |his |her |my )?(window|roof|fire escape|scaffold\w*|balcony|ledge|building|stairs)|se cay[oó]|fell and (can'?t|cannot|can not) get up|fell\b[^.]{0,15}\b(can'?t|cannot) get up|(he|she|they|i|someone|mom|dad) can'?t (talk|speak|breathe)|herid[oa]s?|sangrando|inconsciente|no respira)\b/,
    // Not denied ("nobody was hurt"), not a figure of speech ("yowls like it's being hurt"), and
    // not an animal (beta retest 12: a stray cat's yowling got the medical 911 line). The whole
    // excused phrase is removed before the danger words are read again (otherMatch).
    unless: /\b(no ?one|nobody|no body|none of us|not|wasn'?t|weren'?t|isn'?t|aren'?t|without|didn'?t)\s+(\w+\s+){0,2}(hurt|injur\w*)\b|\b(like|as if|as though|sounds? like|looks? like)\b[^.]{0,30}\b(hurt|injured|dying|bleeding|in pain|can'?t breathe|choking|having a heart attack|heart attack|being (hurt|killed|murdered|attacked))\b|\b(can'?t breathe|choking|coughing) (with|because of|from|due to|in|on) (the |all the |this |that |my )?(dust|smoke|smell|fumes|heat|odor|exhaust|pollen|construction|garbage|mold)\b|\b(my )?(back|feet|head|knees?|ears?) (is |are )?(hurt|hurting|killing me)\b|\b(cats?|kittens?|dogs?|pupp(y|ies)|birds?|pigeons?|squirrels?|raccoons?|animals?|pets?|horses?|deer|geese|goose|ducks?|rats?|possums?|opossums?)\b(?:(?!\b(driver|man|woman|person|kid|child|someone|somebody|he|she|they|people|owner|boy|girl|guy|lady|i|we)\b)[^.]){0,40}\b(hurt|injured|bleeding|limping|sick|dying|hit by a (car|truck|bus))\b|\b(hurt|injured|bleeding|limping|sick|dying)\b[^.]{0,15}\b(cats?|kittens?|dogs?|pupp(y|ies)|birds?|pigeons?|squirrels?|raccoons?|animals?|pets?|horses?|deer|geese|ducks?)\b/,
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
    when: /\b(building|ceiling|wall|roof|scaffold\w*|balcony|stairs?|staircase|floor|facade|façade|crane|sidewalk shed)\b[^.]{0,40}\b(tipping( over)?|toppling|keeling over|leaning (over|dangerously)|collaps\w*|caving in|caved in|falling down|about to (fall|collapse)|is falling|fell( in| down| onto| on| off)?|shaking|swaying|cracking|tipping|buckling)\b|\bcollapse\b|\b(came|coming|come) crashing down\b|\bderrumb\w*/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    id: "trapped",
    label: "someone trapped",
    when: /\b(doors?) (closed|shut|closing) on (a |her |his |my |someone'?s |a \w+'?s )?(arm|hand|leg|foot|coat|bag|stroller|dress)\b[^.]{0,40}\b(dragging|moving|pulling|leaving)\b|\b(train|subway|bus)\b[^.]{0,40}\bdragging (her|him|them|someone|somebody|a (man|woman|person|kid|child))\b|\b(trapped|stuck in (an |the |a )?elevator|(stuck|caught|pinned) in (the |a )?(train|subway|bus|elevator) doors?|(someone|somebody|people|person|kids?|children|child|man|woman|driver|passengers?) (is |are )?stuck|stuck[^.]{0,40}\b(with )?(kids|people|children|someone|a person|passengers?) inside|atrapad[oa]s?)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // Water rising where people are (beta retest 12: "a water main burst and water is rushing into
    // basements with people inside" got Water Main Break and no 911).
    id: "flood_people",
    label: "flooding with people inside",
    when: /\b(water|flood\w*|sewage)\b[^.]{0,60}\b(people|someone|somebody|kids|children|residents|tenants|families|neighbors|(the )?drivers?|passengers|(my|our|his|her|their) (family|kids|mom|dad|parents|grandparents|grandm\w*|grandf\w*|husband|wife|son|daughter|baby|neighbor|roommate)|a (man|woman|person|child)) (are |is )?(still )?(inside|trapped|stuck|in there|down there|in the basement|can'?t get out)\b|\b(people|someone|kids|residents|a (man|woman|person|child)) (are |is )?(trapped|stuck) (in|by) (the )?(water|flood\w*)\b|\bwater (is )?(up to|over) (my |our |their |his |her )?(\w+'s )?(chest|neck|waist|head|shoulders)\b|\b(car|cars|bus) (is |are )?(stuck|stranded|floating|sinking) in (the )?(water|flood\w*)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // A vehicle out of control now (beta retest 12: "cars are spinning out right now" on black ice).
    id: "vehicle_out_of_control",
    label: "a vehicle out of control",
    when: new RegExp(`\\b${VEHICLE}\\b[^.]{0,30}\\b(spinning out|spun out|skidding|sliding (all over|off|into|across|down|toward|towards)|losing control|lost control|out of control|swerving (into|onto|at)|careening|fishtailing|rolling (down|toward|backward)|going the wrong way|driving (the wrong way|on the sidewalk|into))\\b|\\b(no one|nobody) (is )?(driving|in) (the|a) (car|truck|bus|van)\\b[^.]{0,20}\\b(rolling|moving)\\b`),
    terms: ["dangerous", "situation", "location"],
  },
  {
    // Someone at a height who may jump or fall: a bridge, a roof's edge, a ledge, a railing, a
    // window (beta retest 12: "a person is standing on the outside of the bridge railing" found
    // nothing). The general danger article; the suicide kind, and its 988 line from the City's own
    // Suicide article, only when the person's words say so.
    id: "height",
    label: "someone at risk of falling or jumping",
    when: /\b(standing|sitting|hanging|climbing|leaning|stuck|dangling|perched|walking|swinging) (on|over|off|out of|outside( of)?|along|on top of|on the outside of|from|off the side of) (the |a |an |his |her )?(outside of the )?(side of the )?(\w+ (floor|story) )?(bridge|roof|rooftop|ledge|railing|rail|edge|window ?sill|window|balcony|fire escape|parapet|overpass|scaffold\w*|crane|building)\b|\b(on|over) the (edge|ledge|railing) of (the |a )?(bridge|roof|building|overpass|platform|balcony)\b|\b(threatening|about|going|trying|wants?) to (jump|fall) (off|from|out)\b|\b(climbed|climbing|climbs|went|gone|is|are|was|stood|standing|sitting|hanging|leaning|got) (over|outside|past|on the outside of|onto|up on) (the |a )?(bridge |roof |balcony |subway |platform |overpass )?(railing|rail|ledge|edge|parapet|guard ?rail|barrier)\b|\bon the outside of (the |a )?(bridge |balcony )?(railing|ledge|fence|barrier|rail)\b|\b(someone|somebody|he|she|they|a (man|woman|guy|teen\w*|kid|person|boy|girl|child)|teenagers?)\b[^.]{0,60}\b(is |are |'s |'re )?about to (fall|jump)\b|\b(he|she|someone|somebody|a (man|woman|guy|worker|kid|child|person)|worker) (is |'s )?(hanging|dangling|holding on) (from|off|onto|on to|by) (the |a |an )?([\w-]+ )?(pipe|beam|rope|ledge|railing|edge|gutter|scaffold\w*|crane|cable|bar|pole|sign|balcony|fire escape|window)\b|\b(climbed|climbing) (over|onto|up) the (railing|fence|ledge) (of|on) (the |a )?(bridge|roof|overpass)\b|\b(child|kid|toddler|baby|boy|girl) (is )?(hanging|climbing|leaning|sitting) (out|on|over) (of )?(the |a |an |her |his )?([\w-]+ ){0,2}(window|balcony|ledge|fire escape|railing)\b/,
    // Workers at height doing their job are not a danger; the whole sentence is excused.
    // ...unless something has gone wrong: dangling, stuck, a rig or rope that snapped or broke.
    unless: /^(?![^.]*\b(dangling|stuck|snapped|broke|broken|fell|falling|swinging|trapped|can'?t get (down|up|back)|hanging (by|on to|onto))\b)[^.]*\b(window washers?|window cleaners?|construction workers? (with|in) (a )?harness|wearing a harness|painters?|in a harness)\b[^.]*/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // Emergency symptoms in a person, in plain words (beta retest 13: "my uncle is clutching his
    // chest and sweating and can't talk" found nothing). Not an animal, not a figure of speech,
    // not stress (the excused sentence is removed before the words are read again).
    id: "medical_symptoms",
    label: "a medical emergency",
    when: /\b(chest (feels|felt) (like|heavy|tight|crushed)|can'?t (lift|raise|move) (his|her|their|my) (left |right )?(arm|leg|hand)|words (are |were )?(coming out wrong|garbled|jumbled)|not making (any )?sense|(pain|ache) (is )?(going|spreading|shooting|radiating) (down|into|to|up) (his|her|their|my) (left |right )?(arm|jaw|neck|back)|wheez\w*|inhaler (isn'?t|is not|doesn'?t|does not|didn'?t) (work\w*|help\w*)|shaking all over|foaming at the mouth|(breathing|breath) (is |sounds |seems )?(slow|shallow|weird|strange|labored|rattling)|barely breathing|(took|swallowed|ate) (some|a bunch of|a lot of|too many|a handful of) (pills|tablets|gummies|medicine)|swallowed (a |some )?(battery|batteries|bleach|detergent|pods?|chemicals|poison|magnets?)|(on|lying on) the floor and (can'?t|won'?t|isn'?t able to) (move|get up|talk|speak)|can'?t move (or|and) (talk|speak)|hit (his|her|their|my) head\b[^.]{0,50}\b(throwing up|vomit\w*|confused|can'?t remember|passed out|unconscious|bleeding|not making sense)|(pregnant)\b[^.]{0,30}\b(bleeding|contractions|water broke)|high fever\b[^.]{0,30}\b(seizure|limp|unresponsive|not waking)|clutch\w* (his|her|their|my) chest|chest (pain|pains|pressure|tightness|is (tight|hurting|crushing))|crushing (chest )?(pain|pressure)|pain (in|spreading (to|down)) (his|her|their|my) (chest|left arm|jaw)|(arm|face|side of (his|her|their|my) (face|body)) (is |went |going )?(numb|drooping|droops?|paralyzed)|face (is )?drooping|slurr\w* (speech|words|his words|her words)|(speech|words) (is |are )?slurred|can'?t (talk|speak|breathe|swallow|move (his|her|their|my) (arm|leg|side))|(struggling|gasping|fighting) (to breathe|for (air|breath))|having (a |an )?(seizure|stroke|heart attack|asthma attack|allergic reaction)|seiz(ing|ure)|convuls\w*|choking|(lips|face|skin) (are |is )?(turning )?(blue|gray|grey)|bleeding (heavily|badly|a lot|everywhere|from (his|her|their|my|the) (head|neck|chest))|(throat|tongue|lips|face) (is |are )?(swelling|swollen|closing)|anaphyla\w*|pupils (are )?(tiny|pinpoint)|(not|isn'?t|won'?t) (breathing|respond\w*|waking up|wake up)|overdos\w*|(took|swallowed) (a whole|all (the|his|her|my)|a bottle of|too many) \w*)\b/,
    unless: /[^.]*\b(dogs?|cats?|pets?|pupp(y|ies)|kittens?|birds?|animals?|horses?)\b[^.]*|\b(like|as if|as though|feel like|feels like|makes? me (feel )?like)\b[^.]{0,30}\b(can'?t breathe|choking|heart attack|seizure|stroke|dying)\b|[^.]*\b(stress\w*|anxiety|anxious|worried|nervous|panic about|rent|bills|traffic noise|heat|ventilation|smell|dust|fumes|smoke from|construction|odor|pollen|exhaust)\b[^.]*\b(chest|breathe)\b[^.]*|\bchoking on (the |all the |this )?(dust|smoke|fumes|smell|exhaust|pollen|construction)\b|[^.]*\b(chest|breathe)\b[^.]*\b(stress\w*|anxiety|anxious|worried|rent|bills|heat|ventilation|no ac|dust|fumes|construction|odor|smell|exhaust|pollen)\b[^.]*/,
    city: /^Medical Emergency$/,
    terms: ["medical", "emergency"],
  },
  {
    // A child with a hazard, now: traffic, the street, a car, water, a ledge or window, fire
    // (beta retest 13: "a toddler wandered into the street and cars are swerving around him").
    id: "child_hazard",
    label: "a child in danger",
    when: new RegExp(
      [
        // traffic and the street
        `\\b${CHILD}\\b[^.]{0,40}\\b(wander\\w*|ran|runs|running|walked|walking|crawl\\w*|playing|alone|standing|darted|went|is|was) (out )?(into|in|onto|on|across) (the )?(middle of the )?(street|road|traffic|intersection|highway|avenue|crosswalk)\\b`,
        `\\b${CHILD} (alone |by (him|her)self )?(in|on) (the |a )?(street|road|traffic|highway|avenue)\\b(?! (fair|festival|party|vendor))`,
        `\\bcars? (are |were )?(swerving|honking|braking|stopping) (around|for|at) (a |the )?(him|her|${CHILD.slice(1, -1)})\\b`,
        `\\b${CHILD}\\b[^.]{0,40}\\b(running|walking|wandering|crawling|playing|darting|standing) (between|among|around) (the )?(cars|traffic|trucks|buses)\\b`,
        `\\b${CHILD}\\b[^.]{0,30}\\b(alone|by (him|her)self|unattended)\\b[^.]{0,30}\\b(edge of the (subway |train )?platform|tracks|curb of the highway)\\b`,
        `\\b(left|locked) (a |the |my |her |his |their )?${CHILD} (alone )?in (a |the )?(hot |locked |parked )?(car|van|suv|truck)\\b`,
        // a car
        `\\b${CHILD}\\b[^.]{0,30}\\b(alone|left|locked|stuck) (alone )?in (a |the )?(hot |locked |parked )?(car|van|suv|truck)\\b`,
        // water, in distress or alone
        `\\b${CHILD}\\b[^.]{0,30}\\b(fell|fallen|slipped|went under|is under|face ?down|drowning|struggling|can'?t swim)\\b[^.]{0,30}\\b(pool|river|lake|water|bath\\w*|tub|pond|ocean)\\b`,
        `\\b${CHILD}\\b[^.]{0,10}\\b(is |was )?face ?down\\b`,
        `\\b${CHILD}\\b[^.]{0,40}\\b(pool|river|lake|water|tub)\\b[^.]{0,30}\\b(nobody|no one|no adult) (is )?(watching|around|there)\\b`,
        // a ledge, a window, fire
        `\\b${CHILD}\\b[^.]{0,30}\\b(standing|sitting|climbing|climbed|climbs|hanging|leaning|playing|crawled|crawling) (on|onto|up on|out of|over|off) (the |a |an )?([\\w-]+ ){0,2}(window ?(sill|ledge)?|windowsill|ledge|roof|balcony|fire escape|railing)\\b`,
        `\\b${CHILD}\\b[^.]{0,30}\\b(alone|playing|stuck|trapped) (near|by|in|with) (the )?(fire|flames|stove|matches)\\b`,
      ].join("|")
    ),
    unless: /[^.]*\b(every (summer|day|weekend|year)|always|usually|street fair|crying|wants?|hydrant is open|play street|block party)\b[^.]*/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // A person fallen into or trapped in a hole, a manhole, a trench, a shaft, a sinkhole or a
    // collapse (beta retest 14: "a worker fell into a manhole" got Manhole Cover Complaint and no 911).
    id: "fell_in",
    label: "someone fallen into a hole or trapped",
    when: new RegExp(`\\b(${PERSON.slice(1, -1)}|he|she|they|i|worker|workers|man|woman)\\b[^.]{0,25}\\b(fell|fallen|falls|slipped|dropped|is stuck|are stuck|got stuck|is trapped|are trapped|got trapped|trapped|stuck) (down |in(to)? |at the bottom of )(an? |the )?(open )?(manhole|hole|trench|ditch|shaft|elevator shaft|air ?shaft|sinkhole|pit|well|sewer|excavation|construction pit|storm drain|cellar|vault|crawl ?space)s?\\b|\\b(trapped|stuck|pinned|buried) (under|in|beneath) (the )?(rubble|debris|collapse|collapsed \\w+|fallen \\w+|dirt|bricks|concrete|a (wall|ceiling|scaffold\\w*|tree))\\b|\\b(collapsed|caved[- ]in) (trench|ditch|building|wall|ceiling|scaffold\\w*)\\b[^.]{0,30}\\b(people|someone|workers?|man|woman|kids?) (are |is )?(inside|trapped|under|stuck)\\b|\\b(trapped|stuck) in (a |the )?collapsed\\b|\\b(sinkholes?|manholes?|holes?|trench(es)?|shafts?|pits?)\\b[^.]{0,40}\\b(someone|somebody|a [\\w-]+( walker| worker)?|people|man|woman|kid|child|person|he|she|they) (fell|fallen|is|was|got|went) (in|into it|inside|down)\\b|\\b(crushed|pinned|trapped|stuck) (by|under|beneath) (a |an |the )?(falling |fallen )?[\\w-]+\\b|\\b(dropped|fell|collapsed)\\b[^.]{0,40}\\b(someone|somebody|a (man|woman|worker|person|guy)|people|workers?) (is |are )?(under|beneath|pinned under|trapped under) (it|them|the \\w+)\\b`),
    unless: /\b(phone|keys?|wallet|bag|ring|toy|ball|glasses|earrings?|airpods?|card|cat|dog|kitten|puppy)\b(?! (walker|owner|sitter))[^.]{0,15}\b(fell|dropped|went|is stuck)\b/,
    terms: ["dangerous", "situation", "location"],
  },
  {
    // A person hit by a vehicle, said either way round (beta retest 11: "a bus hit a cyclist and
    // he's lying in the street" got Homeless Outreach Assistance and no 911).
    id: "person_hit",
    label: "a person hit by a vehicle",
    when: new RegExp(`\\b${VEHICLE}\\b[^.]{0,40}\\b(hit|hits|struck|strikes|ran over|runs over|run over|knocked (down|over)|mowed down|plowed (into|through)|slammed into|crashed into|rammed|drove (into|through)|ran into|went into)\\b[^.]{0,15}\\b(${PERSON.slice(1, -1)}|crowds?|pedestrians?|a group|the line|students|the bus stop|a bus stop full)\\b|\\b${VEHICLE}\\b[^.]{0,20}\\b(jumped|mounted|went up on|drove onto) the (curb|sidewalk)\\b[^.]{0,40}\\b(people|someone|somebody|a (man|woman|kid|person|child)|pedestrians|kids|crowd)\\b|\\b${PERSON}\\b[^.]{0,20}\\b(was |got |has been |just (got |been )?|is )?(hit|struck|run over|knocked (down|over)|mowed down|doored)\\b[^.]{0,10}\\bby\\b|\\b${PERSON}\\b[^.]{0,30}\\b(got|was|been|just) doored\\b`),
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
    when: /\boverboard\b|\b(holding|held|pushing|pushed|forcing|keeping) ([\w']+ ){0,3}(head )?(under|beneath) (the )?water\b|\bhead (is |was )?(under|beneath) (the )?water\b|\b(fell|fallen|jumped|went|thrown|knocked) (off|overboard( from)?|over the side of) (the |a )?(ferry|boat|pier|dock|kayak|jet ?ski)\b|\b(face ?down|floating) in (the |a )?(pond|lake|river|water|pool|canal|creek|bay|harbor|ocean)\b|\b(pulled|swept|dragged|carried) (out|away|under) by (the )?(current|waves|tide|rip ?(current|tide))\b|\b(waving|yelling|screaming|calling|signaling) for help\b[^.]{0,40}\b(water|beach|pool|lake|river|ocean|surf|bay)\b|\b(went|go(ing)?|slipped) under (in|at) (the |a )?(pool|water|river|lake|ocean|bath\w*|tub)\b|\b(went|go(ing)?) under\b[^.]{0,30}\b(hasn'?t|has not|didn'?t|did not|not) (come|came) (back )?up\b|\b(struggling|thrashing|flailing|going under|calling for help) in the (surf|waves|water|pool|ocean|bay|lake|river)\b|\bface ?down in (the |a )?(water|pool|tub|bathtub|bath)\b|\b(drown\w*) (at|in|off) (the |a )?(beach|pool|bay|surf|ocean|lake)\b|\b(fell|fallen|falls?|went|broke|crashed) (through|thru) (the )?ice\b|\b(ice|frozen (pond|lake|river))\b[^.]{0,60}\b(fell|fallen|went|broke|crashed) (through|thru|in)\b|\bthrough the ice\b|\b(fell|fallen|jumped|slipped|went|is|are|was|were) (into|in|off) (the |a )?(river|pond|water|harbor|harbour|ocean|lake|pool|bay|creek|canal|east river|hudson|pier|dock)\b|\bdrown\w*|\b(struggling|thrashing|can'?t swim|went under|going under|being swept|swept away) (in the water|in the river|in the pool|in the ocean)?|\b(in the (water|river|pool|ocean|lake))\b[^.]{0,30}\b(struggling|can'?t (swim|get out)|went under|going under|not moving|face ?down)\b|\bse est[aá] ahogando\b/,
    // A dropped thing is not a person in the water, and "drowning in paperwork" is a figure of speech.
    unless: /\b(phone|keys?|wallet|bag|toy|ball|leaves|trash|garbage|car keys)\b[^.]{0,15}\b(fell|went) (into|in)\b|[^.]*\bdrown\w* in (?!(the |a |an )?(water|pool|river|lake|ocean|bay|bath\w*|tub|surf|sea|harbor|pond|flood\w*|canal|creek|east river|hudson))[^.]*/,
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
    when: /\b(domestic violence|(husband|wife|boyfriend|girlfriend|partner|ex) (is |keeps |'s )?(beating|hitting|hurting|choking|strangling|punching|kicking|attacking|threatening) (me|her|him|them)|(beating|hitting|punching|choking|strangling|kicking|attacking) (his|her|their) (wife|husband|girlfriend|boyfriend|partner|kids?|children)|hitting (his|her) (wife|husband|girlfriend|boyfriend|partner)|violencia dom[eé]stica)\b/,
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

/**
 * Shorthand and typos a worried person types, read for the danger words only ("kid in strt",
 * "baby not breathng", "guy w gun lobby"; beta round 15). The 311 matching has its own typo list.
 */
const DANGER_SHORTHAND: [RegExp, string][] = [
  [/\b(strt|stret|steet|sreet)\b/g, "street"],
  [/\bbldg\b/g, "building"],
  [/\bapt\b/g, "apartment"],
  [/\b(bsmt|bsmnt|basment)\b/g, "basement"],
  [/\bw\/? (?=(a |an |the )?(gun|knife|machete|weapon|bat))/g, "with "],
  [/\b(breathng|breating|breahting|brething|breathin)\b/g, "breathing"],
  [/\b(drownin|drowing|drownding)\b/g, "drowning"],
  [/\bpassd\b/g, "passed"],
  [/\b(bleding|bleedin)\b/g, "bleeding"],
  [/\b(choakin|chokin)\b/g, "choking"],
  [/\b(unconcious|unconsious)\b/g, "unconscious"],
  [/\bcant\b/g, "can't"],
  [/\bwont\b/g, "won't"],
  [/\bisnt\b/g, "isn't"],
  [/\bhes\b/g, "he's"],
  [/\bshes\b/g, "she's"],
];
/**
 * The danger keywords, for fuzzy reading (beta retest 15: "smel gas in hallway real strong" was
 * missed). A word of 4 letters or more one edit away from one of these (an inserted, dropped or
 * swapped letter; a changed letter only on words of 6 letters or more) is read as it, unless the
 * word is a real word on REAL_WORDS. Gas, 3 letters, is in COMMON_MISSPELLINGS instead.
 */
const DANGER_VOCAB = [
  "smell", "smells", "smelling", "smoke", "smoking", "fire", "flames", "burning", "bleeding", "breathing", "breathe",
  "unconscious", "unresponsive", "choking", "drowning", "overdose", "overdosed", "seizure", "collapsed", "stabbing",
  "stabbed", "shooting", "knife", "explosion", "exploded", "trapped", "carbon", "monoxide", "overboard", "railing",
  "drowned", "struggling", "strangling", "ambulance", "flooding", "sparking", "suicide", "attacking",
];
/**
 * Real words one edit from a danger word, never corrected ("cooking" is not "choking", "parking"
 * is not "sparking"). Generated from the danger words' one-edit neighbors that are English words
 * in /usr/share/dict/words (web2), with their plain inflections, plus a few common ones (2026-11-09).
 */
const REAL_WORDS = new Set(
  (
    "afire aflames ailing ambulanced ambulancer ambulances amoking ariling asmoke asmoking attaching " +
    "attackking attasking bailing barning beathing berning birning blames bledding bleding bleedding " +
    "bleedingd bleedings bleeeing bleeing bleezing blending blooding borning bourning brailing " +
    "breaching breadthing breaghe breaghing breath breathd breathed breatheing breather breathes " +
    "breathhing breathingd breathings breaths breathy breathying breeding brething browned browning " +
    "buning bunning buraning burding bureing burging buriing buring burining burking burling burniing " +
    "burningd burnings burnning burnting burnying buroing burping burring bursing burting burying " +
    "carbo carbod carbona carbond carbons carbos carboy cardon caroon carton charbon cheking chobing " +
    "chocking choing chokeing chokingd chokings chokying choling chooing choosing choping choring " +
    "chosing chouing chowing chowking clames coking collapse collapseed collapses cooking crapped " +
    "crowned crowning curning dailing downed downing drailing drawned drawning droned droning drowed " +
    "drowing drownd drowner drownerd drownes drownnd drownned drownning drowsed drowsing drowwed " +
    "drowwing durning explode explodedd explodeds explodeed exploder exploderd explodes explored " +
    "explosiond explosions failing fames fine fired firer fires five flages flakes flambes flambs " +
    "flame flamed flameds flamees flamen flamens flamer flamers flammes flamms flams flamyes flamys " +
    "flanes flapes flares flates flawes flaxes flayes fleames flemes floodding floodingd floodings " +
    "floodying flooing flooring floyding flumes foames fooding frailing frames frapped freathing " +
    "frowned frowning gailing glames gleeding grailing growned growning hailing hire hired hooting " +
    "inconscious jailing kailing klames knifed knifer knifes knives lames leeding looding mailing " +
    "mell melling mells moke moking monoxided monoxides monoxime nailing nife olames overbeard " +
    "overboardd overboards overdoed overdoes overdome overdomed overdone overdoned overdooed overdos " +
    "overdoseed overdoses overdoze overdozed oversoard pailing parking raiaing raiding raifing " +
    "railingd railings railling raining raising raling rapped rauling rialing riling roiling sabbed " +
    "sabbing sailing samelling samells sarking scabbed scabbing scoking scooting seelling seells " +
    "seizured seizures sell selling sells sfooting shabbed shabbing sharking shelling shells shoating " +
    "shooding shooiing shooing shooking shooling shoooing shooping shooring shooteing shootingd " +
    "shootings shootting shorting shoting shotting shouting skelling skells slabbed slabbing slames " +
    "sloking smalling smalls smelld smelles smellingd smellings smellling smellls smelly smellying " +
    "smellys smelting smelts smile smiles smocking smoging smoked smokeing smoker smokes smokingd " +
    "smokings smokying smooking smooting smoring smoting snabbed snabbing snarking snelling snells " +
    "snoking snooting soke soking sooking sooting spacking spaiking spaking spakking spanking " +
    "spareing sparging sparing sparkingd sparkings sparkking sparkling sparksing sparkying sparling " +
    "sparming sparring sparsing sparting sparying spelling spells spoke spoking spooting sprangling " +
    "staabbed staabbing staabed staabing stabbd stabber stabberd stabbes stabbingd stabbings stabed " +
    "stabing stabled stabling starking stelling stells stibbed stibbing stobbed stobbing stoking " +
    "stooting straggling strangeing strangeling strangers strangging stranging strangleing " +
    "stranglingd stranglings strapped striggling stroke struggleing strugglingd strugglings stubbed " +
    "stubbing suicided suicides swabbed swabbing swelling swells tabbed tabbing tailing tapped " +
    "tarpped teapped terapped thoking thrapped tire trailing tramped trampped trapaed traped trappd " +
    "trappedd trappeds trapper trapperd trappes trappyd trappyed trapsed tripped trypped turning " +
    "unconsciousd unconsciouss unresponsived unresponsives urning vailing wailing wire wrapped " +
    "wreathe wreathing "
  )
    .trim()
    .split(" ")
);
/** Misspellings that are not one edit away, or words too short for the rule. */
const COMMON_MISSPELLINGS: [RegExp, string][] = [
  [/\b(gass|gasss|gaz)\b/g, "gas"],
  [/\b(fyre|fier|fiyer)\b/g, "fire"],
  [/\b(smel|smel+)\b/g, "smell"],
  [/\b(bledding|bledin|bleeing|bleding|bleedng)\b/g, "bleeding"],
  [/\b(siezure|seisure|seazure|sezure)\b/g, "seizure"],
  [/\b(unconcious|unconsious|unconscous)\b/g, "unconscious"],
  [/\b(overdoze|overdossed|overdosed)\b/g, "overdosed"],
  [/\b(chokeing|choaking)\b/g, "choking"],
  [/\b(beepin|beepn|beping)\b/g, "beeping"],
  [/\b(oder|odur|odr)\b/g, "odor"],
  [/\b(goin off|goign off)\b/g, "going off"],
];
function oneEditAway(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 2) return diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
    return diff.length === 1 && a.length >= 6;
  }
  const [x, y] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return x.slice(i) === y.slice(i + 1);
}
/** The description with danger keywords read through typos ("smel gas" → "smell gas"). */
export function fuzzyDangerWords(text: string): string {
  let out = text;
  for (const [from, to] of COMMON_MISSPELLINGS) out = out.replace(from, to);
  return out.replace(/[a-z]{4,}/g, (w) => {
    if (REAL_WORDS.has(w) || DANGER_VOCAB.includes(w)) return w;
    const hit = DANGER_VOCAB.find((v) => oneEditAway(w, v));
    return hit ?? w;
  });
}

export function assessDanger(description: string): DangerAssessment {
  let text = normalize(description);
  for (const [from, to] of DANGER_SHORTHAND) text = text.replace(from, to);
  text = fuzzyDangerWords(text);
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
  // Medical words about an animal, with no person in the sentence, are the animal path
  // ("my dog is choking on a bone"), not a medical 911 line.
  if (ANIMAL_WORD.test(text) && !PERSON_WORD.test(text)) kinds = kinds.filter((k) => k.id !== "hurt" && k.id !== "medical_symptoms");
    // An animal hit by a car is the animal path (Injured or Sick Animal), not a crash with someone
  // hurt, unless a person is hurt too.
  if (kinds.some((k) => k.id === "crash") && ANIMAL_HIT.test(text) && !kinds.some((k) => k.id === "hurt" || k.id === "person_hit")) {
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
      if (k.id === "smoke") return ELECTRICAL_SMOKE.test(text) && !/\b(chimneys?|exhaust|smoke ?stacks?|stacks?|vents?|ventilation|grills?|barbecu\w*|restaurants?|cooking|cigarettes?|weed|cigars?|vap\w*)\b/.test(text);
      if (k.id === "crash" || k.id === "vehicle_out_of_control") return false;
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
