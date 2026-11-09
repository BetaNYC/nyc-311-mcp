// Beta retest 8 (2026-11-09, home machine, 1.2.0-beta.8) FAILED on three wrong answers rated
// strong. The worst: "loud party next door at 2am" led with "Call 911 to report a large, loud
// party that has potential for danger". No danger kind fired: round 8's party entry searched for
// "party" and "crowd", which made Noise from Large Party or Crowd (KA-01591, a Call-911-only
// article) the strong best match, and an answer whose strong best match says "Call 911" led with
// it. Now that article's 911 is read as conditional (CONDITIONAL_911) and leads only when a danger
// was detected; such an article is never the strong answer to a description with no danger; and
// a party is searched as noise, so whose noise it is picks the article.
//
// Before this round (1.2.0-beta.8, these fixtures): 6 of the 35 non-emergencies below led with
// 911; 14 of the report's 30 phrasings had a wrong article (2 rated strong); 19 of the 40 new
// stress phrasings had a wrong article or a wrong 911 line (8 rated strong or a wrong 911).
//
// Routes from City text recorded 2026-11-09 read-only (test/fixtures/content/): Illegal Eviction
// or Lockout (KA-02518: "Call 911 to report ... landlords who lock out tenants"); Illegal Parking
// (KA-01986: "Blocking a: ... Crosswalk, Bike lane, ... Bus stop"; the Bike Lane article says
// "Illegal Parking to report a vehicle blocking a bike lane"); Noise from Helicopter, Manhole
// Cover Complaint, Pavement Marking Complaint, Snow or Ice on Sidewalk, Taxi Complaint, Illegal
// Animal ("most farm, wild, and exotic animals cannot be kept as pets"), Wild Animal, Citi Bike,
// Buses and Subways, Cable Complaint, Stolen Property; and for the stress set Food Safety,
// Boiler, Film or Television Production, Tree Pruning, Chained Bike, Sewer Backup, Loose
// Syringes, Cigarette Sale and Crane or Derrick complaints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, articleSays911, CONDITIONAL_911, EMERGENCY_CONFIDENCE, EMERGENCY_CONFIDENCE_NOTE, parseQuery } from "../dist/how-to-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";

const client = await stressClient();
const kind911 = (out) => (out.emergency ? "danger" : /^call 911/i.test(out.first_line) ? "article" : "none");

function check(rows, label) {
  for (const [d, ka, confidence, f] of rows) {
    test(`${label}: ${d}`, async () => {
      const out = await howToReport({ description: d }, client);
      const top = out.best_match ?? out.alternatives?.[0] ?? null;
      assert.equal(kind911(out), f, `${d}: first line "${out.first_line}"`);
      if (Array.isArray(ka)) assert.ok(ka.includes(top?.ka_number), `${d}: got ${top?.ka_number} ${top?.title}`);
      else assert.equal(top?.ka_number ?? null, ka, `${d}: got ${top?.ka_number} ${top?.title}`);
      const got = (out.best_match?.confidence ?? "none").split(":")[0];
      if (confidence === "not strong") assert.notEqual(got, "strong", d);
      else assert.equal(got, confidence, d);
    });
  }
}

