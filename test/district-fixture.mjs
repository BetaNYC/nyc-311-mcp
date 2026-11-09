// Shared by the district-tool tests: a BoardStat client over the fixture folder, no network.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BoardStatData } from "../dist/boardstat-data.js";

export const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "boardstat");
export const BASE = "https://www.beta.nyc/boardstat/data/";
export const MANIFEST = JSON.parse(await readFile(path.join(FIX, "manifest.json"), "utf8"));
export const EXPECTED = JSON.parse(await readFile(path.join(FIX, "expected.json"), "utf8"));

export async function fixtureData({ fetch, ...opts } = {}) {
  const requested = [];
  const serve = async (url) => {
    const u = String(url);
    if (!u.startsWith(BASE)) throw new Error(`request left beta.nyc/boardstat/data: ${u}`);
    const rel = u.slice(BASE.length);
    requested.push(rel);
    if (rel === "manifest.json") return Response.json(MANIFEST);
    const bytes = await readFile(path.join(FIX, ...rel.split("/"))).catch(() => null);
    return bytes ? new Response(bytes) : new Response("not found", { status: 404 });
  };
  const data = new BoardStatData({
    dataUrl: BASE,
    cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-tools-")),
    fetch: fetch ?? serve,
    logger: () => {},
    ...opts,
  });
  return { data, requested };
}

/** The values of `got` at the keys of `want`, lists by position, so a test compares only what the oracle computed. */
export function pick(got, want) {
  if (Array.isArray(want)) {
    const g = Array.isArray(got) ? got : [];
    return want.map((w, i) => pick(g[i], w)).concat(g.length > want.length ? [{ extra_rows: g.length - want.length }] : []);
  }
  if (want && typeof want === "object") {
    return Object.fromEntries(Object.keys(want).map((k) => [k, pick(got?.[k], want[k])]));
  }
  return got;
}
