// how_to_report and list_311_categories (#17). No network: the 311 content API is
// served from responses recorded 2026-11-07 (test/fixtures/content/), BoardStat from
// its fixture folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { howToReport, list311Categories, parseQuery, REACH_311, stem } from "../dist/how-to-report.js";
import { ContentClient, htmlToText, parseCategories } from "../dist/content-311.js";
import { problemTrend } from "../dist/district-tools.js";
import { fixtureContent, recorded, API } from "./content-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";
import { REVIEW } from "./review-set.mjs";

const tmp = () => mkdtemp(path.join(tmpdir(), "nyc-311-mcp-content-test-"));

// ─── the #17 review set ───────────────────────────────────────────────────────

// Where the City's article names the problem type, it must be the open-data complaint_type
// (case aside). Where it does not, the tool must say so (null), not invent one.
const ARTICLE_NAMES_NO_TYPE = {
  Plumbing: "HPD's maintenance actions name an agency but no problem",
  "PAINT/PLASTER": "same",
  "DOOR/WINDOW": "same",
  "Traffic Signal Condition": "the article has no report action: phone only",
  "Snow or Ice": "DSNY's sidewalk action is seasonal and absent now",
  "Water System": "the article's hydrant actions are 'Water Maintenance', open data says 'Water System'",
};

test("review set: each of the 20 most common problem types lands on the right City article", async () => {
  const { client } = await fixtureContent();
  for (const r of REVIEW) {
    const out = await howToReport({ description: r.description }, client);
    const m = out.best_match;
    assert.ok(m, `${r.rank} ${r.complaint_type}: no best match (${out.first_line})`);
    assert.equal(m.ka_number, r.expect_ka, `${r.rank} ${r.complaint_type}: got ${m.ka_number} ${m.title}`);
    const named = m.problem_types.some((p) => p.toLowerCase() === r.complaint_type.toLowerCase());
    if (r.complaint_type in ARTICLE_NAMES_NO_TYPE) {
      assert.equal(named, false, `${r.complaint_type}: now named; update the review table`);
    } else {
      assert.ok(named, `${r.complaint_type}: article names ${m.problem_types.join(", ")}`);
      if (m.problem_type) assert.equal(m.problem_type.toLowerCase(), r.complaint_type.toLowerCase());
    }
    assert.ok(m.portal_url.startsWith("https://portal.311.nyc.gov/article/?kanumber=KA-"));
    assert.doesNotMatch(out.first_line, /^Call 911/, `${r.complaint_type} is not an emergency`);
  }
});

test("the agency comes from the article, and a split article does not pick one blindly", async () => {
  const { client } = await fixtureContent();
  const parking = await howToReport({ description: "a car is parked in front of the fire hydrant on my street" }, client);
  assert.equal(parking.best_match.agency, "New York City Police Department");
  assert.equal(parking.best_match.problem_detail, null);
  // Abandoned Vehicle: NYPD with a plate, DSNY without. No plate words, no pick.
  const abandoned = await howToReport({ description: "a car has been abandoned on my street for weeks" }, client);
  assert.equal(abandoned.best_match.problem_type, null);
  assert.ok(abandoned.best_match.no_best_action);
  assert.deepEqual(abandoned.best_match.agencies.sort(), ["Department of Sanitation", "New York City Police Department"]);
  const noPlate = await howToReport({ description: "an abandoned car with no license plate on my street" }, client);
  assert.equal(noPlate.best_match.agency, "Department of Sanitation");
  assert.equal(noPlate.best_match.problem_type, "Abandoned Vehicle");
  // Traffic signals: no action, so the agency named in the City's text, and phone only.
  const signal = await howToReport({ description: "the traffic light at the corner is broken" }, client);
  assert.equal(signal.best_match.agency, "Department of Transportation (DOT)");
  assert.match(signal.best_match.agency_source, /article's text/);
  assert.deepEqual(signal.best_match.agencies_named_in_text.slice(0, 1), ["Department of Transportation (DOT)"]);
  assert.equal(signal.best_match.ways_to_report[0].method, "phone only");
  assert.match(signal.best_match.ways_to_report[0].how, /by phone only\. Call 311 or 212-NEW-YORK \(212-639-9675\)/);
});

test("snow on a sidewalk: the City's own 'not taking complaints right now' is passed on", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "the sidewalk wasn't shoveled and it's icy" }, client);
  assert.equal(out.best_match.ka_number, "KA-01397");
  assert.equal(out.best_match.problem_type, null);
  assert.match(out.best_match.file_a_complaint, /DSNY isn’t taking complaints right now/);
  assert.ok(out.best_match.the_city_says_it_does_not.length >= 1);
});

