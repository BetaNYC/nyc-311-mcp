// Beta retest 6 (2026-11-09, home machine): two wrong routes rated "strong".
//   "bathroom in my house is dirty" → Litter Basket Complaint or Request (KA-02143)
//   "landlord didn't install a carbon monoxide detector" → Vehicle Stored on Residential Property
// Why they were strong: strongEvidence counted the person's problem words per word, and one
// word-list entry adds several ("dirty" adds dirty, litter and trash), so one word read as two
// pieces of evidence; and a match resting only on context ("car" inside "carbon", "residential"
// from "landlord") could be strong. Now evidence is counted per entry, and must include the
// problem itself. The routes, from the recorded City text (test/fixtures/content/):
//   KA-01074 Apartment Maintenance Complaint: "broken or missing smoke alarms, carbon monoxide
//     detectors"; "owners are required to install carbon monoxide detectors"; "Unsanitary
//     conditions". A dirty room at home is offered there as a possible match only: the article
//     is for a rental the owner must keep up, and a person's own home has no 311 complaint.
//
// Then a stress set of realistic phrasings across housing, noise, street, parks, sanitation,
// vehicles and safety, with near misses, run offline through the matcher. Before this round,
// 7 of these 68 were wrong (6 rated strong): the two above, "landlord didn't install a CO
// detector", roaches → Rat or Mouse, a gushing hydrant → Water Main Break, a dirty subway
// bathroom → Litter Basket, and smoke detectors never installed → Smoke Free Air Act Complaint.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { howToReport, parseQuery, strongEvidence, CONCEPTS, DIRTY_AT_HOME } from "../dist/how-to-report.js";
import { ContentClient } from "../dist/content-311.js";
import { CONTENT, fixtureContent, recorded } from "./content-fixture.mjs";

const { client } = await fixtureContent();
const HPD = "Department of Housing Preservation and Development";

test("a carbon monoxide detector the landlord did not install is an HPD apartment maintenance complaint", async () => {
  for (const description of ["landlord didn't install a carbon monoxide detector", "landlord didn't install a CO detector", "the landlord never installed smoke detectors in the building"]) {
    const out = await howToReport({ description }, client);
    assert.equal(out.emergency, null, `${description}: not a 911 case (nothing is going off)`);
    assert.equal(out.best_match?.ka_number, "KA-01074", `${description}: got ${out.best_match?.ka_number ?? out.alternatives?.[0]?.ka_number}`);
    assert.equal(out.best_match.agency, HPD);
    assert.notEqual(out.alternatives[0]?.ka_number, "KA-01991");
  }
});

test("a dirty bathroom at home is a possible Apartment Maintenance match, never a strong litter basket", async () => {
  const out = await howToReport({ description: "bathroom in my house is dirty" }, client);
  assert.equal(out.best_match?.ka_number, "KA-01074");
  assert.doesNotMatch(out.best_match.confidence, /^strong/);
  assert.ok(!(out.alternatives ?? []).some((a) => a.ka_number === "KA-02143"), "no litter basket");
  assert.equal(DIRTY_AT_HOME.test("the bathroom in the subway station is dirty"), true, "matches the words; the concept's unless keeps it out");
  const subway = await howToReport({ description: "bathroom in the subway station is dirty" }, client);
  assert.notEqual(subway.best_match?.ka_number, "KA-01074");
  assert.notEqual(subway.best_match?.ka_number, "KA-02143");
});

test("root cause: one word-list entry is one piece of evidence, and context alone is never strong", () => {
  const litter = { ka_number: "KA-02143", title: "Litter Basket Complaint or Request", description: "Report a public trash can that is missing, overflowing, or being misused." };
  const rivals = [litter, { ka_number: "KA-02141", title: "Dirty Gutter", description: "x" }, { ka_number: "KA-01803", title: "Dirty Sidewalk", description: "x" }, { ka_number: "KA-01673", title: "Littering", description: "x" }, { ka_number: "KA-01672", title: "Litter on Highway", description: "x" }, { ka_number: "KA-02356", title: "Trash or Debris in Street", description: "x" }];
  // "the sidewalk is dirty": dirty adds litter and trash too; that is one thing said, not two.
  const q = parseQuery("the sidewalk is dirty");
  assert.ok(q.terms.has("litter") && q.terms.has("trash"));
  assert.equal(new Set([...q.sources.get("litter")]).size, 1);
  assert.deepEqual([...q.sources.get("litter")], [...q.sources.get("trash")]);
  assert.equal(strongEvidence(q, litter, rivals, new Map([["KA-02143", 12], ["KA-01803", 11]])), false);
  // A vehicle and a building are context: no problem entry, so not strong.
  const stored = { ka_number: "KA-01991", title: "Vehicle Stored on Residential Property or Vacant Lot", description: "Report a vehicle stored on residential property or in a vacant lot." };
  const ctx = parseQuery("my landlord parks his truck in the residential building garage at night");
  assert.equal(strongEvidence({ ...ctx, problemSources: new Set() }, stored, [stored], new Map([["KA-01991", 20]])), false);
  // "carbon" is not a car.
  const vehicle = CONCEPTS.find((c) => c.terms.length === 1 && c.terms[0] === "vehicle");
  assert.equal(vehicle.when.test("landlord didn't install a carbon monoxide detector"), false);
  assert.equal(vehicle.when.test("a car is blocking the hydrant"), true);
  // "tenant" is not a tent; "yellow" is not yelling; "ice cream" is not ice.
  assert.ok(!parseQuery("my tenant says the toilet is broken").families.includes("homeless"));
  assert.ok(!parseQuery("a yellow cab parked here").families.includes("noise"));
  assert.ok(!parseQuery("the ice cream truck jingle is driving me crazy").families.includes("snow"));
});

