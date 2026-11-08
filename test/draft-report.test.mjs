// draft_311_report (#18). No network: 311 content from the responses recorded for #17
// (test/fixtures/content/), cs9t-e3x8 from rows read live 2026-11-07
// (test/fixtures/soda/cs9t-e3x8/), BoardStat from its fixture folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { draftReport, slaTable, detailOptions, cleanText, SLA_TTL_MS, CHECK_STATUS_URL, FIELDS_NOTE, NOT_SENT } from "../dist/draft-report.js";
import { howToReport } from "../dist/how-to-report.js";
import { ASSISTANT_INSTRUCTION, CITY_DV, SAFETY_LINE, assessDanger } from "../dist/emergency.js";
import { ContentClient } from "../dist/content-311.js";
import { callTool, TOOLS } from "../dist/tools.js";
import { fixtureContent } from "./content-fixture.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";
import { COMMON, TRICKY, EMERGENCY, MISSED } from "./draft-review-set.mjs";

async function setup(slaOpts) {
  const content = await fixtureContent();
  const sla = await fixtureSla(slaOpts);
  const { data } = await fixtureData();
  return { ...content, ...sla, data, draft: (args) => draftReport(args, content.client, sla.soda, data) };
}

const ZIPLIKE = /(?<![\d-])\d{5}(?![\d-])/;

// ─── the review set ───────────────────────────────────────────────────────────

test("review: the 20 common problem types each get one draft on the article how_to_report picks", async () => {
  const { draft, client } = await setup();
  for (const c of COMMON) {
    const out = await draft(c.args);
    assert.equal(out.drafted, true, c.id);
    assert.equal(out.emergency, null, c.id);
    assert.equal(out.reports.length, 1, `${c.id} ${c.note}: split into ${out.reports.length}`);
    const r = out.reports[0];
    assert.equal(r.report_at.ka_number, c.expect_ka, c.id);
    // The same article how_to_report gives: the matching is its, not a copy.
    const h = await howToReport({ description: c.args.description }, client);
    assert.equal(r.report_at.ka_number, h.best_match.ka_number);
    assert.equal(r.report_at.portal_url, `https://portal.311.nyc.gov/article/?kanumber=${c.expect_ka}`);
    assert.ok(r.paste_text.includes(`What I saw: ${c.args.description}`), c.id);
    // Nothing given but the description, so where, borough and when are asked, not made up.
    assert.deepEqual(r.placeholders, ["[add: where]", "[add: borough]", "[add: when]"], c.id);
    assert.match(r.paste_text, /Where: \[add: where[^\]]*\], \[add: borough\]/);
    assert.match(r.paste_text, /When: \[add: when/);
    assert.ok(r.questions_to_ask.some((q) => /^Where exactly/.test(q)));
    assert.match(r.what_happens_next.after_you_report, /get_service_request/);
    assert.ok(out.caveats.includes(FIELDS_NOTE));
  }
});

test("review: the 10 harder cases", async () => {
  const { draft } = await setup();
  const by = Object.fromEntries(await Promise.all(TRICKY.map(async (t) => [t.id, { t, out: await draft(t.args) }])));
  for (const { t, out } of Object.values(by)) {
    if (t.emergency) {
      assert.equal(out.drafted, false, t.id);
      assert.deepEqual(out.reports, [], t.id);
      assert.match(out.first_line, /911/, t.id);
      continue;
    }
    if (t.expect_kas) assert.deepEqual(out.reports.map((r) => r.report_at.ka_number), t.expect_kas, t.id);
    else if (t.expect_ka) assert.equal(out.reports[0].report_at.ka_number, t.expect_ka, t.id);
    if (t.expect_placeholders) assert.deepEqual(out.reports[0].placeholders, t.expect_placeholders, t.id);
  }
  // T1: borough and time given, so only where is asked.
  assert.match(by.T1.out.reports[0].paste_text, /Where: \[add: where[^\]]*\], Queens\nWhen: this morning\. It is still happening\./);
  // T3: no article, still a draft, and the assistant is told how to find one.
  assert.equal(by.T3.out.reports[0].status, "drafted_without_article");
  assert.equal(by.T3.out.reports[0].report_at, null);
  assert.match(by.T3.out.reports[0].paste_text, /^Problem: \[add: which problem/);
  // T7: the City's own summary says it does not take this: no draft, City words.
  const odor = by.T7.out.reports[0];
  assert.equal(odor.status, "not_a_311_report");
  assert.equal(odor.paste_text, null);
  assert.deepEqual(odor.where_to_go.the_city_says, ["The City does not accept complaints about body or cooking odor from a residence."]);
  // T8, T9: one draft per problem, each with the shared place.
  for (const r of by.T8.out.reports) assert.match(r.paste_text, /Where: 200 Bedford Ave, Brooklyn/);
  assert.match(by.T8.out.first_line, /^This sounds like 2 problems/);
  // The parts are how_to_report's splitProblems parts: lower case, with the joining "and"
  // dropped ("trash litter"). A known weak spot, listed in docs/draft-a-report.md.
  assert.deepEqual(by.T9.out.reports.map((r) => r.this_problem), ["trash litter all over the sidewalk", "someone is blocking my driveway"]);
});