// ─── emergencies ──────────────────────────────────────────────────────────────

for (const [description, lead, ka] of [
  ["I smell gas in my kitchen", "Call 911 to report a gas leak or any gas-related emergency or dangerous condition.", "KA-02048"],
  ["there's a fire in the building next door", "Call 911 to report a fire.", "KA-01543"],
  ["someone got hurt in a car crash", "Call 911 to report an accident in progress.", "KA-01513"],
]) {
  test(`danger: '${description}' leads with the City's own 911 wording`, async () => {
    const { client } = await fixtureContent();
    const out = await howToReport({ description }, client);
    assert.equal(out.first_line, lead);
    assert.ok(out.emergency.suggested_by.length > 0);
    assert.equal(out.emergency.ka_number, ka);
    assert.match(out.emergency.source, new RegExp(ka));
  });
}

test("danger with no City 911 article to quote: a plain 911 line, labeled as BetaNYC wording", async () => {
  const { client } = await fixtureContent({
    fetch: async (u) => {
      if (String(u).includes("GetContentList")) return Response.json({ ContentArticleList: [] });
      return Response.json(await recorded(u));
    },
  });
  const out = await howToReport({ description: "there is smoke coming from my neighbor's apartment" }, client);
  assert.equal(out.first_line, "If anyone is in danger right now, call 911. 311 is for problems that are not emergencies.");
  assert.match(out.emergency.source, /^BetaNYC wording/);
});

test("'fire hydrant' and 'smoke detector' are not danger words", () => {
  assert.deepEqual(parseQuery("a fire hydrant is open").danger.kinds, []);
  assert.deepEqual(parseQuery("my landlord removed the smoke detector").danger.kinds, []);
  assert.notDeepEqual(parseQuery("the car is on fire").danger.kinds, []);
});

test("a large party: the City's own 911 article leads only when it is the match", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "loud music next door at 2 am" }, client);
  assert.equal(out.emergency, null);
  assert.match(out.first_line, /^Best match: "Noise from Neighbor" \(KA-01017\), handled by the New York City Police Department, 311 problem type "Noise - Residential"/);
});

// ─── no match, privacy, ZIP codes ─────────────────────────────────────────────

test("no match: says so and links 311 Online search with the recognized words only", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "xyzzy plugh at 123 Main Street, Brooklyn 11201" }, client);
  assert.equal(out.best_match, null);
  assert.deepEqual(out.alternatives, []);
  assert.equal(out.first_line, "No 311 article matched this description. If anyone is in danger right now, call 911.");
  assert.match(out.no_match.message, /^No 311 article matched/);
  assert.match(out.no_match.portal_search_url, /^https:\/\/portal\.311\.nyc\.gov\/search\/\?q=/);
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /123 Main|11201|xyzzy/i, "the description is never echoed");
});

test("ZIP codes in City article text are never returned", async () => {
  const { client } = await fixtureContent();
  // KA-01404's "Request a Timing Review" section carries a mailing address with a ZIP
  // (recorded as NY 99999).
  const raw = await recorded(`${API}/GetContent?SearchText=KA-01404`);
  assert.match(JSON.stringify(raw), /NY 99999/);
  const out = await howToReport({ description: "the traffic light at the corner is broken", limit: 5 }, client);
  assert.doesNotMatch(JSON.stringify(out), /99999/);
});