// Articles the stress set reaches that were never recorded in full are served from their own
// summary in the recorded category lists (title and description, no sections). Ranking and
// confidence read only the summary, so the answer's article and confidence are the same as
// with the full text; only its report options are missing.
const lists = path.join(CONTENT, "GetContentList");
const summaries = new Map();
for (const f of await readdir(lists)) for (const a of JSON.parse(await readFile(path.join(lists, f), "utf8")).ContentArticleList ?? []) summaries.set(a.id, a);
const stressClient = new ContentClient({
  apiKey: () => "test-key-never-sent-anywhere",
  cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-stress-")),
  minIntervalMs: 0,
  logger: () => {},
  fetch: async (u) => {
    const body = await recorded(u);
    if (body) return Response.json(body);
    const url = new URL(String(u));
    const op = url.pathname.split("/").pop();
    const s = op === "GetContent" ? summaries.get(url.searchParams.get("SearchText")) : null;
    if (s) return Response.json({ KnowledgeArticle: [{ ArticlePublicNumber: s.id, Title: s.title, Description: s.description, Section: [] }] });
    return Response.json(op === "GetContentList" ? { ContentArticleList: [] } : { KnowledgeArticle: [] });
  },
});

// d: the description; ok: the articles that are right for it (empty: none is); must: the first
// article must be one of ok (otherwise only a strong answer must be); danger: 911 first.
const CASES = [
  // Housing
  { d: "bathroom in my house is dirty", ok: ["KA-01074"] },
  { d: "landlord didn't install a CO detector", ok: ["KA-01074"], must: true },
  { d: "landlord didn't install a carbon monoxide detector", ok: ["KA-01074"], must: true },
  { d: "there is no smoke detector in my apartment", ok: ["KA-01074", "KA-03606"] },
  { d: "my landlord won't replace the broken smoke alarm", ok: ["KA-01074"] },
  { d: "the paint is peeling in my kid's bedroom", ok: ["KA-01074", "KA-02134"] },
  { d: "my landlord refuses to fix the front door lock", ok: ["KA-01074"] },
  { d: "the radiator in my apartment is cold and it's freezing", ok: ["KA-01036"] },
  { d: "my tenant says the toilet is broken", ok: ["KA-01074"] },
  { d: "roaches all over my kitchen", ok: ["KA-02278", "KA-01074"] },
  { d: "the house next door is a mess and smells", ok: ["KA-01332", "KA-02133", "KA-01548"] },
  { d: "the window in my bedroom won't close", ok: ["KA-01074"] },
  { d: "my landlord won't install window guards and I have a toddler", ok: ["KA-02132", "KA-01074", "KA-03097"] },
  // Noise
  { d: "my upstairs neighbor plays loud music at 2am", ok: ["KA-01017"] },
  { d: "the bar downstairs is blasting music", ok: ["KA-01085"] },
  { d: "a dog has been barking for hours next door", ok: ["KA-01087"] },
  { d: "car alarm going off all night on my street", ok: ["KA-01089", "KA-01102"] },
  { d: "the ice cream truck jingle is driving me crazy", ok: ["KA-01097"] },
  { d: "someone is yelling in the street every night", ok: ["KA-01092"] },
  { d: "a yellow cab keeps honking outside my window", ok: ["KA-01102", "KA-01241"] },
  // Street
  { d: "huge pothole on my street", ok: ["KA-01093"] },
  { d: "the street light on my corner is out", ok: ["KA-02463"] },
  { d: "the sidewalk in front of the school is cracked", ok: ["KA-02235", "KA-01506"] },
  { d: "the traffic light at the intersection is stuck on red", ok: ["KA-01404"] },
  { d: "the stop sign is missing at the corner", ok: ["KA-01063"] },
  { d: "water is gushing out of a hydrant", ok: ["KA-01034"] },
  // Parks
  { d: "the swings in the playground are broken", ok: ["KA-01060"] },
  { d: "people are barbecuing in the park where it's not allowed", ok: ["KA-02228", "KA-02234"] },
  { d: "the basketball hoop at the park is broken", ok: ["KA-01060"] },
  { d: "a tree branch is hanging over the sidewalk", ok: ["KA-02138", "KA-01794"] },
  // Sanitation
  { d: "sanitation skipped our recycling pickup", ok: ["KA-01788"] },
  { d: "someone dumped a mattress on the sidewalk", ok: ["KA-02097"] },
  { d: "the litter basket on the corner is overflowing", ok: ["KA-02143"] },
  { d: "dog poop all over the sidewalk", ok: ["KA-02247", "KA-01803"] },
  { d: "trash piled up in the lobby of my building", ok: ["KA-01074"] },
  { d: "the street is dirty and nobody sweeps it", ok: ["KA-02332", "KA-02356", "KA-01803"] },
  // Vehicles
  { d: "a car has been parked in front of my driveway all day", ok: ["KA-01062"] },
  { d: "an abandoned car with no plates on my block", ok: ["KA-02130"] },
  { d: "a truck is idling outside the school", ok: ["KA-02222"] },
  { d: "a delivery truck is double parked in the bike lane", ok: ["KA-01260", "KA-01986"] },
  { d: "a taxi driver was rude to me", ok: ["KA-01241"] },
  { d: "a car is stored in my neighbor's front yard", ok: ["KA-01991"] },
  // Safety (911 first)
  { d: "I smell gas in my kitchen", danger: true },
  { d: "there's a fire in the building next door", danger: true },
  { d: "my carbon monoxide alarm is going off", danger: true },
  { d: "the CO detector keeps beeping and I feel dizzy", danger: true },
  { d: "smoke is pouring out of the apartment upstairs", danger: true },
  { d: "someone has a gun outside", danger: true },
  { d: "a car crashed into a pole and the driver is hurt", danger: true },
  // Near misses
  { d: "the carbon monoxide detector needs a new battery", ok: ["KA-01074", "KA-02608"] },
  { d: "my smoke detector keeps chirping", ok: ["KA-01074"] },
  { d: "how do I get a free smoke alarm installed", ok: ["KA-03606"] },
  { d: "my landlord didn't install heat", ok: ["KA-01036"] },
  { d: "the house across the street has a huge pile of garbage in the yard", ok: ["KA-02133", "KA-01074"] },
  { d: "bathroom in the subway station is dirty", ok: [] },
  { d: "the residential building next door has scaffolding up for years", ok: ["KA-02291"] },
  { d: "the tenants upstairs are noisy", ok: ["KA-01017"] },
  { d: "my car got towed", ok: ["KA-02055"] },
  // More near misses on generic words (install, house, residential, car)
  { d: "my landlord didn't install a lock on the front door", ok: ["KA-01074"] },
  { d: "the landlord never installed smoke detectors in the building", ok: ["KA-01074"] },
  { d: "a car is parked on the sidewalk in front of my house", ok: ["KA-01986", "KA-01980"] },
  { d: "the residential building has no heat", ok: ["KA-01036"] },
  { d: "carbon monoxide smell in the basement", danger: true },
  { d: "my kitchen is filthy because the landlord won't fix the sink", ok: ["KA-01074"] },
  { d: "the house next door has rats", ok: ["KA-01107", "KA-02278"] },
  { d: "garbage bags left on the curb for a week", ok: ["KA-01788", "KA-02356", "KA-01803", "KA-02097"] },
  { d: "loud party at the house next door", ok: ["KA-01591", "KA-01017"] },
  { d: "cars racing down my residential street at night", ok: ["KA-01102", "KA-02305", "KA-03063"] },
];

for (const c of CASES) {
  test(`stress: ${c.d}`, async () => {
    const out = await howToReport({ description: c.d }, stressClient);
    if (c.danger) {
      assert.ok(out.emergency, `no 911 lead: ${out.first_line}`);
      assert.match(out.first_line, /call 911/i);
      return;
    }
    assert.equal(out.emergency, null, `flagged as an emergency: ${out.first_line}`);
    const top = out.best_match ?? out.alternatives?.[0] ?? null;
    const strong = /^strong/.test(out.best_match?.confidence ?? "");
    if (strong || c.must) assert.ok(c.ok.includes(top?.ka_number), `${c.d}: ${top?.ka_number} ${top?.title} (${out.best_match?.confidence ?? "no best match"}); want ${c.ok.join(" or ") || "no strong answer"}`);
  });
}

test("the stress set is at least 40 phrasings across every area, with danger cases", () => {
  assert.ok(CASES.length >= 40, String(CASES.length));
  assert.ok(CASES.filter((c) => c.danger).length >= 7);
});