// ─── emergencies ──────────────────────────────────────────────────────────────

test("an emergency is not drafted, and the 911 answer is how_to_report's own", async () => {
  const { draft, client } = await setup();
  for (const description of ["I smell gas in my kitchen", "there's a fire in the building next door", "someone got hurt in a car crash and there is a pothole"]) {
    const out = await draft({ description, location: "45 Elm St", borough: "Bronx" });
    const h = await howToReport({ description }, client);
    assert.equal(out.first_line, h.first_line);
    assert.deepEqual(out.emergency, h.emergency);
    assert.equal(out.drafted, false);
    assert.deepEqual(out.reports, []);
    assert.doesNotMatch(JSON.stringify(out), /45 Elm/, "nothing of the report is drafted");
  }
});

test("a danger word in one part of a two-part description stops the whole draft", async () => {
  const { draft } = await setup();
  const out = await draft({ description: "a pothole on my block; also I smell gas" });
  assert.equal(out.drafted, false);
  assert.match(out.first_line, /^Call 911/);
});

// ─── never invent ─────────────────────────────────────────────────────────────

test("given everything, the draft has no placeholders and holds only the person's words and the article's names", async () => {
  const { draft } = await setup();
  const out = await draft({ description: "a pothole on my block", location: "Broadway and W 96 St", borough: "Manhattan", when: "Nov 6, about 8 am", ongoing: "still happening", details: "about two feet wide, in the bike lane" });
  const r = out.reports[0];
  assert.deepEqual(r.placeholders, []);
  assert.equal(
    r.paste_text,
    [
      "Problem: Pothole or Cave-In on Street (311 problem type: Street Condition)",
      "Where: Broadway and W 96 St, Manhattan",
      "When: Nov 6, about 8 am. It is still happening.",
      "What I saw: a pothole on my block",
      "Details: about two feet wide, in the bike lane",
    ].join("\n")
  );
});