test("the tool says plainly it files nothing, and cites where the ways to reach 311 come from", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "a pothole on my block", borough: "Queens" }, client);
  assert.match(out.not_filed, /does not file a report/);
  assert.equal(out.how_to_reach_311.source, "https://portal.311.nyc.gov/about-nyc-311/");
  assert.ok(out.how_to_reach_311.ways.some((w) => /212-NEW-YORK \(212-639-9675\) from outside New York City/.test(w.how)));
  assert.equal(out.borough, "Queens");
  assert.equal(out.best_match.ways_to_report[0].method, "online");
});

// ─── BoardStat ────────────────────────────────────────────────────────────────

test("with a district: how often the matched problem type was reported there, as problem_trend counts it", async () => {
  const { client } = await fixtureContent();
  const { data } = await fixtureData();
  const out = await howToReport({ description: "people yelling and playing loud music on the sidewalk", community_district: 484, last_days: 400 }, client, data);
  assert.equal(out.in_your_district.problem, "Noise - Street/Sidewalk");
  const trend = await problemTrend(data, { community_district: 484, problem: "Noise - Street/Sidewalk", last_days: 400 });
  assert.equal(out.in_your_district.requests, trend.data.requests);
  assert.equal(out.in_your_district.boardstat_url, trend.boardstat_url);
});

test("a problem type BoardStat does not have is reported, not an error", async () => {
  const { client } = await fixtureContent();
  const { data } = await fixtureData();
  const out = await howToReport({ description: "a homeless encampment under the overpass", council_district: 1 }, client, data);
  assert.equal(out.best_match.ka_number, "KA-02253");
  assert.ok(out.in_your_district);
});

test("last_days without a district, or both districts, is refused", async () => {
  const { client } = await fixtureContent();
  await assert.rejects(howToReport({ description: "a pothole", last_days: 30 }, client), /give community_district or council_district/);
  await assert.rejects(howToReport({ description: "a pothole", community_district: 101, council_district: 1 }, client), /not both/);
});

// ─── list_311_categories ──────────────────────────────────────────────────────

test("list_311_categories: the tree, and one category's articles", async () => {
  const { client } = await fixtureContent();
  const tree = await list311Categories({}, client);
  assert.equal(tree.count, 115);
  assert.equal(tree.categories.length, 19);
  const noise = await list311Categories({ category_id: "311-12" }, client);
  assert.equal(noise.count, 42);
  // 20 articles a page since the beta test (2026-11-08); KA-01092 is on the second page.
  const noise2 = await list311Categories({ category_id: "311-12", offset: 20 }, client);
  assert.ok(noise2.articles.some((a) => a.ka_number === "KA-01092" && a.portal_url.endsWith("KA-01092")));
  const parent = await list311Categories({ category_id: "311-16" }, client);
  assert.ok(parent.category.subcategories.length > 0);
  await assert.rejects(list311Categories({ category_id: "311-99999" }, client), /no category/);
});

test("category_id searches only that category", async () => {
  const { client, seen } = await fixtureContent();
  const out = await howToReport({ description: "a pothole on my block", category_id: "311-12" }, client);
  assert.deepEqual(out.searched.categories, [{ id: "311-12", name: "Noise" }]);
  assert.ok(!seen.some((s) => s.url.includes("categoryId=311-81")));
});

// ─── the content client ───────────────────────────────────────────────────────

test("parseCategories keeps each category once (the API lists sub-categories twice)", async () => {
  const raw = await recorded(`${API}/GetCategory?max-level=3`);
  const flat = raw.Categories.length + raw.Categories.reduce((n, c) => n + (c.SubCategory?.length ?? 0), 0);
  assert.ok(flat > 115);
  const cats = parseCategories(raw);
  assert.equal(cats.length, 115);
  assert.equal(new Set(cats.map((c) => c.id)).size, 115);
  assert.equal(cats.find((c) => c.id === "311-81").parent_id, "311-16");
});

