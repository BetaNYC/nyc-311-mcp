// Beta retest 11 (2026-11-09, home machine, 1.2.0-beta.11) FAILED: eight emergencies happening now
// got no emergency block. Two causes, both fixed here:
//   - the recurring rule (round 11) switched dangers off though the description also said
//     something was happening now ("...and now he isn't moving", "...and one just fell through").
//     Now any present signal anywhere keeps every danger on, and smoke from an outlet, wiring,
//     an appliance, a battery or a boiler room is never switched off;
//   - missing danger classes: a person hit by a vehicle (said either way round), someone calling
//     for help, someone on or pushed onto the tracks, someone through the ice, someone trying a
//     door, a car flipped with people inside.
// And defense in depth (test/safety-line.test.mjs): every answer starts with one fixed line,
// whatever was detected. Also: someone hurt never goes to a social-service article.
// Measured on 593 phrasings (rounds 6 to 12): on beta.11, 19 missed emergencies, 2 ordinary
// complaints leading with 911 and 7 wrong answers rated strong; now none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { howToReport, sensitiveAllowed, parseQuery } from "../dist/how-to-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";

const client = await stressClient();
const kinds = (d) => assessDanger(d).kinds.map((k) => k.id);

test("a present signal anywhere keeps the danger on, whatever recurs", () => {
  for (const d of [
    "my neighbor keeps falling and now he isn't moving",
    "every night someone tries my door and he's trying it right now",
    "kids always play on the ice at the pond and one just fell through",
    "cars always crash at this intersection and one just flipped over with people inside",
    "my dad keeps having chest pains every day and now he collapsed",
  ]) assert.ok(kinds(d).length, d);
});

test("smoke from wiring, an outlet, an appliance, a battery or a boiler room is never switched off", () => {
  for (const d of ["smoke keeps coming out of the outlet in my bedroom", "the boiler room in my building keeps filling with smoke every morning", "the space heater in my room keeps smoking", "smoke keeps coming out of my e-bike battery"]) {
    assert.ok(kinds(d).includes("smoke"), d);
  }
  assert.deepEqual(kinds("black smoke pours out of the chimney next door every morning"), [], "a chimney's daily smoke is still a complaint");
});

test("new danger classes, said in general ways", () => {
  const cases = {
    person_hit: ["a bus hit a cyclist and he's lying in the street", "a pedestrian was struck by a car on my corner", "a delivery guy on an e-bike was struck by a truck", "a kid on a scooter got doored"],
    calling_for_help: ["a woman is screaming for help from the apartment above mine", "I can hear someone yelling help help in the alley"],
    tracks: ["a man pushed someone onto the subway tracks", "someone fell onto the tracks at the station"],
    water_rescue: ["a dog went through the ice and a man went in after it", "kids were on the frozen pond and one fell through"],
    crime: ["someone is trying my front door right now", "a guy is punching people on the subway car right now"],
    trapped: ["a woman got her arm stuck in the train doors and it's moving"],
  };
  for (const [kind, ds] of Object.entries(cases)) for (const d of ds) assert.ok(kinds(d).includes(kind), `${kind}: ${d} → ${kinds(d)}`);
  for (const d of ["cars almost hit people at this crosswalk every day", "people keep walking on the subway tracks to get their phones", "the fire alarm in my building goes off every time someone cooks"]) {
    assert.deepEqual(kinds(d), [], d);
  }
});

test("someone hurt never goes to homeless outreach or another social service", async () => {
  assert.equal(sensitiveAllowed("Homeless Outreach Assistance", parseQuery("a bus hit a cyclist and he's lying in the street")), false);
  assert.equal(sensitiveAllowed("Homeless Outreach Assistance", parseQuery("a man sleeps on the bench every night")), true);
  const out = await howToReport({ description: "a bus hit a cyclist and he's lying in the street" }, client);
  assert.ok(out.emergency);
  assert.ok(![out.best_match, ...out.alternatives].some((a) => a && /homeless|outreach|shelter/i.test(a.title)));
});

test("the report's wrong strong answers", async () => {
  const want = {
    "a woman is screaming for help from the apartment above mine": (a) => !/noise/i.test(a.title),
    "a man pushed someone onto the subway tracks": (a) => a.ka_number !== "KA-01014",
    "an abandoned building on my block has its doors wide open": (a) => a.ka_number === "KA-01901",
    "someone dumped a mattress crawling with bed bugs on the curb": (a) => a.ka_number === "KA-02097",
    "there's a dead bird on my fire escape": (a) => a.ka_number !== "KA-02245",
    "dead pigeons keep piling up on the roof next door": (a) => a.ka_number !== "KA-02245",
    "the paint in my apartment is peeling and I'm worried about lead": (a) => a.ka_number === "KA-02134",
  };
  for (const [d, ok] of Object.entries(want)) {
    const out = await howToReport({ description: d }, client);
    const top = out.best_match ?? out.alternatives[0];
    assert.ok(top && ok(top), `${d}: ${top?.ka_number} ${top?.title}`);
  }
});
