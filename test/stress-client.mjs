// A 311 content client for the stress sets (rounds 7 and 8): the recorded responses
// (test/fixtures/content/), and for an article never recorded in full, its own summary from the
// recorded category lists (title and description, no sections). Ranking and confidence read
// only the summary, so the article and confidence are the same as with the full text; only its
// report options and agency are missing. No network.
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentClient } from "../dist/content-311.js";
import { CONTENT, recorded } from "./content-fixture.mjs";

export async function stressClient() {
  const lists = path.join(CONTENT, "GetContentList");
  const summaries = new Map();
  for (const f of await readdir(lists)) for (const a of JSON.parse(await readFile(path.join(lists, f), "utf8")).ContentArticleList ?? []) summaries.set(a.id, a);
  return new ContentClient({
    apiKey: () => "test-key-never-sent-anywhere",
    cacheDir: await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-stress-")),
    minIntervalMs: 0,
    logger: () => {},
    fetch: async (u) => {
      const body = await recorded(u);
      if (body) return Response.json(body);
      const url = new URL(String(u));
      const op = url.pathname.split("/").pop();
      const s = op === "GetContent" ? summaries.get(url.searchParams.get("SearchText")) : null;
      if (s) return Response.json({ KnowledgeArticle: [{ ArticlePublicNumber: s.id, Title: s.title, Description: s.description, Section: [] }] });
      return Response.json(op === "GetContentList" ? { ContentArticleList: [] } : { KnowledgeArticle: [] });
    },
  });
}