test("requests: the documented paths and parameters, the key header, a User-Agent", async () => {
  const { client, seen } = await fixtureContent();
  await client.categories();
  await client.articleList("311-12");
  await client.article("ka-01092");
  assert.deepEqual(
    seen.map((s) => s.url),
    [`${API}/GetCategory?max-level=3`, `${API}/GetContentList?categoryId=311-12`, `${API}/GetContent?SearchText=KA-01092`]
  );
  for (const s of seen) {
    assert.equal(s.headers["Ocp-Apim-Subscription-Key"], "test-key-never-sent-anywhere");
    assert.match(s.headers["User-Agent"], /^@betanyc\/nyc-311-mcp\//);
  }
  assert.throws(() => client.article("01092"), /not a 311 article number/);
  assert.throws(() => client.articleList("12"), /not a 311 category id/);
});

test("cache: a second ask makes no request; past 7 days it asks again", async () => {
  let now = Date.parse("2026-11-07T12:00:00Z");
  const { client } = await fixtureContent({ now: () => now });
  await client.articleList("311-12");
  await client.articleList("311-12");
  assert.equal(client.requests, 1);
  now += 6 * 86400_000;
  await client.articleList("311-12");
  assert.equal(client.requests, 1);
  now += 2 * 86400_000;
  await client.articleList("311-12");
  assert.equal(client.requests, 2);
});

test("cache: when the API is down, an older copy answers, marked stale; how_to_report says so", async () => {
  let now = Date.parse("2026-11-07T12:00:00Z");
  let down = false;
  const cacheDir = await tmp();
  const { client } = await fixtureContent({ now: () => now, cacheDir });
  await howToReport({ description: "a pothole on my block" }, client);
  now += 30 * 86400_000;
  down = true;
  const { client: later } = await fixtureContent({
    now: () => now,
    cacheDir,
    fetch: async () => {
      if (down) throw new Error("connect ECONNREFUSED");
    },
  });
  const out = await howToReport({ description: "a pothole on my block" }, later);
  assert.equal(out.best_match.ka_number, "KA-01093");
  assert.equal(out.stale, true);
  assert.match(out.warning, /could not be reached .*ECONNREFUSED.*saved 2026-11-07/);
  // With nothing saved, the error reaches the caller.
  const { client: empty } = await fixtureContent({ fetch: async () => { throw new Error("connect ECONNREFUSED"); } });
  await assert.rejects(howToReport({ description: "a pothole" }, empty), /ECONNREFUSED/);
});

test("pacing: at least minIntervalMs between request starts, one at a time", async () => {
  let now = 0;
  const sleeps = [];
  const { client } = await fixtureContent({
    minIntervalMs: 1000,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  await Promise.all([client.categories(), client.articleList("311-12"), client.articleList("311-81")]);
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.equal(client.requests, 3);
});

test("429: one retry after Retry-After; a second 429 is an error; 404 article is not retried", async () => {
  const sleeps = [];
  let calls = 0;
  const c = new ContentClient({
    apiKey: () => "k",
    cacheDir: await tmp(),
    minIntervalMs: 0,
    logger: () => {},
    sleep: async (ms) => sleeps.push(ms),
    fetch: async (u) => {
      calls++;
      if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
      return Response.json(await recorded(u));
    },
  });
  await c.articleList("311-12");
  assert.equal(calls, 2);
  assert.deepEqual(sleeps.filter((s) => s > 0), [2000]);
  const always = new ContentClient({ apiKey: () => "k", cacheDir: await tmp(), minIntervalMs: 0, logger: () => {}, sleep: async () => {}, fetch: async () => new Response("no", { status: 429 }) });
  await assert.rejects(always.categories(), /limiting requests from this API key right now \(HTTP 429/);
  const { client } = await fixtureContent();
  await assert.rejects(client.article("KA-99999"), /has no article KA-99999/);
});

test("the API key is read on the first request, with a clear message when missing", async () => {
  const saved = process.env.NYC_311_API_KEY;
  delete process.env.NYC_311_API_KEY;
  try {
    const c = new ContentClient({ cacheDir: await tmp(), fetch: async () => assert.fail("no request without a key") });
    await assert.rejects(c.categories(), /NYC_311_API_KEY environment variable is not set/);
  } finally {
    if (saved !== undefined) process.env.NYC_311_API_KEY = saved;
  }
});

test("a timeout aborts the request", async () => {
  const c = new ContentClient({
    apiKey: () => "k",
    cacheDir: await tmp(),
    minIntervalMs: 0,
    timeoutMs: 30,
    logger: () => {},
    fetch: (u, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
  });
  await assert.rejects(c.categories(), /no answer within 30 ms/);
});

test("htmlToText and stem", () => {
  assert.equal(htmlToText("<style>.x{}</style><p>Call <strong>911</strong>&nbsp;now&rsquo;s</p><ul><li>One</li></ul>"), "Call 911 now’s\n\n• One");
  assert.equal(stem("roaches"), "roach");
  assert.equal(stem("mice"), "mouse");
  assert.equal(stem("leaking"), stem("leak"));
  assert.equal(stem("parties"), "party");
  assert.equal(stem("blocked"), stem("blocking"));
});

// ─── QA round 1 on #23 ────────────────────────────────────────────────────────

test("a 911 line never quotes a City article for a different danger", async () => {
  const { client } = await fixtureContent();
  for (const d of ["downed wire sparking in the road", "a man is breaking into a car right now", "a child left alone in a hot car"]) {
    const out = await howToReport({ description: d }, client);
    assert.equal(out.emergency.ka_number, null, `${d}: quoted ${out.emergency.source}`);
    assert.doesNotMatch(out.first_line, /animal|assault|missing|kidnap/i);
  }
  const shot = await howToReport({ description: "I heard shots fired outside" }, client);
  assert.equal(shot.emergency.ka_number, "KA-01557");
  const crash = await howToReport({ description: "someone got hurt in a car crash" }, client);
  assert.equal(crash.emergency.ka_number, "KA-01513");
});

test("suicide: the City's 911 line and its 988 sentence, cited", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "my friend says he wants to kill himself" }, client);
  assert.equal(out.first_line, "Call 911 to report that someone is considering suicide or endangering themselves.");
  assert.equal(out.emergency.also_988.ka_number, "KA-01635");
  assert.match(out.emergency.also_988.text, /call, text, or chat 988/);
});

test("negation, smoking and odors do not lead with 911; 'not an emergency' is honored", async () => {
  const { client } = await fixtureContent();
  for (const d of ["my car was hit but no one was hurt", "nobody got hurt in the crash", "my neighbors smoke cigarettes in the hallway", "the burning smell from the restaurant exhaust", "the noise hurts my sleep", "not an emergency but there is smoke coming from a vent"]) {
    const out = await howToReport({ description: d }, client);
    assert.equal(out.emergency, null, `${d}: ${out.first_line}`);
    assert.equal(out.safety_line, "If anyone is in danger right now, call 911.");
  }
});

test("no match with an urgent word leads with 911", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "I need help right now" }, client);
  assert.equal(out.best_match, null);
  assert.match(out.first_line, /^If anyone is in danger right now, call 911/);
  assert.match(out.emergency.source, /^BetaNYC wording: an urgent word/);
});

