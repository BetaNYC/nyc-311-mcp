import { test } from "node:test";
import assert from "node:assert/strict";
import { todayIso, assertSrNumber, retryAfterMs } from "./nyc-311.js";

// ─── todayIso ────────────────────────────────────────────────────────────────

test("todayIso returns today's date in America/New_York", () => {
  const now = new Date();
  const expected = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(now);
  assert.equal(todayIso(now), expected);
  assert.match(todayIso(now), /^\d{4}-\d{2}-\d{2}$/);
});

test("todayIso diverges from UTC toISOString at 23:30 ET", () => {
  // 2026-01-15T04:30:00Z is 2026-01-14 23:30 in New York (EST, UTC-5).
  const lateEveningEt = new Date("2026-01-15T04:30:00Z");
  assert.equal(todayIso(lateEveningEt), "2026-01-14");
  assert.equal(lateEveningEt.toISOString().split("T")[0], "2026-01-15");
});

test("todayIso diverges from UTC toISOString at 23:30 EDT (summer)", () => {
  // 2026-07-06T03:30:00Z is 2026-07-05 23:30 in New York (EDT, UTC-4).
  const lateEveningEdt = new Date("2026-07-06T03:30:00Z");
  assert.equal(todayIso(lateEveningEdt), "2026-07-05");
  assert.equal(lateEveningEdt.toISOString().split("T")[0], "2026-07-06");
});

// ─── assertSrNumber ──────────────────────────────────────────────────────────

test("assertSrNumber accepts valid SR numbers", () => {
  assert.equal(assertSrNumber("311-17323508"), "311-17323508");
  assert.equal(assertSrNumber("311-1"), "311-1");
});

test("assertSrNumber rejects malformed SR numbers with corrective message", () => {
  for (const bad of ["17323508", "311_17323508", "311-", "311-17 32", "C1-12345", " 311-123"]) {
    assert.throws(
      () => assertSrNumber(bad),
      /expected format '311-XXXXXXXX'/,
      `should reject '${bad}'`
    );
  }
});

// ─── retryAfterMs ────────────────────────────────────────────────────────────

test("retryAfterMs honors numeric Retry-After, capped at 10s", () => {
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(retryAfterMs("60"), 10_000);
  assert.equal(retryAfterMs("0"), 0);
});

test("retryAfterMs handles HTTP-date Retry-After, capped at 10s", () => {
  const future = new Date(Date.now() + 3000).toUTCString();
  const ms = retryAfterMs(future);
  assert.ok(ms > 0 && ms <= 10_000, `got ${ms}`);
  const farFuture = new Date(Date.now() + 60_000).toUTCString();
  assert.equal(retryAfterMs(farFuture), 10_000);
  const past = new Date(Date.now() - 60_000).toUTCString();
  assert.equal(retryAfterMs(past), 0);
});

test("retryAfterMs defaults to 1s when header absent or unparseable", () => {
  assert.equal(retryAfterMs(null), 1000);
  assert.equal(retryAfterMs("soon"), 1000);
});

test("retryAfterMs clamps negative delta-seconds to 0", () => {
  assert.equal(retryAfterMs("-5"), 0);
});
