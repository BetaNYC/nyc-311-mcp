import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATA_START,
  fiscalYearOf,
  fiscalYearRange,
  monthsInPeriod,
  parseFiscalYear,
  resolvePeriod,
} from "../dist/fiscal-year.js";

const WINDOW = { start: "2020-01-01", end: "2026-11-07" };

test("FY2027 runs 2026-07-01 to 2027-06-30", () => {
  assert.deepEqual(fiscalYearRange(2027), { start: "2026-07-01", end: "2027-06-30" });
});

test("fiscalYearOf turns over on July 1", () => {
  assert.equal(fiscalYearOf("2026-06-30"), 2026);
  assert.equal(fiscalYearOf("2026-07-01"), 2027);
  assert.equal(fiscalYearOf("2027-06-30"), 2027);
  assert.equal(fiscalYearOf("2026-12-31"), 2027);
  assert.equal(fiscalYearOf("2020-01-01"), 2020);
});

test("parseFiscalYear accepts the usual spellings and rejects the rest", () => {
  for (const v of [2027, "2027", "FY2027", "fy2027", "FY27", "fy 27", " FY 2027 "]) {
    assert.equal(parseFiscalYear(v), 2027, String(v));
  }
  for (const v of ["FY", "2027-28", "FY 2026/27", "twenty", 2027.5, "FY202"]) {
    assert.throws(() => parseFiscalYear(v), /fiscal year/i, String(v));
  }
});

test("resolvePeriod: a fiscal year", () => {
  const p = resolvePeriod({ fiscal_year: "FY2026" }, WINDOW);
  assert.deepEqual(
    { start: p.start, end: p.end, fy: p.fiscal_year, notes: p.notes },
    { start: "2025-07-01", end: "2026-06-30", fy: 2026, notes: [] }
  );
  assert.equal(p.label, "FY2026 (2025-07-01 to 2026-06-30)");
});

test("resolvePeriod: the current fiscal year is cut to the data and called year to date", () => {
  const p = resolvePeriod({ fiscal_year: 2027 }, WINDOW);
  assert.equal(p.start, "2026-07-01");
  assert.equal(p.end, "2026-11-07");
  assert.match(p.notes.join(" "), /fiscal year to date/);
});

test("resolvePeriod: FY2020 starts at the data start, with a note", () => {
  const p = resolvePeriod({ fiscal_year: 2020 }, WINDOW);
  assert.equal(p.start, DATA_START);
  assert.equal(p.end, "2020-06-30");
  assert.match(p.notes[0], /data begins 2020-01-01/);
});

test("resolvePeriod: calendar ranges, open ends and fallback", () => {
  assert.deepEqual(
    pick(resolvePeriod({ from_date: "2025-01-01", to_date: "2025-12-31" }, WINDOW)),
    ["2025-01-01", "2025-12-31"]
  );
  assert.deepEqual(pick(resolvePeriod({ from_date: "2026-10-01" }, WINDOW)), ["2026-10-01", "2026-11-07"]);
  assert.deepEqual(pick(resolvePeriod({ to_date: "2020-03-31" }, WINDOW)), ["2020-01-01", "2020-03-31"]);
  assert.deepEqual(
    pick(resolvePeriod({}, WINDOW, { start: "2025-11-01", end: "2026-11-07" })),
    ["2025-11-01", "2026-11-07"]
  );
});

test("resolvePeriod refuses mixed, reversed, unreal and out-of-window periods", () => {
  assert.throws(() => resolvePeriod({ fiscal_year: 2026, from_date: "2025-01-01" }, WINDOW), /not both/);
  assert.throws(() => resolvePeriod({ from_date: "2025-02-01", to_date: "2025-01-01" }, WINDOW), /after the end/);
  assert.throws(() => resolvePeriod({ from_date: "2025-02-30" }, WINDOW), /not a real calendar date/);
  assert.throws(() => resolvePeriod({ from_date: "2025/01/01" }, WINDOW), /YYYY-MM-DD/);
  assert.throws(() => resolvePeriod({ fiscal_year: 2015 }, WINDOW), /before the data begins/);
  assert.throws(() => resolvePeriod({ from_date: "2027-01-01" }, WINDOW), /after the latest data/);
  assert.throws(() => resolvePeriod({}, WINDOW), /period is required/);
});

test("monthsInPeriod lists the months and flags partial ones", () => {
  assert.deepEqual(monthsInPeriod({ start: "2026-07-01", end: "2027-06-30" }).partial, []);
  assert.equal(monthsInPeriod({ start: "2026-07-01", end: "2027-06-30" }).months.length, 12);
  assert.deepEqual(monthsInPeriod({ start: "2026-07-01", end: "2026-11-07" }), {
    months: ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"],
    partial: ["2026-11"],
  });
  assert.deepEqual(monthsInPeriod({ start: "2024-02-10", end: "2024-02-29" }), {
    months: ["2024-02"],
    partial: ["2024-02"],
  });
  assert.deepEqual(monthsInPeriod({ start: "2025-12-01", end: "2026-01-31" }).months, ["2025-12", "2026-01"]);
});

function pick(p) {
  return [p.start, p.end];
}