test("a Problem Detail from the article's report option goes into the draft only when the person's words say so", async () => {
  const { draft } = await setup();
  // KA-01093's one report option is the cave-in; the person said pothole.
  const pothole = (await draft({ description: "a pothole on my block" })).reports[0];
  assert.doesNotMatch(pothole.paste_text, /Cave-in/);
  assert.equal(pothole.what.problem_detail, null);
  // "my block" is a place, not "Blocked - Construction".
  assert.ok(!pothole.questions_to_ask.some((q) => /Is it "Blocked/.test(q)));
  const heat = (await draft({ description: "no heat in my apartment" })).reports[0];
  assert.match(heat.paste_text, /Heat\/Hot Water, Apartment Only\)/);
  // A guess from the words is a question, never the draft.
  const music = (await draft({ description: "people yelling and playing loud music on the sidewalk" })).reports[0];
  assert.doesNotMatch(music.paste_text, /Loud Music\/Party/);
  assert.ok(music.questions_to_ask.some((q) => /Loud Music\/Party|Loud Talking/.test(q)));
});

test("what the City's article says you need becomes questions, quoted", async () => {
  const { draft } = await setup();
  const r = (await draft({ description: "trash and litter all over the sidewalk" })).reports[0];
  assert.deepEqual(r.the_city_says_you_need, ["You must provide:", "Timeframe and the days of the week when littering occurs", "Type of material being littered"]);
  assert.ok(r.questions_to_ask.includes("The City's article asks for: Type of material being littered"));
  assert.ok(!r.questions_to_ask.some((q) => /You must provide:$/.test(q)));
});

// ─── contact, photos, privacy ────────────────────────────────────────────────

test("contact: the City's words when the article has them; never a claim about reporting anonymously it does not make", async () => {
  const { draft } = await setup();
  const heat = (await draft({ description: "no heat in my apartment" })).reports[0];
  assert.deepEqual(heat.contact.the_city_says, ["If you are making a heat or hot water complaint for your apartment, you must provide your contact information."]);
  assert.equal(heat.contact.anonymous, null);
  assert.ok(heat.questions_to_ask.some((q) => /needs your contact information/.test(q)));
  const pothole = (await draft({ description: "a pothole on my block" })).reports[0];
  assert.deepEqual(pothole.contact.the_city_says, []);
  assert.match(pothole.contact.note, /may ask for contact information/);
  assert.doesNotMatch(JSON.stringify(pothole.contact), /anonymously/i);
});

test("an email or phone number in the person's words is left out unless they ask for it in the draft", async () => {
  const { draft } = await setup();
  const out = await draft({ description: "no heat in my apartment, call me at 917-555-0123 or jane@example.com", location: "10 W 100 St", borough: "Manhattan" });
  const r = out.reports[0];
  assert.doesNotMatch(JSON.stringify(out), /917-555-0123|jane@example\.com/);
  assert.match(r.contact.removed, /left out/);
  assert.equal(r.contact.in_draft, false);
  const asked = await draft({ description: "no heat in my apartment", include_contact: { name: "Jane Doe", email: "jane@example.com" } });
  assert.match(asked.reports[0].paste_text, /\nContact: Jane Doe, jane@example\.com$/);
  assert.equal(asked.reports[0].contact.in_draft, true);
});

test("photos: the City's words when the article speaks of attachments, else only 'have them ready'", async () => {
  const { draft } = await setup();
  const construction = (await draft({ description: "construction jackhammer noise early in the morning" })).reports[0];
  assert.ok(construction.photos.the_city_says.some((s) => /Picture or video attachments may be used for informational purposes only/.test(s)));
  const pothole = (await draft({ description: "a pothole on my block" })).reports[0];
  assert.match(pothole.photos.note, /^Have photos ready if you have them\./);
  assert.equal(pothole.photos.the_city_says, undefined);
});

test("no ZIP code anywhere: one the person typed is left out, and City text is redacted", async () => {
  const { draft } = await setup();
  const out = await draft({ description: "mice in my apartment", location: "123 Main St, Brooklyn 11201", borough: "Brooklyn", details: "zip 11201" });
  const text = JSON.stringify(out);
  assert.doesNotMatch(text, /11201/);
  assert.match(out.reports[0].paste_text, /Where: 123 Main St, Brooklyn, Brooklyn/);
  assert.ok(out.reports[0].where.postal_code_left_out);
  // KA-01404 carries a mailing address (recorded as NY 99999).
  const signal = await draft({ description: "the traffic light at the corner is broken" });
  assert.doesNotMatch(JSON.stringify(signal), ZIPLIKE);
});

test("nothing is filed or sent: only the 311 content API and NYC Open Data are asked, and the answer says so", async () => {
  const { draft, seen, requests } = await setup();
  const out = await draft({ description: "a pothole on my block", location: "Broadway and W 96 St", borough: "Manhattan" });
  assert.equal(out.not_sent, NOT_SENT);
  assert.match(out.not_sent, /files nothing/);
  for (const s of seen) assert.match(s.url, /^https:\/\/api\.nyc\.gov\/public\/api\/Get(Category|ContentList|Content)\?/);
  for (const u of requests) assert.equal(u.host, "data.cityofnewyork.us");
  assert.equal(out.reports[0].what_happens_next.after_you_report.includes(CHECK_STATUS_URL), true);
  assert.equal(CHECK_STATUS_URL, "https://portal.311.nyc.gov/check-status/");
});

test("a phone-only article: the draft is notes for the call", async () => {
  const { draft } = await setup();
  const r = (await draft({ description: "the traffic light at the corner is broken" })).reports[0];
  assert.match(r.report_at.how, /by phone only.*Use the draft as notes for the call\./);
});

test("the City's 'not taking complaints right now' is passed on", async () => {
  const { draft } = await setup();
  const r = (await draft({ description: "the sidewalk wasn't shoveled and it's icy" })).reports[0];
  assert.match(r.the_city_says_right_now, /isn’t taking complaints right now/);
});

// ─── cs9t-e3x8 ────────────────────────────────────────────────────────────────

test("Problem Detail options come from cs9t-e3x8, labeled with its 2024-03-05 date", async () => {
  const { draft } = await setup();
  const out = await draft({ description: "loud music next door at 2 am" });
  const o = out.reports[0].what.problem_detail_options;
  assert.equal(o.as_of, "2024-03-05");
  assert.match(o.label, /last updated 2024-03-05\. Old/);
  assert.deepEqual(o.options, ["Banging/Pounding (8 hours)", "Loud Music/Party (8 hours)", "Loud Talking (8 hours)", "Loud Television (8 hours)"]);
  assert.equal(out.sources.problem_details.last_updated, "2024-03-05");
});

test("detailOptions: case-insensitive problem, one agency when the article named it, duplicate rows merged", async () => {
  const { soda } = await fixtureSla();
  const t = await slaTable(soda);
  // The dataset has "HEAT/HOT WATER" and "Heat/Hot Water", three identical rows each.
  const heat = detailOptions(t.rows, "heat/hot water", "Department of Housing Preservation and Development");
  assert.deepEqual(heat, [{ problem_detail: "Apartment Only", additional_details: ["No Heat", "No Heat and No Hot Water", "No Hot Water"], response_time: ["3 days"] }]);
  const enc = detailOptions(t.rows, "Encampment", "New York City Police Department");
  assert.deepEqual(enc, []); // its rows have Problem Detail "N/A"
});

test("cs9t-e3x8 is read politely: two requests, then the cache for 30 days, then a metadata check", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-sla-cache-"));
  const { soda, requests, advance } = await fixtureSla({ cacheDir: dir });
  const a = await slaTable(soda);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].pathname, "/api/views/cs9t-e3x8.json");
  const q = requests[1];
  assert.equal(q.pathname, "/resource/cs9t-e3x8.json");
  assert.equal(q.searchParams.get("$select"), "agency,problem,problem_details,additional_details,sla_days");
  assert.ok(q.searchParams.get("$order"));
  assert.equal(q.searchParams.get("$limit"), "5000");
  assert.doesNotMatch(q.search, /zip/i);
  assert.equal(a.rows.length, 255);
  assert.equal(a.rows_updated, "2024-03-05");
  advance(SLA_TTL_MS - 1000);
  await slaTable(soda);
  assert.equal(requests.length, 2, "cached");
  advance(2000);
  await slaTable(soda);
  assert.equal(requests.length, 3, "after 30 days: metadata only, the dataset has not changed");
  assert.equal(requests[2].pathname, "/api/views/cs9t-e3x8.json");
});

