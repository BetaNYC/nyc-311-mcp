// Phase 0 follow-up (QA round 2 on #19): two failure modes of the cache under load.
// No network: a stub fetch serves the fixture folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoardStatData, buildKey } from "../dist/boardstat-data.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "boardstat");
const BASE = "https://www.beta.nyc/boardstat/data/";
const MANIFEST_A = JSON.parse(await readFile(path.join(FIX, "manifest.json"), "utf8"));
const MANIFEST_B = { ...MANIFEST_A, generated_at: "2026-11-08T10:36:39Z" };

/** A body that sends its bytes only after `ms`, so a download is still running meanwhile. */
function slowBody(bytes, ms) {
  return new ReadableStream({
    async start(controller) {
      await new Promise((r) => setTimeout(r, ms));
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

test("a newer build arriving mid-download does not prune the folder the download is writing to", async () => {
  let manifest = MANIFEST_A;
  const fetch = async (url) => {
    const rel = String(url).slice(BASE.length);
    if (rel === "manifest.json") return Response.json(manifest);
    const bytes = await readFile(path.join(FIX, ...rel.split("/")));
    return new Response(rel === "agg/month_type.parquet" ? slowBody(bytes, 150) : bytes);
  };
  const cacheDir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-race-"));
  const events = [];
  const data = new BoardStatData({ dataUrl: BASE, cacheDir, fetch, logger: (e, f) => events.push({ e, ...f }) });
  await data.manifest(); // build A is current and cached

  manifest = MANIFEST_B;
  const forced = data.manifest({ force: true }); // queued first: switches to B and prunes A
  const read = data.readParquet("agg/month_type.parquet", { columns: ["geo_kind", "n"] }); // still on A, downloads slowly
  const [, { rows, manifest: used }] = await Promise.all([forced, read]);

  assert.equal(used.manifest.generated_at, MANIFEST_A.generated_at, "the read finished on the build it started on");
  assert.ok(rows.length > 0);
  assert.ok(events.some((x) => x.e === "prune_deferred" && x.build === buildKey(MANIFEST_A.generated_at)), JSON.stringify(events));
  // Once the read is done, the old folder is removed after all.
  assert.ok(!(await readdir(path.join(cacheDir, "builds"))).includes(buildKey(MANIFEST_A.generated_at)), "build A was left behind");
});

test("a server that ignores the abort signal still cannot stall a download: the idle timer errors the stream", async () => {
  const fetch = async (url /* , init: the signal is deliberately ignored */) => {
    const rel = String(url).slice(BASE.length);
    if (rel === "manifest.json") return Response.json(MANIFEST_A);
    return new Response(new ReadableStream({ start() {} })); // never sends a byte, never closes
  };
  const cacheDir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-idle-"));
  const data = new BoardStatData({ dataUrl: BASE, cacheDir, fetch, logger: () => {}, fileTimeoutMs: 60 });
  const started = Date.now();
  await assert.rejects(data.file("boundaries/cd.geojson"), /sent nothing for 60 ms/);
  assert.ok(Date.now() - started < 5_000, "the download was not abandoned promptly");
  const dir = path.join(cacheDir, "builds", buildKey(MANIFEST_A.generated_at), "boundaries");
  assert.deepEqual(await readdir(dir).catch(() => []), [], "no .partial left behind");
});
