// Beta retest 15 (2026-11-09) missed four emergencies that belonged to classes the server already
// had ("smel gas in hallway real strong", "a teenager climbed over the bridge railing and is about
// to fall", "man overboard off the staten island ferry", "a bus jumped the curb and hit people at
// the stop"): the class patterns were too narrow. This test generates phrasings for every danger
// class from subjects x verbs x places x tense (at least 30 each) and asserts every one leads with
// 911, and generates ordinary near misses for each class and asserts none does. Danger words are
// also read through typos (fuzzyDangerWords: one edit on words of 4+ letters, never a real word).
// On 1.2.0-beta.15: 112 of 557 generated emergencies missed, 2 of 56 near misses flagged; now 0 and 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessDanger, fuzzyDangerWords } from "../dist/emergency.js";

const product = (...lists) => lists.reduce((acc, list) => acc.flatMap((a) => list.map((b) => [...a, b])), [[]]);
const fill = (template, parts) => template.replace(/\{(\d)\}/g, (_, i) => parts[Number(i)]);

/** Each class: templates and slot values, crossed; at least 30 phrasings each. */
const CLASSES = {
  gas: product(["i smell gas", "smell of gas", "smel gas", "gas smell", "strong gas odor", "it smells like gas", "gass smell"], ["in the hallway", "in my kitchen", "on the street", "in the basement", "real strong"]).map(([a, b]) => `${a} ${b}`),
  fire: product(["the building", "my kitchen", "a car", "the apartment upstairs", "a bus", "the store downstairs"], ["is on fire", "caught fire", "has flames coming out", "is burning", "is in flames"]).map(([a, b]) => `${a} ${b}`),
  smoke: product(["smoke is pouring out of", "thick smoke is coming from", "smoke is filling", "black smoke is billowing out of", "smoke keeps coming out of"], ["the outlet", "my neighbor's apartment", "the hallway", "the basement", "the subway grate", "the electrical panel"]).map(([a, b]) => `${a} ${b}`),
  person_hit: product(["a bus", "a car", "a truck", "a taxi", "a van", "an suv"], ["hit a woman", "jumped the curb and hit people", "ran over a kid", "plowed into the crowd", "struck a cyclist", "drove into pedestrians"], ["at the corner", "at the bus stop"]).map(([a, b, c]) => `${a} ${b} ${c}`),
  person_hit_passive: product(["a woman", "a kid", "an old man", "a cyclist", "my neighbor"], ["was hit by a car", "got hit by a bus", "was struck by a truck", "just got run over"], ["", " and isn't moving"]).map(([a, b, c]) => `${a} ${b}${c}`),
  height: product(["a teenager", "a man", "a woman", "someone", "a kid", "a person"], ["climbed over the bridge railing", "is standing on the ledge of the roof", "is sitting on the edge of the roof", "is hanging off the balcony", "is on the outside of the railing"], ["", " and is about to fall"]).map(([a, b, c]) => `${a} ${b}${c}`),
  water: product(["a man", "a kid", "a woman", "someone", "a teenager"], ["fell overboard off the ferry", "went overboard", "is drowning in the river", "fell into the water at the pier", "went under at the beach and hasn't come up", "is struggling in the water at the pool"]).map(([a, b]) => `${a} ${b}`),
  overboard: product(["man overboard", "woman overboard", "someone went overboard", "a kid fell off the boat into the water", "a passenger fell overboard", "a man jumped overboard"], ["off the staten island ferry", "at the pier", "on the east river ferry", "near the dock", "from the boat"]).map(([a, b]) => `${a} ${b}`),
  medical: product(["my dad", "a man on the bus", "my grandmother", "my roommate", "a woman at the store", "my son"], ["is having a seizure", "can't breathe", "is unconscious", "collapsed and isn't moving", "is choking", "is bleeding heavily", "is clutching his chest", "won't wake up"]).map(([a, b]) => `${a} ${b}`),
  violence: product(["a man", "a guy", "a woman", "two men", "someone"], ["is beating a woman", "is stabbing someone", "is choking a man", "is waving a knife at people", "is swinging a bat at people", "pulled a gun on the driver"], ["on the train", "outside the bodega", "in the stairwell"]).map(([a, b, c]) => `${a} ${b} ${c}`),
  child: product(["a toddler", "a little boy", "a baby", "a kid", "a little girl"], ["wandered into the street", "is alone in a hot car", "is standing on the window ledge", "fell into the pool and nobody is watching", "is running in traffic", "is face down in the bathtub"]).map(([a, b]) => `${a} ${b}`),
  fell_in: product(["a worker", "a man", "a kid", "someone", "a woman"], ["fell into a manhole", "is trapped in a collapsed trench", "fell down the elevator shaft", "is trapped under the rubble", "fell into a sinkhole", "is pinned under a beam"]).map(([a, b]) => `${a} ${b}`),
  co: product(["my carbon monoxide alarm", "the co detector", "the carbon monoxide detector", "my co alarm", "the carbon monoxide alarm in the hallway", "our co detector"], ["is going off", "keeps beeping and we feel dizzy", "went off and my kids are sick", "is sounding", "started beeping"]).map(([a, b]) => `${a} ${b}`).concat(["carbon monoxide in my apartment", "i think there is carbon monoxide leaking"]),
};

