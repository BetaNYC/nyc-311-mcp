// Beta retest 8 (2026-11-09, home machine): the first FY2027 call on an empty cache took 16.0 s
// against the ~12 s answer wait, because the wait started only after the dataset metadata had
// come back (about 4 s that day). Now the wait counts from the start of the call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { directoryAssistanceReport, FY_METADATA_SLOW } from "../dist/ll47-reports.js";
import { SodaClient } from "../dist/soda.js";
import { parseToolArgs } from "../dist/tools.js";

const SODA_FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "soda", "wewp-mm3p");
const NOW = Date.parse("2026-11-07T12:00:00Z");
const args = parseToolArgs("ll47_directory_assistance_report", { fiscal_year: 2027 });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function slowMetadataPortal(dir, metaMs) {
  const offset = Date.now() - NOW;
  const asked = [];
  const soda = new SodaClient({
    logger: () => {},
    cacheDir: dir,
    minIntervalMs: 5,
    now: () => Date.now() - offset,
    fetch: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/api/views/wewp-mm3p.json") {
        await pause(metaMs);
        return new Response(await readFile(path.join(SODA_FIX, "view.json")));
      }
      const ym = /date >= '(\d{4}-\d{2})-01/.exec(u.searchParams.get("$where"))[1];
      asked.push(ym);
      await pause(20);
      if (u.searchParams.get("$offset") !== "0") return Response.json([]);
      const body = await readFile(path.join(SODA_FIX, `${ym}.json`)).catch(() => null);
      return body ? new Response(body) : Response.json([]);
    },
  });
  return { soda, asked };
}

test("the answer wait includes the metadata lookup: an empty cache answers in time, and the load goes on", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-first-call-"));
  const { soda, asked } = slowMetadataPortal(dir, 400);
  const t0 = Date.now();
  await assert.rejects(directoryAssistanceReport(args, soda, NOW, { answerWaitMs: 250 }), (e) => e.message === FY_METADATA_SLOW);
  const took = Date.now() - t0;
  assert.ok(took < 350, `answered after ${took} ms; the wait was 250 ms and the metadata took 400 ms`);
  for (let i = 0; i < 100 && asked.length < 5; i++) await pause(20);
  await pause(100);
  assert.deepEqual(asked, ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"], "the months loaded after the metadata arrived");
  const done = await directoryAssistanceReport(args, soda, NOW, { answerWaitMs: 250 });
  assert.equal(done.data.fiscal_year.complete, true);
  assert.equal(asked.length, 5, "nothing asked twice");
});

test("with the metadata saved on disk, a slow metadata lookup still answers within the wait, from saved months", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-first-call-disk-"));
  const warm = slowMetadataPortal(dir, 0);
  await directoryAssistanceReport(args, warm.soda, NOW, { answerWaitMs: 2_000 });
  // A new server (nothing in memory), the portal now slow on the metadata.
  const { soda } = slowMetadataPortal(dir, 600);
  const t0 = Date.now();
  const env = await directoryAssistanceReport(args, soda, NOW, { answerWaitMs: 250 });
  assert.ok(Date.now() - t0 < 400, `${Date.now() - t0} ms`);
  assert.equal(env.data.fiscal_year.complete, true);
});
