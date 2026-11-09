// Beta retest 7 (2026-11-09, home machine, 1.2.0-beta.7). Every phrasing from its report, with
// the answer and confidence expected now, then a new stress set of 43 phrasings.
//
// Confidence. Round 7 counted every word-list entry as one piece of evidence, to stop "dirty"
// (which adds dirty, litter and trash) reading as two. That also merged entries whose words are
// different facets of one problem ("skipped our garbage pickup" adds missed + collection), so
// three right answers dropped to "close call": missed garbage pickup, rodents in my building,
// a homeless person who needs help. Now only an entry marked `synonyms` is one unit.
//
// Routes, from City text recorded 2026-11-09 (read-only, test/fixtures/content/):
//   KA-01051 Unleashed Dog: "a dog that is not leashed in a park or other public place" (category
//     Pets, 311-66, now recorded); KA-02300 Stray or Abandoned Animal; KA-01538 Dangerous
//     Animal: "Call 911 to report animals that are currently threatening or endangering people
//     ... Aggressive"; KA-01014 Buses and Subways: "maintenance, comfort, or cleanliness issues
//     in a station or on a bus or train" go to the MTA; KA-02234 Breaking Park Rules (its
//     "Need something else?" names Unleashed Dog).
//   A car alarm stays with Noise from Alarm (KA-01089: "an alarm that goes off too often or for
//     too long"); Noise from Vehicle names horns, idling and music, not alarms.
//
// Before this round, against 1.2.0-beta.7 and these fixtures: 10 of the 43 new phrasings got a
// wrong best match or none (2 rated strong); of the report's 36, 5 were weak or wrong and 3
// right ones were not strong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, parseQuery, strongEvidence, CONCEPTS, agenciesNamedIn } from "../dist/how-to-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";

const client = await stressClient();

// [description, best article (or first alternative), confidence, leads with 911]
const REPORT = [
  ["the bathroom in my house is dirty", "KA-01074", "close call", false], // Apartment Maintenance Complaint
  ["my landlord didn't install a carbon monoxide detector", "KA-01074", "strong", false], // Apartment Maintenance Complaint
  ["carbon monoxide detector missing in my apartment", "KA-01074", "strong", false], // Apartment Maintenance Complaint
  ["there are roaches all over my kitchen", "KA-02278", "strong", false], // Residential Pest Complaint
  ["there are cockroaches in my apartment", "KA-02278", "strong", false], // Residential Pest Complaint
  ["water is gushing out of a fire hydrant", "KA-01034", "strong", false], // Fire Hydrant Complaint
  ["the bathroom in the subway station is disgusting", "KA-01014", "strong", false], // Buses and Subways
  ["the smoke detectors in my apartment were never installed", "KA-01074", "strong", false], // Apartment Maintenance Complaint
  ["the radiator in my bedroom is leaking water onto the floor", "KA-01036", "close call", false], // Heat or Hot Water Complaint in a Residential Building
  ["my landlord shut off the hot water for repairs and never turned it back on", "KA-01036", "strong", false], // Heat or Hot Water Complaint in a Residential Building
  ["paint is peeling in my kid's room and I think it's lead", "KA-02134", "strong", false], // Lead Paint
  ["the front door lock of my building is broken and anyone can walk in", "KA-01074", "strong", false], // Apartment Maintenance Complaint
  ["there are bedbugs in my apartment", "KA-01236", "strong", false], // Bed Bug Complaint
  ["my upstairs neighbor stomps around and plays music until 3am", "KA-01017", "strong", false], // Noise from Neighbor
  ["a bar on my street blasts music every weekend night", "KA-01085", "strong", false], // Noise from Bar, Club, or Restaurant
  ["a car alarm has been going off for an hour", "KA-01089", "strong", false], // Noise from Alarm
  ["the elevator at my subway station has been out of service all week", "KA-01014", "strong", false], // Buses and Subways
  ["huge pothole on my street that damaged my tire", "KA-01093", "strong", false], // Pothole or Cave-In on Street
  ["the traffic light at the corner is out", "KA-01404", "strong", false], // Traffic or Bicycle Signal Complaint or Request
  ["the streetlight in front of my building has been out for a week", "KA-02463", "strong", false], // Street Light Complaint
  ["the sidewalk is cracked and lifted up by a tree root", "KA-02235", "strong", false], // Broken Sidewalk
  ["the swings in the playground are broken", "KA-01060", "strong", false], // Park Maintenance Complaint
  ["people let their dogs run off leash in the park", "KA-01051", "strong", false], // Unleashed Dog
  ["a dead tree in the park looks like it will fall on the path", "KA-02006", "strong", false], // Dead Tree
  ["people keep dumping old mattresses on the empty lot", "KA-02097", "strong", false], // Illegal Dumping
  ["the trash can on the corner is overflowing", "KA-02143", "strong", false], // Litter Basket Complaint or Request
  ["my recycling wasn't picked up this week", "KA-01788", "strong", false], // Missed Trash, Recycling, or Compost Collection
  ["a car with no plates has been parked on my block for weeks", "KA-02130", "strong", false], // Abandoned Vehicle
  ["a truck is blocking my driveway", "KA-01062", "strong", false], // Blocked Driveway
  ["a tour bus idles outside my window for half an hour every morning", "KA-02222", "strong", false], // Idling Vehicle
  ["there's a strong smell of gas outside on the street", "KA-02048", "close call", true], // Gas Leak
  ["the elevator in my apartment building has been broken for two weeks", "KA-02015", "strong", false], // Elevator or Escalator Complaint
  ["a stray dog is roaming the block and looks aggressive", "KA-02300", "strong", true], // Stray or Abandoned Animal
  ["sanitation skipped our garbage pickup this week", "KA-01788", "strong", false], // Missed Trash, Recycling, or Compost Collection
  ["rodents in my building", "KA-02278", "strong", false], // Residential Pest Complaint
  ["a homeless person on my block needs help", "KA-01037", "strong", false], // Homeless Outreach Assistance
];

