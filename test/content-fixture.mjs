// Shared by the how_to_report tests: a 311 content client over responses recorded
// from the live API on 2026-11-07 (test/fixtures/content/, ZIP codes replaced by
// 99999, no key). No network. A request with no recording is listed in `missing`
// and answered with an empty list, so a test can tell it was not covered.
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContentClient } from "../dist/content-311.js";

export const CONTENT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "content");
export const API = "https://api.nyc.gov/public/api";

export async function recorded(u) {
  const url = new URL(String(u));
  if (!url.href.startsWith(API + "/")) throw new Error(`request left the 311 API: ${url.href}`);
  const op = url.pathname.split("/").pop();
  const file =
    op === "GetCategory"
      ? "GetCategory.json"
      : op === "GetContentList"
        ? `GetContentList/${url.searchParams.get("categoryId")}.json`
        : op === "GetContent"
          ? `GetContent/${url.searchParams.get("SearchText")}.json`
          : null;
  if (!file) return null;
  return readFile(path.join(CONTENT, file), "utf8").then(JSON.parse, () => null);
}

export async function fixtureContent(opts = {}) {
  const missing = [];
  const seen = [];
  const fetch = async (u, init) => {
    seen.push({ url: String(u), headers: init?.headers });
    const body = await recorded(u);
    if (body) return Response.json(body);
    missing.push(String(u).slice(API.length));
    const op = new URL(String(u)).pathname.split("/").pop();
    return Response.json(op === "GetContentList" ? { ContentArticleList: [] } : { KnowledgeArticle: [] });
  };
  const client = new ContentClient({
    apiKey: () => "test-key-never-sent-anywhere",
    fetch,
    cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-content-")),
    minIntervalMs: 0,
    logger: () => {},
    ...opts,
  });
  return { client, missing, seen };
}
