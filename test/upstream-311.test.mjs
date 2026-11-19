// #40: every request to the 311 Public API has a timeout, names this package in its
// User-Agent, and retries a 502, 503 or 504 once (Retry-After honored). No network: fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getStatus, getServiceRequestList, REQUEST_TIMEOUT_MS } from "../dist/nyc-311.js";
import { USER_AGENT } from "../dist/version.js";

process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
const ok = (body = { inEffect: false }) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status, headers = {}) => new Response("upstream trouble", { status, statusText: "Bad", headers });

function stub(responses) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push(init);
    const next = responses.shift();
    if (!next) throw new Error("no more stubbed responses");
    return typeof next === "function" ? next(init) : next;
  };
  return calls;
}

test("every request carries a timeout signal and the package User-Agent", async () => {
  const calls = stub([ok()]);
  await getStatus("CodeBlue");
  assert.ok(calls[0].signal instanceof AbortSignal, "no AbortSignal");
  assert.equal(calls[0].headers["User-Agent"], USER_AGENT);
  assert.match(USER_AGENT, /^@betanyc\/nyc-311-mcp\/\d+\.\d+\.\d+ \(\+https:/);
  assert.ok(REQUEST_TIMEOUT_MS >= 15_000 && REQUEST_TIMEOUT_MS <= 30_000);
});

for (const status of [502, 503, 504]) {
  test(`a ${status} is retried once, honoring Retry-After`, async () => {
    const calls = stub([fail(status, { "retry-after": "0" }), ok()]);
    const r = await getStatus("CodeBlue");
    assert.deepEqual(r, { inEffect: false });
    assert.equal(calls.length, 2);
  });
}

test("a second 503 is not retried again: the plain error comes back", async () => {
  const calls = stub([fail(503, { "retry-after": "0" }), fail(503, { "retry-after": "0" })]);
  await assert.rejects(getStatus("CodeBlue"), /NYC 311 API error 503/);
  assert.equal(calls.length, 2);
});

test("a 500 or a 400 is not retried", async () => {
  for (const status of [500, 400]) {
    const calls = stub([fail(status)]);
    await assert.rejects(getServiceRequestList(["311-1"]), new RegExp(`error ${status}`));
    assert.equal(calls.length, 1);
  }
});

test("a long Retry-After on a 503 is reported, not waited out", async () => {
  const calls = stub([fail(503, { "retry-after": "600" })]);
  const t0 = Date.now();
  await assert.rejects(getStatus("CodeBlue"), /error 503/);
  assert.equal(calls.length, 1);
  assert.ok(Date.now() - t0 < 2_000);
});

test("a request with no answer in time ends in a plain sentence", async () => {
  stub([() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))]);
  await assert.rejects(getStatus("CodeBlue"), (e) => {
    assert.equal(e.message, `The City's 311 API sent no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again in a minute.`);
    return true;
  });
});

test("a network failure ends in a plain sentence", async () => {
  stub([() => Promise.reject(new TypeError("fetch failed"))]);
  await assert.rejects(getStatus("CodeBlue"), /Could not reach the City's 311 API \(fetch failed\)\. Check the internet connection/);
});

// Review of #40: the body is read and parsed inside the same try/catch as the request, so a
// timeout while the body arrives, or a body that is not JSON, ends in a plain sentence too.
test("a timeout while the answer's body is read ends in the same plain sentence", async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"inEff'));
      c.error(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    },
  });
  stub([new Response(body, { status: 200 })]);
  await assert.rejects(getStatus("CodeBlue"), (e) => {
    assert.equal(e.message, `The City's 311 API sent no answer within ${REQUEST_TIMEOUT_MS / 1000} seconds. Try again in a minute.`);
    return true;
  });
});

test("a connection lost while the body is read ends in a plain sentence", async () => {
  const body = new ReadableStream({
    start(c) {
      c.error(new TypeError("terminated\n    at Fetch.onAborted (node:internal/deps/undici:1:1)"));
    },
  });
  stub([new Response(body, { status: 200 })]);
  await assert.rejects(getStatus("CodeBlue"), (e) => {
    assert.equal(e.message, "Could not reach the City's 311 API (terminated). Check the internet connection and try again in a minute.");
    return true;
  });
});

test("a 200 whose body is not JSON ends in a plain sentence, not a SyntaxError", async () => {
  for (const text of ["<html><body>Service Unavailable</body></html>", ""]) {
    stub([new Response(text, { status: 200, headers: { "content-type": "text/html" } })]);
    await assert.rejects(getServiceRequestList(["311-1"]), (e) => {
      assert.ok(!(e instanceof SyntaxError), "a raw SyntaxError came through");
      assert.equal(e.message, "The City's 311 API sent an answer that could not be read (it was not JSON). Try again in a minute.");
      return true;
    });
  }
});

test("through the tool, a non-JSON answer is a plain isError sentence", async () => {
  stub([new Response("<html>oops</html>", { status: 200 })]);
  const { callTool } = await import("../dist/tools.js");
  const r = await callTool("get_status", { type: "CodeBlue" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Error: The City's 311 API sent an answer that could not be read \(it was not JSON\)\./);
  assert.doesNotMatch(r.content[0].text, /Unexpected token|SyntaxError|JSON at position/);
});