// [description, best article (or first alternative), confidence, 911 line: "danger" (a danger
// was detected), "article" (the matched City article says Call 911), "none"]
const REPORT = [
  ["my ceiling leaks every time it rains", "KA-01509", "strong", "none"], // Water Leak in a Building
  ["the landlord changed the locks and won't let me back in", "KA-02518", "strong", "article"], // Illegal Eviction or Lockout
  ["mice keep getting into my kitchen cabinets", "KA-02278", "strong", "none"], // Residential Pest Complaint
  ["the window guards in my child's bedroom are missing", "KA-02132", "strong", "none"], // Window Guard Complaint
  ["a construction crew is jackhammering at 5am", "KA-01091", "strong", "none"], // Noise from Construction
  ["a helicopter keeps circling low over my neighborhood", "KA-02267", "strong", "none"], // Noise from Helicopter
  ["my neighbor's air conditioner hums loudly all night", "KA-01933", "close call", "none"], // Noise from Air Conditioner or Ventilation Equipment
  ["someone spray painted graffiti on the wall of my store", "KA-02070", "strong", "none"], // Graffiti
  ["the manhole cover on my street rattles every time a car drives over it", "KA-01669", "strong", "none"], // Manhole Cover Complaint
  ["the crosswalk paint has faded away at the school corner", "KA-01100", "strong", "none"], // Pavement Marking Complaint or Request
  ["a street sign got knocked down at the intersection", "KA-01063", "strong", "none"], // Street Sign Complaint
  ["the water fountain in the park doesn't work", "KA-01060", "strong", "none"], // Park Maintenance Complaint
  ["people are barbecuing in a part of the park where it's not allowed", "KA-02228", "strong", "none"], // Barbecuing
  ["a big tree branch broke off and is hanging over the sidewalk", "KA-02138", "strong", "none"], // Fallen Tree or Branch
  ["snow hasn't been cleared from the sidewalk in front of a store", "KA-01397", "strong", "none"], // Snow or Ice on Sidewalk
  ["my bulky furniture pickup never happened", "KA-01788", "strong", "none"], // Missed Trash, Recycling, or Compost Collection
  ["there's a dead rat lying on the sidewalk", "KA-02245", "strong", "none"], // Dead Animal on Public Property
  ["a car is parked in the bike lane every single day", "KA-01986", "strong", "none"], // Illegal Parking
  ["a yellow cab driver was rude and overcharged me", "KA-01241", "strong", "none"], // Taxi Complaint
  ["someone parked right in front of a fire hydrant on my block", "KA-01986", "strong", "none"], // Illegal Parking
  ["my neighbor keeps a rooster in the backyard", "KA-02255", "strong", "none"], // Illegal Animal
  ["a dog has been left locked in a hot car in the parking lot", "KA-01033", "strong", "danger"], // Dangerous Location or Situation
  ["raccoons keep getting into the garbage behind my building", "KA-01790", "strong", "none"], // Wild Animal
  ["my bus never showed up even though the app said it was coming", "KA-01014", "strong", "none"], // Buses and Subways
  ["the Citi Bike dock on my corner is broken", "KA-02221", "strong", "none"], // Citi Bike
  ["the subway car I rode was filthy and smelled terrible", "KA-01014", "strong", "none"], // Buses and Subways
  ["someone is breaking into the car next to mine right now", "KA-01033", "strong", "danger"], // Dangerous Location or Situation
  ["my neighbor collapsed and isn't breathing", "KA-01581", "strong", "danger"], // Medical Emergency
  ["a package was stolen from my building lobby yesterday", "KA-01219", "strong", "none"], // Stolen Property
  ["my internet provider keeps dropping my connection", "KA-01058", "strong", "none"], // Cable Complaint
];
check(REPORT, "retest 8 phrasing");

// Ordinary complaints that must never lead with 911.
const NEVER_911 = [
  "loud party next door at 2am",
  "my neighbors had a party until 4am again",
  "the party upstairs is so loud I can't sleep",
  "a birthday party in the backyard next door with loud music",
  "there's a block party on my street with loud music",
  "a crowd of people hanging out in front of the bodega every night",
  "kids yelling in the playground after dark",
  "my neighbor's dog barks all day",
  "the dog next door howls whenever they leave",
  "a rooster crows every morning in my neighbor's yard",
  "my neighbor's cat keeps coming into my yard",
  "pigeons on my fire escape",
  "the people upstairs stomp around at night",
  "my neighbor plays the drums every evening",
  "my neighbor smokes on the balcony and it comes into my window",
  "the guy downstairs blasts his TV",
  "a car alarm went off three times last night",
  "cars honking at the intersection all day",
  "someone keeps parking in front of my driveway",
  "motorcycles drag racing down my block every weekend",
  "an ice cream truck parks outside my building for hours",
  "a car has been double parked for an hour",
  "my neighbor's security light shines into my bedroom",
  "the bar on the corner has music until 4am",
  "a street fair blocked my block on Sunday",
  "fireworks were going off last weekend",
  "there was a fight outside the bar last week",
  "the garbage truck wakes me up at 5am",
  "my neighbor's air conditioner drips on my window",
  "a helicopter flies over my apartment every night",
  "the dog park is full of off leash dogs at night",
  "a loud argument next door last night",
  "the smoke detector beeps because it needs a battery",
  "my landlord said he will fix the boiler next week",
  "someone stole my bike from the rack last month"
];
for (const d of NEVER_911) {
  test(`never 911: ${d}`, async () => {
    const out = await howToReport({ description: d }, client);
    assert.equal(out.emergency, null, `${d}: flagged ${JSON.stringify(out.emergency?.dangers)}`);
    // No "Call 911" line. (A description nothing matched keeps the general safety line, "If anyone
    // is in danger right now, call 911", as every no-match answer does: it names no danger.)
    assert.doesNotMatch(out.first_line, /^call 911/i, `${d}: ${out.first_line}`);
  });
}

