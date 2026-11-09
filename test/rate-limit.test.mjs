// Beta test round 1 (2026-11-08): get_service_request hit HTTP 429 three times while
// get_service_request_list answered the same number. The API portal documents no limit
// numbers ("Available for general public with rate limit in place", product NYC 311
// Public Developers) but does document that each request in GetServiceRequestList "is
// the same as /GetServiceRequest/". A 429 on the single lookup now falls back to the list
// operation, waits are polite (Retry-After honored, bounded), and the error is plain.
// No network: fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getServiceRequest, getServiceRequestList, waitSecondsFrom } from "../dist/nyc-311.js";
import { callTool } from "../dist/tools.js";

process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
const SR = { SRNumber: "311-17323508", Agency: "Department of Sanitation", Problem: "Snow or Ice", Status: "Closed" };
const tooMany = (secs, header = true) =>
  new Response(JSON.stringify({ statusCode: 429, message: `Rate limit is exceeded. Try again in ${secs} seconds.` }), {
    status: 429,
    statusText: "Too Many Requests",
    headers: header ? { "retry-after": String(secs) } : {},
  });
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function stub(responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ path: new URL(String(url)).pathname.split("/").pop(), method: init.method ?? "GET", at: Date.now() });
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    return typeof next === "function" ? next() : next;
  };
  return calls;
}

test("waitSecondsFrom reads Retry-After, else the API's 'Try again in N seconds'", () => {
  assert.equal(waitSecondsFrom("3", ""), 3);
  assert.equal(waitSecondsFrom(null, "Rate limit is exceeded. Try again in 163 seconds."), 163);
  assert.equal(waitSecondsFrom(null, ""), null);
});

test("a 429 on the single lookup falls back to the list operation with that one number", async () => {
  const calls = stub([tooMany(163), ok({ SRResponses: [SR] })]);
  const r = await getServiceRequest("311-17323508");
  assert.equal(r.SRNumber, "311-17323508");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET GetServiceRequest", "POST GetServiceRequestList"]);
});

test("the fallback finding nothing is a not-found error, with the usual hint in the tool", async () => {
  stub([tooMany(2), ok({ SRResponses: [] })]);
  await assert.rejects(getServiceRequest("311-00000001"), / error 404/);
});

test("a short Retry-After is waited out and retried (twice at most), then the answer comes", async () => {
  const calls = stub([tooMany(0), tooMany(0), ok({ SRResponses: [SR] })]);
  const r = await getServiceRequestList(["311-17323508"]);
  assert.equal(r.SRResponses.length, 1);
  assert.equal(calls.length, 3);
});

test("a long Retry-After is not waited out: a plain error says how long to wait and why", async () => {
  const calls = stub([tooMany(163), tooMany(163)]);
  const t0 = Date.now();
  const res = await callTool("get_service_request", { sr_number: "311-17323508" });
  assert.ok(Date.now() - t0 < 2000, "no long wait");
  assert.equal(calls.length, 2, "single, then the list once");
  const text = res.content[0].text;
  assert.equal(res.isError, true);
  assert.match(text, /limiting requests from this API key/);
  assert.match(text, /about 163 seconds/);
  assert.match(text, /same NYC_311_API_KEY/);
  assert.doesNotMatch(text, /Response body|statusCode/);
});
