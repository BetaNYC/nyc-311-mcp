// Beta test round 1 (2026-11-08): draft_311_report on the phrasings that went wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftReport, namesSomeone, NAMES_SOMEONE } from "../dist/draft-report.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { fixtureContent } from "./content-fixture.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

async function draft(args) {
  const { client } = await fixtureContent();
  const { soda } = await fixtureSla();
  const { data } = await fixtureData();
  return draftReport(args, client, soda, data);
}

test("place names are not people: Gun Hill, Crown Heights, Bay Ridge, Morris Park and the rest", () => {
  for (const t of [
    "big pothole on Gun Hill Road", "pothole on Gun Hill Rd", "Gun Hill and Bainbridge", "a streetlight out in Crown Heights", "trash all over Bay Ridge",
    "rats in Morris Park", "noise near Union Square", "graffiti at Washington Heights library", "loud music on Flatbush Avenue", "pothole near Kings Highway",
    "the bench in Pelham Bay is broken", "water on Grand Street", "a hydrant open on Ocean Parkway", "noise from Coney Island",
  ]) assert.equal(namesSomeone(t), false, t);
});

test("a real person's name still warns", () => {
  for (const t of ["Maria Lopez upstairs plays music", "my landlord Mr Jones won't fix it", "John Smith keeps parking in the driveway", "my neighbor Sam blasts music", "Maria Lopez on the third floor is loud"]) {
    assert.equal(namesSomeone(t), true, t);
  }
});

test("the Gun Hill pothole draft does not say it names someone; a named neighbor's does", async () => {
  const pothole = await draft({ description: "big pothole on Gun Hill Road", location: "Gun Hill Rd and Bainbridge Ave", borough: "Bronx" });
  assert.equal(pothole.drafted, true);
  assert.equal(pothole.reports[0].names_someone, undefined);
  const named = await draft({ description: "John Smith blocks my driveway every morning", location: "Gun Hill Rd and Bainbridge Ave", borough: "Bronx" });
  assert.equal(named.reports[0].names_someone, NAMES_SOMEONE);
});

test("a neighbor's grill: no draft, the closest City articles, and why it is not exact", async () => {
  const out = await draft({ description: "not an emergency, just some smoke from a neighbor's grill", location: "Broadway and W 96 St", borough: "Manhattan" });
  assert.equal(out.safety_line, SAFETY_LINE);
  assert.equal(out.drafted, false);
  assert.equal(out.emergency, null);
  const r = out.reports[0];
  assert.equal(r.status, "no_exact_match");
  assert.equal(r.paste_text, null);
  assert.equal(r.closest_options[0].ka_number, "KA-02228");
  assert.ok(r.closest_options.length > 1);
  assert.match(out.first_line, /No exact match/);
});

test("graffiti on a mailbox is drafted on the Graffiti article, with the City's mailbox section quoted", async () => {
  const out = await draft({ description: "graffiti on a mailbox", location: "Broadway and W 96 St", borough: "Manhattan" });
  const r = out.reports[0];
  assert.equal(r.report_at.ka_number, "KA-02070");
  assert.equal(r.article_section.name, "USPS Mailbox");
  assert.match(r.article_section.says, /United States Postal Service/);
});

test("rats in the park are drafted for Parks, not HPD", async () => {
  const out = await draft({ description: "rats in the park", location: "Van Cortlandt Park", borough: "Bronx" });
  assert.equal(out.reports[0].report_at.agency, "Department of Parks and Recreation");
});

test("a trash can and a broken bench: each problem is listed", async () => {
  const out = await draft({ description: "Overflowing trash can and a broken bench in the park", location: "Broadway and W 96 St", borough: "Manhattan" });
  assert.equal(out.reports.length, 2);
  assert.ok(out.reports.some((r) => r.report_at?.ka_number === "KA-01060"));
  assert.match(out.first_line, /2 problems/);
});