test("cs9t-e3x8 down: a saved copy answers marked stale; with none, the draft is made without options", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-sla-down-"));
  const first = await fixtureSla({ cacheDir: dir });
  await slaTable(first.soda);
  const down = async () => new Response("unavailable", { status: 404 });
  const later = await fixtureSla({ cacheDir: dir, fetch: down, now: Date.parse("2026-12-20T12:00:00Z") });
  const t = await slaTable(later.soda);
  assert.equal(t.stale, true);
  assert.match(t.warning, /could not be reached/);
  const none = await setup({ fetch: down });
  const out = await none.draft({ description: "loud music next door at 2 am" });
  assert.equal(out.drafted, true);
  assert.equal(out.reports[0].what.problem_detail_options, null);
  assert.match(out.sources.problem_details.note, /no Problem Detail options/);
});

// ─── small parts ──────────────────────────────────────────────────────────────

test("cleanText", () => {
  assert.deepEqual(cleanText("123 Main St, Brooklyn, NY 11201"), { text: "123 Main St, Brooklyn, NY", contact_removed: false, zip_removed: true });
  assert.equal(cleanText("call (212) 555-0100").text, "call [contact details left out]");
});

// ─── safety first (QA round 2 on #23, carried here) ───────────────────────────

test("every answer starts with the safety line, then the instruction to the assistant", async () => {
  const { draft } = await setup();
  for (const args of [{ description: "a pothole on my block" }, { description: "something is broken outside" }, { description: "I smell gas" }, { description: "my neighbor's cooking odor comes into my apartment" }]) {
    const out = await draft(args);
    assert.deepEqual(Object.keys(out).slice(0, 3), ["safety_line", "safety_line_source", "assistant_instruction"], args.description);
    assert.equal(out.safety_line, SAFETY_LINE);
    assert.equal(out.assistant_instruction, ASSISTANT_INSTRUCTION);
  }
  const tool = TOOLS.find((t) => t.name === "draft_311_report");
  assert.ok(tool.description.includes(ASSISTANT_INSTRUCTION));
  assert.ok(tool.description.includes(SAFETY_LINE));
});