// Emergencies that must lead with 911.
const ALWAYS_911 = [
  "someone is breaking into my neighbor's apartment right now",
  "a huge fight with knives outside the bar right now",
  "there's a fire in the apartment upstairs",
  "I smell gas in the hallway",
  "my carbon monoxide detector is going off",
  "a man collapsed on the subway platform and isn't breathing",
  "a car crashed into a bus stop and people are hurt",
  "a pit bull is attacking a child in the park",
  "power lines are down and sparking on my street",
  "a kid is locked in a hot car",
  "my husband is hitting me",
  "someone fired shots outside"
];
for (const d of ALWAYS_911) {
  test(`always 911: ${d}`, async () => {
    const out = await howToReport({ description: d }, client);
    assert.ok(out.emergency, `${d}: no 911 lead`);
    assert.match(out.first_line, /call 911/i);
  });
}

test("the two sets are big enough", () => {
  assert.ok(NEVER_911.length >= 30 && ALWAYS_911.length >= 10);
});

test("a Call-911 article leads only when its 911 is unconditional or a danger was detected", () => {
  const none = parseQuery("loud party next door at 2am");
  assert.equal(none.danger.kinds.length, 0);
  assert.ok(CONDITIONAL_911.test("Call 911 to report a large, loud party that has potential for danger."));
  assert.equal(articleSays911("Call 911 to report a large, loud party that has potential for danger.", none), false);
  const lockout = parseQuery("the landlord changed the locks and won't let me back in");
  assert.equal(articleSays911("Call 911 to report an eviction that was not performed by a NYC Marshal or Sheriff.", lockout), true);
  const past = parseQuery("a package was stolen from my building lobby yesterday");
  assert.equal(articleSays911("Call 911 to report stolen property.", past), false, "a theft that is over gets the crime pointer");
});

test("an emergency answer rates its own City article strong, and otherwise says what the rating is for", async () => {
  const gas = await howToReport({ description: "I smell gas in my kitchen" }, client);
  assert.equal(gas.best_match.ka_number, gas.emergency.ka_number);
  assert.equal(gas.best_match.confidence, EMERGENCY_CONFIDENCE);
  const crime = await howToReport({ description: "someone is breaking into the car next to mine right now" }, client);
  assert.ok(crime.emergency);
  if (crime.best_match.ka_number !== crime.emergency.ka_number) assert.equal(crime.best_match.confidence_note, EMERGENCY_CONFIDENCE_NOTE);
  const party = await howToReport({ description: "loud party next door at 2am" }, client);
  assert.equal(party.best_match.confidence_note, undefined);
});

test("danger words in ordinary complaints", () => {
  assert.equal(assessDanger("the fire alarm in my building keeps going off for no reason").kinds.length, 0);
  assert.ok(assessDanger("the fire alarm is going off and there's smoke in the hallway").kinds.length > 0);
  assert.equal(assessDanger("my neighbor's dog attacked my cat").kinds.length, 0);
  assert.ok(assessDanger("a dog attacked a child on my block").kinds.length > 0);
});

