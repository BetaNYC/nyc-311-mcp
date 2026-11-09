// Beta retest 7 (2026-11-09, home machine): July failed six times across the FY2027 fill and
// every answer said "try 1 of 4". The count lived in each background load and started again
// at 1 with every new load, and a load usually ended (its 4-minute limit) before a slow
// month's fourth try, so the 4-try limit was never reached. Now the count is kept per month
// for the life of the server, climbs across calls, and after 4 failures in a row the month
// rests (DA_REST_MS) before a new round of tries. No network: a fake portal and clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { directoryAssistanceReport, DA_MONTH_TRIES, DA_REST_MS } from "../dist/ll47-reports.js";
import { SodaClient } from "../dist/soda.js";
import { parseToolArgs } from "../dist/tools.js";

const SODA_FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "soda", "wewp-mm3p");
const NOW = Date.parse("2026-11-07T12:00:00Z");
const args = parseToolArgs("ll47_directory_assistance_report", { fiscal_year: 2027 });

async function portal({ failJuly }) {
  let clock = NOW;
  const asked = [];
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-retry-count-"));
  const soda = new SodaClient({
    logger: () => {},
    cacheDir: dir,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/api/views/wewp-mm3p.json") return new Response(await readFile(path.join(SODA_FIX, "view.json")));
      const ym = /date >= '(\d{4}-\d{2})-01/.exec(u.searchParams.get("$where"))[1];
      asked.push(ym);
      clock += 4_000; // a slow failure: not retried inside one try (DA_REQUEST.noRetryAfterMs)
      if (ym === "2026-07" && failJuly()) return new Response("Service Unavailable", { status: 503 });
      if (u.searchParams.get("$offset") !== "0") return Response.json([]);
      const body = await readFile(path.join(SODA_FIX, `${ym}.json`)).catch(() => null);
      return body ? new Response(body) : Response.json([]);
    },
  });
  // August to November saved, so each call's load is about July alone.
  const view = JSON.parse(await readFile(path.join(SODA_FIX, "view.json"), "utf8"));
  for (const ym of ["2026-08", "2026-09", "2026-10"]) {
    const rows = JSON.parse(await readFile(path.join(SODA_FIX, `${ym}.json`), "utf8")).map((r) => ({ inquiry_name: r.inquiry_name, agency: null, agency_name: null, call_resolution: null, n: Number(r.n) }));
    await soda.writeCache(`wewp-mm3p/${ym}`, view.rowsUpdatedAt, rows);
  }
  await soda.writeCache("wewp-mm3p/2026-11", view.rowsUpdatedAt, []);
  return { soda, asked, tick: (ms) => (clock += ms), now: () => clock };
}

const julyWhy = (env) => (env.data.fiscal_year.months_missing ?? []).find((m) => m.month === "2026-07")?.why;

test("the try count climbs across calls, the 4-try limit holds, and the month rests before a new round", async () => {
  assert.equal(DA_MONTH_TRIES, 4);
  let down = true;
  const p = await portal({ failJuly: () => down });
  // A short background limit, so each call's load ends after one try of July, as on the home
  // Mac where a slow month's load ran out of time between tries.
  const call = () => directoryAssistanceReport(args, p.soda, NOW, { backgroundMs: 6_000, retryPauseMs: 3_000 });
  const whys = [];
  for (let i = 0; i < 6; i++) {
    whys.push(julyWhy(await call()));
    p.tick(75_000);
  }
  const julyAsked = p.asked.filter((m) => m === "2026-07").length;
  assert.equal(julyAsked, DA_MONTH_TRIES, `July asked ${julyAsked} times; the limit is ${DA_MONTH_TRIES}`);
  assert.match(whys[0], /try 1 of 4/);
  assert.match(whys[1], /try 2 of 4/);
  assert.match(whys[2], /try 3 of 4/);
  for (const w of whys.slice(3)) assert.match(w, /failed 4 times in a row.*not asked again until/, w);
  // After the rest, a new round: asked again, and once it answers the month is saved.
  p.tick(DA_REST_MS);
  down = false;
  const done = await call();
  assert.equal(done.data.fiscal_year.complete, true, JSON.stringify(done.data.fiscal_year.months_missing));
  assert.equal(p.asked.filter((m) => m === "2026-07").length, DA_MONTH_TRIES + 1);
});

test("a month that answers after failed tries is saved, and the answer after says so", async () => {
  let fails = 2;
  const p = await portal({ failJuly: () => fails-- > 0 });
  const call = () => directoryAssistanceReport(args, p.soda, NOW, { backgroundMs: 6_000 });
  assert.match(julyWhy(await call()), /try 1 of 4/);
  p.tick(75_000);
  assert.match(julyWhy(await call()), /try 2 of 4/);
  p.tick(75_000);
  const third = await call();
  assert.equal(julyWhy(third), undefined, "July answered on its third try");
  assert.equal(third.data.fiscal_year.complete, true);
});
