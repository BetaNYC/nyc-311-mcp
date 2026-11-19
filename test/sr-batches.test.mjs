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

// ── #49 review, round 2 ─────────────────────────────────────────────────────────

const { getServiceRequestBatches, OUT_OF_TIME, SR_BATCH_GAP_MS, SR_LIST_BUDGET_MS, MAX_SR_LIST_ENTRIES } = await import("../dist/nyc-311.js");

// A. A 429 is never retried inside a batch run: one request for that batch, none after.
for (const [label, headers] of [["no Retry-After", {}], ["retry-after: 3", { "retry-after": "3" }]]) {
  test(`A: a 429 with ${label} on batch 2 ends the run at once: one request for it, none after`, async () => {
    const seen = stub((n) => (n === 2 ? new Response("", { status: 429, headers }) : null));
    const asked = numbers(60);
    const r = await callTool("get_service_request_list", { sr_numbers: asked });
    assert.notEqual(r.isError, true, r.content[0].text);
    assert.equal(seen.batches.length, 2, "batch 2 sent once, batch 3 never");
    const a = answer(r);
    assert.equal(a.lookup.found, 20);
    assert.deepEqual(a.not_looked_up, asked.slice(20));
    assert.match(a.not_looked_up_note, /HTTP 429/);
  });
}

// B. Pacing and the time budget, on a fake clock.
function fakeClock() {
  const c = { t: 1_000_000, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.sleeps.push(ms);
    c.t += ms;
  };
  return c;
}

test("B: batches go out 250 ms apart, and the whole call has 45 seconds", async () => {
  assert.equal(SR_BATCH_GAP_MS, 250);
  assert.equal(SR_LIST_BUDGET_MS, 45_000);
  const clock = fakeClock();
  const seen = stub();
  const got = await getServiceRequestBatches(numbers(61), { now: clock.now, sleep: clock.sleep });
  assert.equal(seen.batches.length, 4);
  assert.deepEqual(clock.sleeps, [250, 250, 250], "one gap between each two batches, none before the first");
  assert.equal(got.stopped_because, null);
});

test("B: when the budget is spent, no batch starts: what was fetched comes back, the rest is out of time", async () => {
  const clock = fakeClock();
  const seen = stub(() => {
    clock.t += 23_000; // each batch takes 23 s on the fake clock
    return null;
  });
  const asked = numbers(80);
  const got = await getServiceRequestBatches(asked, { now: clock.now, sleep: clock.sleep });
  assert.equal(seen.batches.length, 2, "batch 3 must not start after 45 s");
  assert.equal(got.SRResponses.length, 40);
  assert.deepEqual(got.not_looked_up, asked.slice(40));
  assert.equal(got.stopped_because, OUT_OF_TIME);
  assert.equal(OUT_OF_TIME, "out of time: ask again for these");
});

test("B: a batch in flight gets only the time left, then the run stops with what it has", async () => {
  const clock = fakeClock();
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    n++;
    const srs = JSON.parse(init.body).SRNumbers;
    if (n === 1) {
      clock.t += 44_000; // 44 s used; after the 250 ms gap, 750 ms are left
      return Response.json({ SRResponses: srs.map(SR) });
    }
    // Batch 2 hangs until its signal fires: that must be the 750 ms left, not the 30 s timeout.
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  };
  const started = Date.now();
  const asked = numbers(45);
  // AbortSignal.timeout's timer does not keep Node alive (a running server has stdin open for
  // that); here nothing else would, so the test runner would end the file while batch 2 waits.
  const keepAlive = setInterval(() => {}, 1_000);
  let got;
  try {
    got = await getServiceRequestBatches(asked, { now: clock.now, sleep: clock.sleep });
  } finally {
    clearInterval(keepAlive);
  }
  const took = Date.now() - started;
  assert.ok(took < 5_000, `batch 2 was given ${took} ms, more than the time left`);
  assert.equal(n, 2);
  assert.equal(got.SRResponses.length, 20);
  assert.deepEqual(got.not_looked_up, asked.slice(20));
  assert.equal(got.stopped_because, OUT_OF_TIME);
});