test("every error starts with the safety line: direct calls and through the tool handler", async () => {
  const saved = process.env.NYC_311_API_KEY;
  delete process.env.NYC_311_API_KEY;
  try {
    const c = new ContentClient({ cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-nokey-")), logger: () => {}, fetch: async () => assert.fail("no request") });
    const { soda } = await fixtureSla();
    const { data } = await fixtureData();
    await assert.rejects(draftReport({ description: "a pothole" }, c, soda, data), (e) => e.message.startsWith(`${SAFETY_LINE} NYC_311_API_KEY`));
  } finally {
    if (saved !== undefined) process.env.NYC_311_API_KEY = saved;
  }
  for (const args of [{ description: "a pothole", neighborhood: "x" }, { description: "x" }, {}]) {
    const r = await callTool("draft_311_report", args);
    assert.equal(r.isError, true);
    assert.ok(r.content[0].text.startsWith(`${SAFETY_LINE} Error: `), r.content[0].text);
  }
  const h = await callTool("how_to_report", { description: "a pothole", nope: 1 });
  assert.ok(h.content[0].text.startsWith(`${SAFETY_LINE} Error: `), h.content[0].text);
  assert.doesNotMatch(h.content[0].text, new RegExp(`Error: ${SAFETY_LINE.replace(/[.]/g, "\\.")}`), "said once, not twice");
});

for (const e of EMERGENCY) {
  test(`review ${e.id}: no draft when assessDanger flags danger: ${e.args.description}`, async () => {
    const { draft, client } = await setup();
    assert.ok(assessDanger(e.args.description).kinds.length, "assessDanger flags it");
    const out = await draft(e.args);
    assert.equal(out.drafted, false);
    assert.deepEqual(out.reports, []);
    assert.equal(out.safety_line, SAFETY_LINE);
    assert.match(out.first_line, /911/);
    const h = await howToReport({ description: e.args.description }, client);
    assert.equal(out.first_line, h.first_line, "how_to_report's own 911 answer");
    assert.doesNotMatch(JSON.stringify(out), /45 Elm/);
  });
}

test("the 911 answer keeps how_to_report's 988 and domestic-violence text", async () => {
  const { draft } = await setup();
  const at = await draft({ description: "my roommate says she wants to end it all" });
  assert.equal(at.emergency.also_988.ka_number, "KA-01635");
  const dv = await draft({ description: "my husband is beating me" });
  assert.deepEqual(dv.emergency.domestic_violence, CITY_DV);
});

test("danger in one split part only stops the draft", async () => {
  const { draft } = await setup();
  for (const description of ["a pothole on my block and my dad isn't breathing", "loud music from the bar downstairs and smoke coming out of the outlet"]) {
    const out = await draft({ description });
    assert.equal(out.drafted, false, description);
    assert.match(out.first_line, /911/);
  }
});

test(`review ${MISSED.id}: danger assessDanger misses still gets the safety line and the instruction to the assistant`, async () => {
  const { draft } = await setup();
  assert.deepEqual(assessDanger(MISSED.args.description).kinds, [], "the keyword miss this row documents");
  const out = await draft(MISSED.args);
  assert.equal(out.safety_line, SAFETY_LINE);
  assert.equal(out.assistant_instruction, ASSISTANT_INSTRUCTION);
  assert.ok(out.first_line.startsWith("If anyone is in danger right now, call 911."), out.first_line);
});
