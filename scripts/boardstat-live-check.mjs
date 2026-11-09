#!/usr/bin/env node
// Manual check, NOT part of `npm test` (the tests never touch the network):
// reads BoardStat's live published files through the same data layer the
// district tools will use, and prints what it found.
//
//   npm run build && node scripts/boardstat-live-check.mjs [cache-dir]
//
// Downloads about 17 MB from www.beta.nyc once (manifest, month aggregate,
// Manhattan CD 1 detail, the address list, both boundary files), one request at
// a time. A second run inside an hour downloads nothing.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BoardStatData, lookupAddress } from "../dist/boardstat-data.js";
import { districtEnvelope } from "../dist/envelope.js";

const cacheDir = process.argv[2] ?? (await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-live-")));
const data = new BoardStatData({ cacheDir });
const t0 = Date.now();

const { manifest } = await data.manifest();
console.log("manifest generated_at", manifest.generated_at, "window", manifest.window.start, "to", manifest.window.end);

const agg = await data.readParquet("agg/month_type.parquet");
const cd101 = agg.rows.filter((r) => r.geo_kind === "cd" && r.geo_id === "101" && r.year_month === "2026-10");
console.log("month_type rows", agg.rows.length, "columns", Object.keys(agg.rows[0]).join(","));
console.log("cd 101, 2026-10: requests", cd101.reduce((s, r) => s + r.n, 0), "in", cd101.length, "problem types");

const cols = await data.columns("detail/cd/101.parquet");
const open = await data.readParquet("detail/cd/101.parquet", {
  columns: ["unique_key", "created_date", "complaint_type", "status", "is_closed"],
  filter: { is_closed: { $eq: false } },
});
console.log("detail/cd/101 columns", cols.length, "(zip columns hidden:", !cols.some((c) => /zip/i.test(c)) + ")");
console.log("detail/cd/101 open requests", open.rows.length);

const addr = await data.readParquet("addresses.parquet", { columns: ["address", "cd", "cc", "borough", "n"], rowStart: 0, rowEnd: 1 });
console.log("addresses columns", Object.keys(addr.rows[0]).join(","));
const hit = await lookupAddress(data, "34 peck slip");
console.log("lookupAddress('34 peck slip')", JSON.stringify(hit.matches));

for (const kind of ["cd", "cc"]) {
  const { value } = await data.readJson(`boundaries/${kind}.geojson`);
  console.log(`boundaries/${kind}.geojson features`, value.features.length);
}

const env = districtEnvelope({ manifest: open.manifest, siteUrl: data.siteUrl, link: { geo: "cd", id: 101, status: "Open" }, data: { open: open.rows.length } });
console.log("envelope", JSON.stringify({ ...env, caveats: `${env.caveats.length} caveats` }));
console.log("cache", cacheDir, "elapsed_ms", Date.now() - t0);