test("B: a 5xx retry wait longer than the time left is not waited out", async () => {
  const clock = fakeClock();
  const seen = stub((n) => {
    if (n === 1) {
      clock.t += 34_000; // after the gap, 10.75 s are left: less than the 15 s the City asks
      return null;
    }
    return new Response("", { status: 503, statusText: "Service Unavailable", headers: { "retry-after": "15" } });
  });
  const started = Date.now();
  const got = await getServiceRequestBatches(numbers(45), { now: clock.now, sleep: clock.sleep });
  assert.ok(Date.now() - started < 5_000, "the retry wait was waited out");
  assert.equal(seen.batches.length, 2, "batch 2 sent once, not retried, and batch 3 never");
  assert.equal(got.SRResponses.length, 20);
  assert.match(got.stopped_because, /NYC 311 API error 503/);
});

// C. The 311 API's body never reaches the message; it is toolError's upstreamBody.
test("C: a 500 whose body holds a stack frame: plain sentence, body under 'The source said', frame dropped", async () => {
  globalThis.fetch = async () =>
    new Response(`upstream trouble\n    at evil (/Users/x/secret/path.js:1:2)\nmore ${KEY}`, { status: 500, statusText: "Internal Server Error" });
  const r = await callTool("get_service_request", { sr_number: "311-17323508" });
  assert.equal(r.isError, true);
  const t = r.content[0].text;
  assert.match(t, /^Error: NYC 311 API error 500: Internal Server Error\nThe source said: upstream trouble\nmore \[redacted\]/);
  assert.ok(!t.includes("/Users/x/secret"), "the stack frame leaked");
  assert.ok(!t.includes(KEY));
  assert.doesNotMatch(t, /Response body/);
});

// E. Small ones.
test("E: results come back in the order asked, duplicates at their first place, whatever order the City answers in", async () => {
  globalThis.fetch = async (url, init = {}) => {
    const srs = JSON.parse(init.body).SRNumbers;
    return Response.json({ SRResponses: [...srs].reverse().map(SR) });
  };
  const [a, b, c] = numbers(3);
  const r = await callTool("get_service_request_list", { sr_numbers: [b, a, b, c, a] });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.deepEqual(answer(r).SRResponses.map((x) => x.SRNumber), [b, a, c]);
});

test("E: spaces around a number are trimmed before it is checked, and a trimmed duplicate is one number", async () => {
  const seen = stub();
  const [a, b] = numbers(2);
  const r = await callTool("get_service_request_list", { sr_numbers: [` ${a}`, `${b} `, a] });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.deepEqual(seen.batches, [[a, b]]);
  assert.equal(answer(r).lookup.different_numbers, 2);
});

test("E: 311-0020000001 and 311-20000001 are two numbers (no document says they are one)", async () => {
  const seen = stub();
  const r = await callTool("get_service_request_list", { sr_numbers: ["311-0020000001", "311-20000001"] });
  assert.notEqual(r.isError, true, r.content[0].text);
  assert.deepEqual(seen.batches, [["311-0020000001", "311-20000001"]]);
});

test("E: a raw list longer than 2,000 entries is refused before duplicates are removed, with no request", async () => {
  assert.equal(MAX_SR_LIST_ENTRIES, 2_000);
  const seen = stub();
  const r = await callTool("get_service_request_list", { sr_numbers: Array(2_001).fill("311-20000000") });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Error: get_service_request_list takes at most 2,000 entries in sr_numbers, duplicates included; this list has 2,001\./);
  assert.equal(seen.batches.length, 0);
  const ok = await callTool("get_service_request_list", { sr_numbers: Array(2_000).fill("311-20000000") });
  assert.notEqual(ok.isError, true, ok.content[0].text);
});

test("E: not_looked_up_note ends its reason with a full stop before the next sentence", async () => {
  stub((n) => (n === 2 ? new Response("", { status: 400, statusText: "Bad Request" }) : null));
  const r = await callTool("get_service_request_list", { sr_numbers: numbers(25) });
  assert.match(answer(r).not_looked_up_note, /Why: NYC 311 API error 400: Bad Request\. No further batches were sent\./);
  const clock = fakeClock();
  stub(() => {
    clock.t += 46_000;
    return null;
  });
  const got = await getServiceRequestBatches(numbers(25), { now: clock.now, sleep: clock.sleep });
  assert.equal(got.stopped_because, OUT_OF_TIME);
});
