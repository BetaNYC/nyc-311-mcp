// #44 and #45: no answer ever carries NYC_311_API_KEY or SOCRATA_APP_TOKEN, and every
// failure is isError with a plain sentence: no stack-frame lines, upstream text capped.
// No network: fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";

const KEY = "k3y-311-abcdef0123456789";
const TOKEN = "s0crataT0ken-xyz987";
process.env.NYC_311_API_KEY = KEY;
process.env.SOCRATA_APP_TOKEN = TOKEN;
const { callTool } = await import("../dist/tools.js");

function stub(make) {
  globalThis.fetch = async (url, init = {}) => make(String(url), init);
}
const text = (r) => r.content.map((c) => c.text).join("\n");

function assertClean(r) {
  const t = text(r);
  assert.equal(r.isError, true);
  assert.ok(!t.includes(KEY), "the 311 key leaked");
  assert.ok(!t.includes(encodeURIComponent(KEY)), "the 311 key leaked, URL-encoded");
  assert.ok(!t.includes(TOKEN), "the Socrata token leaked");
  assert.doesNotMatch(t, /^\s*at\s+\S/m, "a stack-frame line came through");
  assert.match(t, /^Error: /);
}

test("an upstream error body that echoes the keys is redacted", async () => {
  stub(() => new Response(`bad subscription key ${KEY} and token ${TOKEN}`, { status: 401, statusText: "Unauthorized" }));
  const r = await callTool("get_status", { type: "CodeBlue" });
  assertClean(r);
  assert.match(text(r), /\[redacted\]/);
  assert.match(text(r), /authentication failed/);
});

test("an exception whose message holds the key, with a stack trace, is redacted and the frames dropped", async () => {
  stub(() => {
    throw new Error(`socket closed for ${KEY}\n    at fetch (node:internal/deps/undici:1:1)\n    at async apiFetch (file:///x/dist/nyc-311.js:9:9)`);
  });
  const r = await callTool("get_calendar", { date: "2026-11-18" });
  assertClean(r);
  assert.match(text(r), /Could not reach the City's 311 API \(socket closed for \[redacted\]\)\. Check the internet connection/);
});

test("a long upstream body is cut to 500 characters", async () => {
  stub(() => new Response("x".repeat(5_000), { status: 400, statusText: "Bad Request" }));
  const r = await callTool("get_service_request", { sr_number: "311-17323508" });
  assertClean(r);
  const xs = text(r).match(/x+/g).sort((a, b) => b.length - a.length)[0];
  assert.equal(xs.length, 500);
});

test("argument errors stay plain sentences", async () => {
  const r = await callTool("get_status", { type: "Earthquake" });
  assertClean(r);
  assert.match(text(r), /must be one of/);
});

test("the keys are sent in headers, never in the URL", async () => {
  const seen = [];
  stub((url, init) => {
    seen.push({ url, headers: init.headers });
    return Response.json({ inEffect: false });
  });
  await callTool("get_status", { type: "CodeBlue" });
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].url.includes(KEY));
  assert.equal(seen[0].headers["Ocp-Apim-Subscription-Key"], KEY);
});