test("crime: a pointer to the City's own articles, never an invented number", async () => {
  const { client } = await fixtureContent();
  for (const d of ["I want to report a crime", "I was robbed last week"]) {
    const out = await howToReport({ description: d }, client);
    assert.equal(out.emergency, null, d);
    assert.deepEqual(out.crime.past_crime.map((x) => x.ka_number), ["KA-02668", "KA-01027"]);
    assert.doesNotMatch(JSON.stringify(out.crime), /\d{3}-\d{3}-\d{4}/);
  }
  const now = await howToReport({ description: "someone is getting robbed outside" }, client);
  assert.ok(now.emergency && now.crime);
});

test("Spanish: matched by keyword, with 311's own language-help text, quoted", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "ruido muy fuerte de los vecinos" }, client);
  assert.equal(out.best_match.ka_number, "KA-01017");
  assert.match(out.language_help.says, /over 175 languages and dialects when you ask to speak to an interpreter/);
  assert.equal(out.language_help.source, "quote of https://portal.311.nyc.gov/about-nyc-311/");
  const en = await howToReport({ description: "a pothole on my block" }, client);
  assert.equal(en.language_help, undefined);
});

test("typos one edit away from a known word are corrected, and said so", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "pothoel on my stret" }, client);
  assert.equal(out.best_match.ka_number, "KA-01093");
  assert.deepEqual(out.spelling_corrected, ["pothoel → pothole", "stret → street"]);
  const dog = await howToReport({ description: "dog barking all night next door" }, client);
  assert.equal(dog.spelling_corrected, undefined, "barking is not parking");
});

