// A Socrata client over the 311 Service Level Agreements dataset (cs9t-e3x8) as read
// live on 2026-11-07: its metadata (view.json) and, in rows.json, every row for the
// problem types the recorded 311 articles name (255 of 3,563). No network.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SodaClient } from "../dist/soda.js";

export const SLA_FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "soda", "cs9t-e3x8");

export async function fixtureSla(opts = {}) {
  const requests = [];
  let clock = opts.now ?? Date.parse("2026-11-07T12:00:00Z");
  const fetch =
    opts.fetch ??
    (async (u) => {
      const url = new URL(String(u));
      requests.push(url);
      if (url.host !== "data.cityofnewyork.us") throw new Error(`request left NYC Open Data: ${url.href}`);
      if (url.pathname === "/api/views/cs9t-e3x8.json") return new Response(await readFile(path.join(SLA_FIX, "view.json")));
      if (url.pathname === "/resource/cs9t-e3x8.json") return url.searchParams.get("$offset") === "0" ? new Response(await readFile(path.join(SLA_FIX, "rows.json"))) : Response.json([]);
      return new Response("not found", { status: 404 });
    });
  const soda = new SodaClient({
    fetch: async (u, i) => fetch(u, i),
    token: undefined,
    logger: () => {},
    minIntervalMs: 0,
    cacheDir: opts.cacheDir ?? (await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-sla-"))),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });
  return { soda, requests, advance: (ms) => (clock += ms) };
}
