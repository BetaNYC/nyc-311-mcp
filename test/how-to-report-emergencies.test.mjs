// QA round 2 on #23: 50 emergencies that must lead with 911, and 20 look-alikes that
// must not (a reviewer's set), plus the safety-first shape of every answer and error.
// Keyword detection will still miss some emergencies; that is why every answer also
// tells the calling assistant to judge for itself (ASSISTANT_INSTRUCTION).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { howToReport, list311Categories, REPORT_TOOLS } from "../dist/how-to-report.js";
import { ASSISTANT_INSTRUCTION, CITY_DV, SAFETY_LINE } from "../dist/emergency.js";
import { ContentClient } from "../dist/content-311.js";
import { fixtureContent } from "./content-fixture.mjs";

const EMERGENCIES = [
"my friend took too many pills and wont wake up","water is pouring through the ceiling near the light fixture",
"my dad isn't breathing","he's having chest pains","my son is having a seizure","someone overdosed in the stairwell","a man is unconscious on the sidewalk",
"she's bleeding a lot","my kid is having an allergic reaction and his throat is swelling","I think my mom is having a stroke","her face is drooping and she can't talk",
"smoke coming out of the outlet","sparks and smoke from the electrical outlet","the outlet is smoking","there's smoke coming from the apartment next door",
"it smells like rotten eggs in the building","gas stove left on and the smell is strong","everyone in the house has headaches and the co alarm is going off",
"the ceiling is collapsing","the scaffolding is falling","a crane is swaying in the wind","the building is shaking and cracking","part of the facade fell onto the sidewalk",
"water is flooding the basement and the electrical panel is sparking","the basement is flooding and my grandmother is down there",
"my husband is beating me","my neighbor is hitting his wife I can hear her screaming","a guy is threatening people with a knife","I heard shots outside","there's a fight outside with a lot of people",
"a toddler is alone on the fire escape","a little kid is wandering alone in the street","my elderly neighbor fell and can't get up","someone is on the subway tracks","a person fell into the river",
"no heat and my baby is freezing it's 10 degrees","someone is threatening to kill himself","a man is lying in the snow not moving","someone is trapped in the elevator","car crashed into a building and the driver is stuck",
"a person was hit by a bus","live wire on the sidewalk","elevator stuck between floors with kids inside","the carbon monoxide detector beeps 4 times","my friend is choking",
"help someone is attacking me","a woman is being dragged into a car","my apartment is on fire","the stove caught fire","house is filling with smoke"
];

const LOOK_ALIKES = [
"my neighbor smokes weed and it comes into my apartment","the fire hydrant is leaking a little","the smoke detector needs batteries","a broken fire alarm box on the corner",
"there was a fight in the park last week","my car was broken into last night","the gas station is overcharging","my stove's gas burner won't light",
"someone stole my package yesterday","the elevator has been broken for a week","a dead tree that might fall someday","the ceiling has a small crack",
"loud music shooting video on my street","the bar is killing it with loud music","fireworks noise every night","the heat is too high in my apartment",
"water drips from the AC unit above onto the sidewalk","my landlord threatened to evict me","a dog is chained up outside all day","my ex keeps calling me"
];

const { client } = await fixtureContent();

for (const d of EMERGENCIES) {
  test(`emergency leads with 911: ${d}`, async () => {
    const out = await howToReport({ description: d }, client);
    assert.ok(out.emergency, `no 911 lead: ${out.first_line}`);
    assert.match(out.first_line, /call 911/i);
  });
}

for (const d of LOOK_ALIKES) {
  test(`look-alike is not flagged: ${d}`, async () => {
    const out = await howToReport({ description: d }, client);
    assert.equal(out.emergency, null, `flagged: ${out.first_line}`);
    assert.equal(out.safety_line, SAFETY_LINE);
  });
}

test("safety first: the safety line is the first field, then the instruction to the assistant", async () => {
  const out = await howToReport({ description: "a pothole on my block" }, client);
  assert.deepEqual(Object.keys(out).slice(0, 3), ["safety_line", "safety_line_source", "assistant_instruction"]);
  assert.equal(out.assistant_instruction, ASSISTANT_INSTRUCTION);
  assert.match(ASSISTANT_INSTRUCTION, /keyword-based and will miss some emergencies/);
  const cats = await list311Categories({}, client);
  assert.deepEqual(Object.keys(cats).slice(0, 2), ["safety_line", "assistant_instruction"]);
  const one = await list311Categories({ category_id: "311-12" }, client);
  assert.equal(one.safety_line, SAFETY_LINE);
  for (const t of REPORT_TOOLS) assert.match(t.description, /keyword-based and will miss some emergencies/, t.name);
});

test("every error starts with the safety line (missing key, nothing saved)", async () => {
  const saved = process.env.NYC_311_API_KEY;
  delete process.env.NYC_311_API_KEY;
  try {
    const c = new ContentClient({ cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-nokey-")), logger: () => {}, fetch: async () => assert.fail("no request") });
    await assert.rejects(howToReport({ description: "a pothole" }, c), (e) => e.message.startsWith(`${SAFETY_LINE} NYC_311_API_KEY environment variable is not set`));
    await assert.rejects(list311Categories({}, c), (e) => e.message.startsWith(SAFETY_LINE));
  } finally {
    if (saved !== undefined) process.env.NYC_311_API_KEY = saved;
  }
  await assert.rejects(howToReport({ description: "a pothole", last_days: 3 }, client), (e) => e.message.startsWith(SAFETY_LINE));
});

test("domestic violence: the City's own 911 and text-911 lines and the HOPE Hotline, cited, no number", async () => {
  const out = await howToReport({ description: "my husband is beating me" }, client);
  assert.equal(out.first_line, CITY_DV.call_911);
  assert.equal(out.emergency.ka_number, "KA-01217");
  assert.match(out.emergency.domestic_violence.text_911, /send them a text/);
  assert.equal(out.best_match.ka_number, "KA-01217");
  assert.doesNotMatch(JSON.stringify(out.emergency), /\d{3}-\d{3}-\d{4}|1-800/);
});

test("a person at risk from cold or water near electricity: 911 first, then the 311 article", async () => {
  const cold = await howToReport({ description: "no heat and my baby is freezing it's 10 degrees" }, client);
  assert.ok(cold.emergency);
  assert.equal(cold.best_match.ka_number, "KA-01036");
  const fixture = await howToReport({ description: "water is pouring through the ceiling near the light fixture" }, client);
  assert.ok(fixture.emergency);
  assert.equal(fixture.best_match.ka_number, "KA-01509");
});

test("'shooting video' is not gunfire; 'shots' is", async () => {
  assert.equal((await howToReport({ description: "loud music shooting video on my street" }, client)).emergency, null);
  assert.equal((await howToReport({ description: "they are shooting a movie on my block" }, client)).emergency, null);
  assert.equal((await howToReport({ description: "I heard shots outside" }, client)).emergency.ka_number, "KA-01557");
});

test("several problems: no hot water and a broken elevator give one match each", async () => {
  const out = await howToReport({ description: "my building has no hot water and the elevator is broken" }, client);
  assert.equal(out.best_match.ka_number, "KA-01036");
  assert.deepEqual(out.other_problems.map((x) => x.best_match.ka_number), ["KA-02015"]);
});
