// Beta test round 1 (2026-11-08): list_311_categories with no arguments was 33,050
// characters, bigger than the whole tool list, and one category's articles 11,509. A
// normal call is now a few thousand characters, with a way to get more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { list311Categories } from "../dist/how-to-report.js";
import { callTool } from "../dist/tools.js";
import { fixtureContent } from "./content-fixture.mjs";

const size = (x) => JSON.stringify(x, null, 2).length; // as the tool sends it

test("no arguments: a summary of the top categories under 8,000 characters, every subcategory still named", async () => {
  const { client } = await fixtureContent();
  const out = await list311Categories({}, client);
  assert.ok(size(out) < 8000, `${size(out)} characters`);
  assert.equal(out.categories.length, 19);
  assert.ok(out.categories.some((c) => c.id === "311-12" && c.name === "Noise"));
  const named = out.categories.flatMap((c) => c.subcategories ?? []).join("; ");
  assert.match(named, /311-80 Sidewalks/, "a third-level category is named too");
  assert.match(out.more, /category_id/);
});

test("a parent category gives its subcategories with descriptions", async () => {
  const { client } = await fixtureContent();
  const out = await list311Categories({ category_id: "311-16" }, client);
  assert.ok(out.category.subcategories.every((s) => typeof s.description === "string"));
});

test("a category's articles come a page at a time, with next_page", async () => {
  const { client } = await fixtureContent();
  const p1 = await list311Categories({ category_id: "311-12" }, client);
  assert.ok(size(p1) < 7000, `${size(p1)} characters`);
  assert.equal(p1.count, 42);
  assert.equal(p1.articles.length, 20);
  assert.equal(p1.next_page.offset, 20);
  const p3 = await list311Categories({ category_id: "311-12", offset: 40 }, client);
  assert.equal(p3.articles.length, 2);
  assert.equal(p3.next_page, null);
  const all = [p1, await list311Categories({ category_id: "311-12", offset: 20 }, client), p3].flatMap((p) => p.articles.map((a) => a.ka_number));
  assert.equal(new Set(all).size, 42);
});

test("offset is accepted by the tool's argument parser", async () => {
  const r = await callTool("list_311_categories", { category_id: "311-12", offset: -1 });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /'offset' must be at least 0/);
});

test("an offset past the end says so in plain words, not 'showing 42 to 500 of 42'", async () => {
  const { client } = await fixtureContent();
  const out = await list311Categories({ category_id: "311-12", offset: 500 }, client);
  assert.deepEqual(out.articles, []);
  assert.equal(out.next_page, null);
  assert.equal(out.showing, `Offset 500 is past the end: there are ${out.count} articles, 20 per page, so pages 1 to ${Math.ceil(out.count / 20)} (offsets 0, 20, 40).`);
  assert.doesNotMatch(out.showing, /to 500 of/);
});
