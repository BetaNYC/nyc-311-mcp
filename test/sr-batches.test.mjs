// #43 review: get_service_request_list takes up to MAX_SR_NUMBERS different 311 numbers and
// sends them SR_BATCH_SIZE at a time, one batch after another, through the 311 client. A failed
// batch keeps what earlier batches found, names the numbers not looked up, and sends nothing
// more. No network: fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";

const KEY = "k3y-311-abcdef0123456789";
process.env.NYC_311_API_KEY = KEY;
const { callTool, MAX_SR_NUMBERS, SR_BATCH_SIZE } = await import("../dist/tools.js");
const { SAFETY_LINE } = await import("../dist/emergency.js");

const SR = (n) => ({ SRNumber: n, Agency: "DSNY", Problem: "Snow or Ice", Status: "Closed" });
const answer = (r) => JSON.parse(r.content[0].text.slice(0, -SAFETY_LINE.length));
const numbers = (count, from = 0) => Array.from({ length: count }, (_, i) => `311-${20000000 + from + i}`);

/**
 * A stubbed GetServiceRequestList that records each batch and how many were in flight at once.
 * `onBatch(n, srNumbers)` may return a Response (or throw) to replace the normal answer.
 */
function stub(onBatch = () => null) {
  const seen = { batches: [], maxActive: 0 };
  let active = 0;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(new URL(String(url)).pathname.split("/").pop(), "GetServiceRequestList");
    const srs = JSON.parse(init.body).SRNumbers;
    seen.batches.push(srs);
    active++;
    seen.maxActive = Math.max(seen.maxActive, active);
    try {
      await new Promise((r) => setTimeout(r, 5));
      const replaced = await onBatch(seen.batches.length, srs);
      return replaced ?? Response.json({ SRResponses: srs.map(SR) });
    } finally {
      active--;
    }
  };
  return seen;
}

test("the batch size is 20 and the cap is 200 different numbers", () => {
  assert.equal(SR_BATCH_SIZE, 20);
  assert.equal(MAX_SR_NUMBERS, 200);
});

test("21 numbers go out as 2 requests, one after the other: 20, then 1", async () => {
  const seen = stub();
  const asked = numbers(21);
  const r = await callTool("get_service_request_list", { sr_numbers: asked });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.deepEqual(seen.batches, [asked.slice(0, 20), asked.slice(20)]);
  assert.equal(seen.maxActive, 1, "batches must never be sent in parallel");
  const a = answer(r);
  assert.equal(a.SRResponses.length, 21);
  assert.deepEqual(a.not_found, []);
  assert.deepEqual(a.lookup, { asked_for: 21, different_numbers: 21, found: 21, batches_sent: 2, batches_needed: 2, batch_size: 20 });
  assert.equal(a.not_looked_up, undefined);
});

test("45 numbers with duplicates: duplicates dropped first, each number sent once", async () => {
  const seen = stub();
  const unique = numbers(30);
  const asked = [...unique, ...unique.slice(0, 15)];
  assert.equal(asked.length, 45);
  const r = await callTool("get_service_request_list", { sr_numbers: asked });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.deepEqual(seen.batches, [unique.slice(0, 20), unique.slice(20)]);
  assert.equal(seen.batches.flat().length, 30);
  const a = answer(r);
  assert.equal(a.SRResponses.length, 30);
  assert.equal(a.lookup.asked_for, 45);
  assert.equal(a.lookup.different_numbers, 30);
  assert.equal(a.lookup.found, 30);
  assert.equal(a.lookup.batches_sent, 2);
});

test("duplicates do not count toward the cap: 260 entries with 200 different numbers are taken", async () => {
  const seen = stub();
  const unique = numbers(200);
  const r = await callTool("get_service_request_list", { sr_numbers: [...unique, ...unique.slice(0, 60)] });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.equal(seen.batches.length, 10);
  assert.equal(seen.maxActive, 1);
  assert.equal(answer(r).lookup.found, 200);
});

test("201 different numbers are refused in a plain sentence, with no request sent", async () => {
  const seen = stub();
  const r = await callTool("get_service_request_list", { sr_numbers: numbers(201) });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Error: get_service_request_list takes at most 200 different 311 numbers in one call; this list has 201\. Split it into calls of 200 or fewer\./);
  assert.equal(seen.batches.length, 0);
});