test("several problems: one match each", async () => {
  const { client } = await fixtureContent();
  const out = await howToReport({ description: "my building has no hot water and the elevator is broken" }, client);
  assert.equal(out.best_match.ka_number, "KA-01036");
  assert.equal(out.other_problems.length, 1);
  assert.equal(out.other_problems[0].best_match.ka_number, "KA-02015");
  const one = await howToReport({ description: "people yelling and playing loud music on the sidewalk" }, client);
  assert.equal(one.other_problems, undefined);
});

test("every answer says how old the article text is", async () => {
  const { client } = await fixtureContent({ now: () => Date.parse("2026-11-07T12:00:00Z") });
  const out = await howToReport({ description: "the sidewalk wasn't shoveled and it's icy" }, client);
  assert.match(out.first_line, /Article text as of 2026-11-07\./);
  assert.equal(out.source.best_match_article_as_of, "2026-11-07T12:00:00.000Z");
  assert.ok(out.caveats.some((c) => /as of 2026-11-07T12:00:00.000Z/.test(c)));
});

test("an article that says 'right now' is refreshed daily; others weekly", async () => {
  let now = Date.parse("2026-11-07T12:00:00Z");
  const { client } = await fixtureContent({ now: () => now });
  await client.article("KA-01397"); // "DSNY isn't taking complaints right now"
  await client.article("KA-01092");
  assert.equal(client.requests, 2);
  now += 25 * 3600_000;
  await client.article("KA-01397");
  await client.article("KA-01092");
  assert.equal(client.requests, 3, "only the time-sensitive article was asked again");
});

test("missing key with a saved copy: the warning says the key is not set", async () => {
  let now = Date.parse("2026-11-07T12:00:00Z");
  const cacheDir = await tmp();
  const { client } = await fixtureContent({ now: () => now, cacheDir });
  await howToReport({ description: "a pothole on my block" }, client);
  now += 8 * 86400_000;
  const saved = process.env.NYC_311_API_KEY;
  delete process.env.NYC_311_API_KEY;
  try {
    const later = new ContentClient({ cacheDir, now: () => now, logger: () => {}, minIntervalMs: 0, fetch: async () => assert.fail("no request without a key") });
    const out = await howToReport({ description: "a pothole on my block" }, later);
    assert.equal(out.stale, true);
    assert.match(out.warning, /^NYC_311_API_KEY is not set, so the 311 API was not asked/);
    assert.doesNotMatch(out.warning, /could not be reached/);
  } finally {
    if (saved !== undefined) process.env.NYC_311_API_KEY = saved;
  }
});

test("the ways to reach 311 are quoted, and the phone line is labeled a paraphrase", () => {
  const phone = REACH_311.ways.find((w) => w.method === "phone");
  assert.match(phone.source, /^paraphrase of https:\/\/portal\.311\.nyc\.gov\/about-nyc-311\//);
  const text = REACH_311.ways.find((w) => w.method === "text");
  assert.equal(text.how, "Send a text to 311-692 24 hours a day, 7 days a week, 365 days a year. Message and data rates may apply.");
  assert.match(text.source, /^quote of/);
});