for (const [d, ka, confidence, danger] of REPORT) {
  test(`retest 7 phrasing: ${d}`, async () => {
    const out = await howToReport({ description: d }, client);
    const top = out.best_match ?? out.alternatives?.[0] ?? null;
    assert.equal(top?.ka_number ?? null, ka, `${d}: got ${top?.ka_number} ${top?.title}`);
    assert.equal((out.best_match?.confidence ?? "none").split(":")[0], confidence, d);
    assert.equal(Boolean(out.emergency), danger, `${d}: ${out.first_line}`);
    if (danger) assert.match(out.first_line, /call 911/i);
  });
}

test("facets of one problem are separate evidence; synonyms are one", () => {
  const missed = parseQuery("sanitation skipped our garbage pickup this week");
  const units = (t) => [...missed.sources.get(t)];
  assert.notDeepEqual(units("miss"), units("collection"), "missed and collection are two facets");
  const dirty = parseQuery("the sidewalk is dirty");
  assert.deepEqual([...dirty.sources.get("litter")], [...dirty.sources.get("trash")], "litter and trash are one unit");
  const trash = CONCEPTS.find((c) => c.terms.includes("litter"));
  assert.equal(trash.synonyms, true);
  const art = { ka_number: "KA-01788", title: "Missed Trash, Recycling, or Compost Collection", description: "Report a missed trash, recycling, or compost collection." };
  const pool = [art, { ka_number: "KA-02473", title: "Trash and Recycling Collection Request for Residence or Non-Profit", description: "x" }, { ka_number: "KA-01801", title: "Trash, Recycling, and Compost Collection Schedule", description: "x" }];
  assert.equal(strongEvidence(missed, art, pool, new Map([["KA-01788", 19], ["KA-02473", 10]])), true);
});

test("an aggressive animal leads with the City's Dangerous Animal 911 line; an animal that bit a pet does not", async () => {
  for (const d of ["a stray dog is roaming the block and looks aggressive", "a pit bull is attacking people in the park"]) {
    const out = await howToReport({ description: d }, client);
    assert.equal(out.first_line, "Call 911 to report an animal causing a dangerous or hazardous condition.", d);
  }
  assert.equal(assessDanger("a vicious dog bit my dog yesterday").kinds.length, 0);
  assert.equal(assessDanger("the dog next door barks all night").kinds.length, 0);
});

test("an authority named in an article's text is its agency: the MTA for the subway", async () => {
  assert.deepEqual(agenciesNamedIn("run by the Metropolitan Transportation Authority (MTA). The Metropolitan Transportation Authority (MTA) says"), ["Metropolitan Transportation Authority (MTA)"]);
  const out = await howToReport({ description: "the elevator at my subway station has been out of service all week" }, client);
  assert.equal(out.best_match.agency, "Metropolitan Transportation Authority (MTA)");
});