test("a bad number anywhere in the list is refused before any batch is sent", async () => {
  const seen = stub();
  const r = await callTool("get_service_request_list", { sr_numbers: [...numbers(25), "12345678"] });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /expected format '311-XXXXXXXX'/);
  assert.equal(seen.batches.length, 0);
});

test("a failure on batch 2 of 3: batch 1's answers come back, the rest are named, no third request", async () => {
  const seen = stub((n) => (n === 2 ? new Response("upstream trouble", { status: 500, statusText: "Internal Server Error" }) : null));
  const asked = numbers(45);
  const r = await callTool("get_service_request_list", { sr_numbers: asked });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.equal(seen.batches.length, 2, "no batch may be sent after a failed one");
  const a = answer(r);
  assert.equal(a.SRResponses.length, 20);
  assert.deepEqual(a.SRResponses.map((x) => x.SRNumber), asked.slice(0, 20));
  assert.deepEqual(a.not_found, [], "numbers never looked up are not 'not found'");
  assert.deepEqual(a.not_looked_up, asked.slice(20));
  assert.deepEqual(a.lookup, { asked_for: 45, different_numbers: 45, found: 20, batches_sent: 2, batches_needed: 3, batch_size: 20 });
  assert.match(a.not_looked_up_note, /^Stopped after 2 of 3 batches, so 25 numbers were not looked up: 311-20000020, /);
  assert.match(a.not_looked_up_note, /Why: NYC 311 API error 500: Internal Server Error/);
  assert.doesNotMatch(a.not_looked_up_note, /upstream trouble/, "the upstream body stays out of a successful answer");
});

test("a 429 stops at once: no further batch, and the wait the City asked for is passed on", async () => {
  const seen = stub((n) =>
    n === 2 ? new Response("Rate limit is exceeded. Try again in 163 seconds.", { status: 429, headers: { "retry-after": "163" } }) : null
  );
  const asked = numbers(60);
  const r = await callTool("get_service_request_list", { sr_numbers: asked });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.equal(seen.batches.length, 2, "a 429 must not be followed by another batch");
  const a = answer(r);
  assert.equal(a.lookup.found, 20);
  assert.deepEqual(a.not_looked_up, asked.slice(20));
  assert.match(a.not_looked_up_note, /HTTP 429.*about 163 seconds/);
});

test("a 429 on the first batch is a plain error, and no second batch is sent", async () => {
  const seen = stub(() => new Response("", { status: 429, headers: { "retry-after": "600" } }));
  const r = await callTool("get_service_request_list", { sr_numbers: numbers(30) });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /HTTP 429/);
  assert.equal(seen.batches.length, 1);
});

test("a key echoed in a failed batch's reason is redacted from the partial answer", async () => {
  const seen = stub((n) => {
    if (n === 2) throw new TypeError(`socket closed for ${KEY}`);
    return null;
  });
  const r = await callTool("get_service_request_list", { sr_numbers: numbers(25) });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.equal(seen.batches.length, 2);
  const text = r.content[0].text;
  assert.ok(!text.includes(KEY), "the 311 key leaked");
  assert.match(answer(r).not_looked_up_note, /Could not reach the City's 311 API \(socket closed for \[redacted\]\)/);
});

test("a batch the City answers 404 counts as not found; the next batch is still sent", async () => {
  const seen = stub((n) => (n === 1 ? new Response("not found", { status: 404, statusText: "Not Found" }) : null));
  const asked = numbers(25);
  const r = await callTool("get_service_request_list", { sr_numbers: asked });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.equal(seen.batches.length, 2);
  const a = answer(r);
  assert.deepEqual(a.not_found, asked.slice(0, 20));
  assert.equal(a.lookup.found, 5);
  assert.equal(a.not_looked_up, undefined);
});

test("every batch answered 404: the usual 'none of these' error", async () => {
  const seen = stub(() => new Response("not found", { status: 404, statusText: "Not Found" }));
  const r = await callTool("get_service_request_list", { sr_numbers: numbers(25) });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /311 has none of these service requests/);
  assert.equal(seen.batches.length, 2);
});