/** Ordinary near misses for each class: none may lead with 911. */
const NEAR = {
  gas: ["the gas station on my corner is loud at night", "my gas bill is too high", "the gas stove takes a while to light", "gas prices are crazy", "my building has had no cooking gas for a week", "the smell of the bakery is strong in the morning"],
  fire: ["the store is having a fire sale", "my landlord fired the super", "the fire hydrant is leaking", "the fire escape is rusted", "this new taco place is fire", "the fire alarm goes off every time someone cooks"],
  smoke: ["my neighbor smokes on the balcony every night", "the restaurant smoke fills my bedroom every evening", "smoke from the chimney next door every morning", "people smoke weed in the hallway", "the smoke detector beeps because the battery is low"],
  person_hit: ["a car almost hit me in the crosswalk", "drivers almost hit people at this corner every day", "a car hit my parked car and drove off", "the bus hit the curb and scraped my car", "cars nearly hit kids crossing here", "a car hit a pole last week"],
  height: ["window washers are hanging off the building next door all morning", "the railing on the bridge walkway is loose", "the balcony railing in my building is rusted", "kids hang out on the roof of the parking garage", "the ledge of my building is crumbling"],
  water: ["the pool at the rec center is too cold", "the beach is full of trash", "the ferry was late again", "we are drowning in paperwork", "my phone fell into the river", "the river smells terrible today"],
  medical: ["my chest is tight from stress about rent", "this noise is killing me", "my dog is choking on a bone", "i can't breathe with all the dust from construction", "the music makes me feel like i'm having a heart attack", "my back is killing me from the stairs"],
  violence: ["my neighbors argue loudly every night", "kids play fight on my stoop", "the hardware store sells hammers and axes", "the knife sharpening truck is loud", "a guy is selling knives on the sidewalk", "my upstairs neighbors stomp like they're trying to break through the ceiling"],
  child: ["the baby is crying at the street fair", "kids play in the street every summer when the hydrant is open", "my kid wants a pool in the backyard", "my toddler loves to look out the window at the trucks", "the school bus is late"],
  fell_in: ["my keys fell into a manhole", "my phone fell into the sewer grate", "the manhole cover is missing", "the trench on my block has no fence", "there's a sinkhole forming in the road"],
};

for (const [name, list] of Object.entries(CLASSES)) {
  test(`generated emergencies, ${name}: all lead with 911`, () => {
    const missed = list.filter((d) => !assessDanger(d).kinds.length);
    assert.deepEqual(missed, [], `${missed.length} of ${list.length} missed`);
  });
}

for (const [name, list] of Object.entries(NEAR)) {
  test(`generated near misses, ${name}: none leads with 911`, () => {
    const flagged = list.filter((d) => assessDanger(d).kinds.length);
    assert.deepEqual(flagged, []);
  });
}

test("generator coverage: at least 30 phrasings per main class", () => {
  for (const [name, list] of Object.entries(CLASSES)) assert.ok(list.length >= 30, `${name}: ${list.length}`);
  const total = Object.values(CLASSES).reduce((a, l) => a + l.length, 0);
  assert.ok(total >= 400, String(total));
});

test("fuzzy danger words: one edit on longer words, and common misspellings, never a real word", () => {
  assert.equal(fuzzyDangerWords("smel gas in hallway real strong"), "smell gas in hallway real strong");
  assert.equal(fuzzyDangerWords("gass leak"), "gas leak");
  assert.equal(fuzzyDangerWords("fyre in the building"), "fire in the building");
  assert.equal(fuzzyDangerWords("he is bleding"), "he is bleeding");
  assert.equal(fuzzyDangerWords("she is unconcious"), "she is unconscious");
  for (const d of ["the fine was too high", "they hired a new super", "a loose wire in the hallway", "shooing pigeons off the stoop", "the smile on his face", "my tire is flat"]) {
    assert.equal(fuzzyDangerWords(d), d, d);
  }
});