// Stage 9 stress set: 40 new phrasings, weighted to near misses and to two articles competing.
const STRESS = [
  ["my upstairs neighbor's bathtub overflowed and water is coming through my light fixture", "KA-01074", "possible", "danger"], // Apartment Maintenance Complaint
  ["there's a burning smell from the restaurant exhaust every night", "KA-01930", "strong", "none"], // Restaurant Odor
  ["the gas stove in my apartment doesn't light", "KA-01074", "strong", "none"], // Apartment Maintenance Complaint
  ["my landlord turned off the gas for repairs a month ago and never turned it back on", "KA-01074", "strong", "none"], // Apartment Maintenance Complaint
  ["the boiler in my building makes a banging noise", "KA-02047", "strong", "none"], // Boiler Complaint
  ["someone is shooting a movie on my block and blocking parking", "KA-01461", "strong", "none"], // Film or Television Production Complaint
  ["the construction site next door has no fence and kids play there", ["KA-01905", "KA-02050", "KA-01797"], "not strong", "none"], // Unsafe Construction Material Storage
  ["a crane is swinging over the sidewalk without any barrier", "KA-02053", "strong", "none"], // Crane or Derrick Complaint
  ["the scaffolding in front of my building has been up for three years", "KA-02291", "strong", "none"], // Scaffold or Sidewalk Shed Complaint
  ["a man is sleeping in the doorway of my building every night", "KA-02253", "close call", "none"], // Homeless Encampment
  ["a homeless encampment under the highway overpass", "KA-02253", "close call", "none"], // Homeless Encampment
  ["someone left a shopping cart full of trash on the corner", "KA-01803", "close call", "none"], // Dirty Sidewalk
  ["there's broken glass all over the playground", "KA-01060", "strong", "none"], // Park Maintenance Complaint
  ["a needle on the sidewalk near the school", "KA-02475", "strong", "none"], // Loose Syringes
  ["a tree fell on a parked car during the storm", "KA-02138", "strong", "none"], // Fallen Tree or Branch
  ["the tree in front of my house needs pruning", "KA-01794", "close call", "none"], // Tree Pruning
  ["my street hasn't been plowed since the snowstorm", "KA-02296", "strong", "none"], // Snow or Ice on Street or Highway
  ["there's black ice on the sidewalk outside the subway entrance", "KA-01397", "strong", "none"], // Snow or Ice on Sidewalk
  ["a water main broke and the street is flooding", "KA-01233", "strong", "none"], // Water Main Break
  ["there's sewage backing up into my basement", "KA-01510", "strong", "none"], // Sewer Backup
  ["the sewer grate on my corner smells awful", "KA-02315", "close call", "none"], // Catch Basin or Sewer Odor
  ["a car has been parked with its engine running for an hour", "KA-02222", "strong", "none"], // Idling Vehicle
  ["a truck is idling with its engine on in front of the school", "KA-02222", "strong", "none"], // Idling Vehicle
  ["a car is blocking the crosswalk", "KA-01986", "strong", "none"], // Illegal Parking
  ["someone parked in a handicapped spot without a permit", "KA-01986", "strong", "none"], // Illegal Parking
  ["cars keep running the red light at this intersection", "KA-01404", "strong", "none"], // Traffic or Bicycle Signal Complaint or Request
  ["the traffic light is stuck on green and cars are speeding through", "KA-01404", "strong", "none"], // Traffic or Bicycle Signal Complaint or Request
  ["the bus stop sign is missing", "KA-01063", "strong", "none"], // Street Sign Complaint
  ["the speed bump on my block is broken", null, "none", "none"], // 
  ["a bike is chained to the tree in front of my building for months", "KA-02218", "strong", "none"], // Chained Bike
  ["the street vendor sells loud music and food till midnight", "KA-02152", "strong", "none"], // Street Vendor Complaint
  ["the deli on the corner sells loose cigarettes to kids", "KA-02627", "strong", "none"], // Cigarette Sale Complaint
  ["a restaurant has rats in the kitchen", "KA-01111", "strong", "none"], // Food Safety Complaint
  ["I got food poisoning from a food cart", "KA-02051", "strong", "none"], // Food Poisoning
  ["my neighbor's dog attacked my cat", null, "none", "none"], // 
  ["a coyote is wandering in the park during the day", "KA-01790", "strong", "none"], // Wild Animal
  ["a raccoon is acting strangely and foaming at the mouth", "KA-01538", "strong", "danger"], // Dangerous Animal
  ["a bat flew into my apartment", "KA-01790", "strong", "none"], // Wild Animal
  ["the fire alarm in my building keeps going off for no reason", "KA-01089", "strong", "none"], // Noise from Alarm
  ["my apartment smells like smoke from a neighbor's cigarettes", "KA-03662", "strong", "none"], // Smoke Free Air Act Complaint
];
check(STRESS, "stress 9");
test("stress 9 is 40 phrasings", () => assert.equal(STRESS.length, 40));