// d: the description; ok: the right articles (empty: none is, and no answer may be strong);
// danger: 911 first.
const CASES = [
  // Housing
  { d: "water is dripping from my ceiling every time the upstairs neighbor showers", ok: ["KA-01509", "KA-01074"] },
  { d: "my apartment has had no heat since Friday", ok: ["KA-01036"] },
  { d: "black mold is growing on my bathroom wall", ok: ["KA-02262"] },
  { d: "mice keep getting into my kitchen cabinets", ok: ["KA-02278"] },
  { d: "my landlord keeps threatening to evict me and cut off my services", ok: ["KA-01042", "KA-01216"] },
  { d: "there is no water coming out of the taps in my building", ok: ["KA-01405"] },
  { d: "the window guards in my kid's room are missing", ok: ["KA-02132", "KA-01074", "KA-03097"] },
  { d: "the toilet in my apartment has been clogged for a week and the super won't fix it", ok: ["KA-01074"] },
  { d: "the ceiling in my hallway has a big crack and plaster is falling", ok: ["KA-01074"] },
  // Noise
  { d: "construction crew is drilling at 5am on a Sunday", ok: ["KA-01091"] },
  { d: "people are setting off fireworks every night", ok: ["KA-02249"] },
  { d: "my neighbor's dog howls all day while they are at work", ok: ["KA-01087"] },
  { d: "a club on my block plays bass so loud my windows shake", ok: ["KA-01085"] },
  { d: "a huge party with a DJ in the street", ok: ["KA-01591", "KA-01092"] },
  { d: "motorcycles revving their engines outside at midnight", ok: ["KA-01102"] },
  // Street
  { d: "a stop sign was knocked over by a truck", ok: ["KA-01063"] },
  { d: "the street is flooded after the rain and cars can't pass", ok: ["KA-02198"] },
  { d: "graffiti all over the wall of the bodega", ok: ["KA-02070"] },
  { d: "a food cart is selling on the corner without a permit", ok: ["KA-02152"] },
  { d: "the bus shelter glass is smashed", ok: ["KA-01071"] },
  { d: "water is bubbling up from a crack in the street", ok: ["KA-01234"] },
  { d: "the walk signal at the crosswalk doesn't work", ok: ["KA-01404", "KA-01047"] },
  // Parks
  { d: "the water fountain in the park is broken", ok: ["KA-01060"] },
  { d: "someone is grilling on the beach where it's not allowed", ok: ["KA-02228", "KA-02234"] },
  { d: "rats running all over the playground", ok: ["KA-01107"] },
  { d: "a big branch fell in the park and is blocking the path", ok: ["KA-02138"] },
  // Sanitation
  { d: "compost bin wasn't collected on our pickup day", ok: ["KA-01788"] },
  { d: "someone dumped a pile of tires on the sidewalk", ok: ["KA-02097"] },
  { d: "garbage is piled up in the hallway of my building", ok: ["KA-01074"] },
  { d: "a dead pigeon on the sidewalk in front of my house", ok: ["KA-02245"] },
  // Vehicles and transit
  { d: "a delivery van is parked in the crosswalk every morning", ok: ["KA-01986"] },
  { d: "a car has been parked in a no parking zone all week", ok: ["KA-01986"] },
  { d: "the parking meter on my block ate my coins", ok: ["KA-01240"] },
  { d: "a car with flat tires has been sitting on my street for a month", ok: ["KA-02130"] },
  { d: "the subway car was filthy and the AC was broken", ok: ["KA-01014"] },
  { d: "people keep letting their dog off the leash on my block", ok: ["KA-01051"] },
  // Safety (911 first) and near misses
  { d: "my neighbor's kitchen is on fire", danger: true },
  { d: "a man collapsed on the sidewalk and isn't breathing", danger: true },
  { d: "a pit bull is attacking people in the park", danger: true },
  { d: "power lines are down across the road and sparking", danger: true },
  { d: "a vicious dog bit my dog yesterday", ok: [] },
  { d: "the hydrant outside the deli has been spraying water all afternoon", ok: ["KA-01034"] },
  { d: "the fire escape window in my apartment is blocked by the landlord's bars", ok: ["KA-02233", "KA-01074"] },

];

for (const c of CASES) {
  test(`stress 8: ${c.d}`, async () => {
    const out = await howToReport({ description: c.d }, client);
    if (c.danger) {
      assert.ok(out.emergency, `no 911 lead: ${out.first_line}`);
      assert.match(out.first_line, /call 911/i);
      return;
    }
    assert.equal(out.emergency, null, `flagged as an emergency: ${out.first_line}`);
    const top = out.best_match ?? out.alternatives?.[0] ?? null;
    if (c.ok.length) assert.ok(c.ok.includes(top?.ka_number), `${c.d}: ${top?.ka_number} ${top?.title}; want ${c.ok.join(" or ")}`);
    else assert.doesNotMatch(out.best_match?.confidence ?? "", /^strong/);
  });
}

test("stress 8 is at least 40 new phrasings, none from rounds 6 and 7", () => {
  assert.ok(CASES.length >= 40);
  assert.equal(new Set(CASES.map((c) => c.d)).size, CASES.length);
});
