// Pins the exact HTTP request every 311 API operation sends: URL, method,
// headers, body. Written against `main` BEFORE the #9 cleanup and run green
// there, so the cleanup (one fetch helper, no STATUS_PATHS, a shorter calendar
// fallback) is proven not to change what goes over the wire.
//
// No network: fetch is stubbed and records each call.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getCalendar,
  getStatus,
  getServiceRequest,
  getServiceRequestList,
  todayIso,
} from "../dist/nyc-311.js";

process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
const BASE = "https://api.nyc.gov/public/api";
let calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({
    url: String(url),
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};
const take = () => {
  const c = calls;
  calls = [];
  return c;
};
const KEY_HEADER = { "Ocp-Apim-Subscription-Key": "test-key-never-sent-anywhere" };

test("getStatus requests /Status/<type> for every type", async () => {
  for (const type of ["CodeBlue", "FireHydrant", "OEM", "SnowOnSidewalk", "SnowOnStreet"]) {
    await getStatus(type);
    assert.deepEqual(take(), [
      { url: `${BASE}/Status/${type}`, method: "GET", headers: KEY_HEADER, body: undefined },
    ]);
  }
});

test("getServiceRequest sends srnumber as a query parameter", async () => {
  await getServiceRequest("311-17323508");
  assert.deepEqual(take(), [
    {
      url: `${BASE}/GetServiceRequest?srnumber=311-17323508`,
      method: "GET",
      headers: KEY_HEADER,
      body: undefined,
    },
  ]);
});

test("getServiceRequestList POSTs a JSON body of SRNumbers", async () => {
  await getServiceRequestList(["311-1", "311-2"]);
  assert.deepEqual(take(), [
    {
      url: `${BASE}/GetServiceRequestList`,
      method: "POST",
      headers: { ...KEY_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify({ SRNumbers: ["311-1", "311-2"] }),
    },
  ]);
});

// Every combination of date / fromDate / toDate, with the range the original
// fallback ladder resolved it to. "T" is today in New York.
const D = "2026-07-04";
const F = "2026-07-01";
const TO = "2026-07-07";
const CASES = [
  [{}, ["T", "T"]],
  [{ date: D }, [D, D]],
  [{ fromDate: F }, [F, F]],
  [{ toDate: TO }, [TO, TO]],
  [{ fromDate: F, toDate: TO }, [F, TO]],
  [{ date: D, fromDate: F }, [F, D]],
  [{ date: D, toDate: TO }, [D, TO]],
  [{ date: D, fromDate: F, toDate: TO }, [F, TO]],
];

test("getCalendar resolves every date/from/to combination as before", async () => {
  const today = todayIso();
  for (const [opts, [from, to]] of CASES) {
    const f = from === "T" ? today : from;
    const t = to === "T" ? today : to;
    await getCalendar(opts);
    assert.deepEqual(
      take(),
      [
        {
          url: `${BASE}/GetCalendar?fromdate=${f}&todate=${t}`,
          method: "GET",
          headers: KEY_HEADER,
          body: undefined,
        },
      ],
      JSON.stringify(opts)
    );
  }
});

test("getCalendar still rejects reversed and over-90-day ranges before any request", async () => {
  await assert.rejects(getCalendar({ fromDate: TO, toDate: F }), /is after to_date/);
  await assert.rejects(
    getCalendar({ fromDate: "2026-01-01", toDate: "2026-06-01" }),
    /maximum is 90 days/
  );
  assert.deepEqual(take(), []);
});
