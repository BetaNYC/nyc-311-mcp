// #41, #42: the four answers from the 311 Public API name their source and publisher, link it,
// and say when they were fetched, in the words DATA-SOURCES.json uses.
// #43: get_service_request_list takes at most MAX_SR_NUMBERS different numbers (test/sr-batches.test.mjs has the batching). No network: fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./with-api-key.mjs";
import { callTool, TOOLS, MAX_SR_NUMBERS } from "../dist/tools.js";
import { SAFETY_LINE } from "../dist/emergency.js";

const DS = JSON.parse(readFileSync(new URL("../DATA-SOURCES.json", import.meta.url), "utf8"));
const byId = (id) => DS.sources.find((s) => s.id === id);
const SR = (n) => ({ SRNumber: `311-${n}`, Agency: "DSNY", Problem: "Snow or Ice", Status: "Closed" });
const answer = (r) => JSON.parse(r.content[0].text.slice(0, -SAFETY_LINE.length));

let calls = 0;
globalThis.fetch = async (url, init = {}) => {
  calls++;
  const op = new URL(String(url)).pathname.split("/").pop();
  if (op === "GetCalendar") return Response.json({ days: [] });
  if (op === "GetServiceRequest") return Response.json(SR(17323508));
  if (op === "GetServiceRequestList") return Response.json({ SRResponses: JSON.parse(init.body).SRNumbers.map((n) => SR(n.slice(4))) });
  return Response.json({ inEffect: false });
};

const CASES = [
  ["get_calendar", { date: "2026-11-18" }, "calendar-and-status"],
  ["get_status", { type: "CodeBlue" }, "calendar-and-status"],
  ["get_service_request", { sr_number: "311-17323508" }, "service-request-lookup"],
  ["get_service_request_list", { sr_numbers: ["311-17323508"] }, "service-request-lookup"],
];

for (const [tool, args, id] of CASES) {
  test(`${tool} names its source, links it and says when it was fetched`, async () => {
    const before = Date.now();
    const r = await callTool(tool, args);
    assert.notEqual(r.isError, true, r.content[0].text);
    const p = answer(r).provenance;
    const s = byId(id);
    assert.equal(p.source, s.source_name);
    assert.equal(p.publisher, s.publisher.name);
    assert.equal(p.source_url, s.source_url);
    assert.match(p.source_url, /^https:\/\//);
    assert.equal(p.as_of_kind, "retrieved");
    assert.ok(Date.parse(p.as_of) >= before - 1000 && Date.parse(p.as_of) <= Date.now() + 1000);
  });
}

test(`get_service_request_list caps different numbers, not list length, at ${MAX_SR_NUMBERS}`, async () => {
  const schema = TOOLS.find((t) => t.name === "get_service_request_list").inputSchema.properties.sr_numbers;
  // No maxItems: duplicates do not count toward the cap, so only the server can apply it.
  assert.equal(schema.maxItems, undefined);
  assert.equal(MAX_SR_NUMBERS, 200);
  const many = Array.from({ length: 500 }, (_, i) => `311-${10000000 + i}`);
  calls = 0;
  const r = await callTool("get_service_request_list", { sr_numbers: many });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, new RegExp(`at most ${MAX_SR_NUMBERS} different 311 numbers.*this list has 500.*Split it`));
  assert.equal(calls, 0, "a list over the cap must not reach the City");
  const full = await callTool("get_service_request_list", { sr_numbers: many.slice(0, MAX_SR_NUMBERS) });
  assert.notEqual(full.isError, true);
  assert.equal(answer(full).SRResponses.length, MAX_SR_NUMBERS);
});
