// The #17 review: the 20 most common 311 problem types citywide in BoardStat's
// month file (2025-11 to 2026-10), each as a resident might describe it. Prints
// the top match and whether the article's agency and problem type fit.
//   node scripts/how-to-report-review.mjs            # over the recorded responses
//   node scripts/how-to-report-review.mjs --live     # the live API (uses NYC_311_API_KEY; cached 7 days)
//   node scripts/how-to-report-review.mjs --live --seed   # live, but start from the recorded responses,
//                                                          # so only what was never recorded is fetched
import { REVIEW } from "../test/review-set.mjs";
import { howToReport } from "../dist/how-to-report.js";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContentClient, parseArticle, parseArticleList, parseCategories } from "../dist/content-311.js";
import { CONTENT, fixtureContent } from "../test/content-fixture.mjs";

/** A cache folder holding the recorded responses, as the client would have saved them. */
async function seededCache(recordedAt) {
  const dir = await mkdtemp(path.join(tmpdir(), "nyc-311-mcp-review-"));
  const put = async (key, value) => {
    const f = path.join(dir, ...key.split("/")) + ".json";
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, JSON.stringify({ fetched_at: recordedAt, value }));
  };
  const read = async (f) => JSON.parse(await readFile(path.join(CONTENT, f), "utf8"));
  await put("categories", parseCategories(await read("GetCategory.json")));
  for (const f of await readdir(path.join(CONTENT, "GetContentList"))) await put(`list/${f.slice(0, -5)}`, parseArticleList(await read(`GetContentList/${f}`)));
  for (const f of await readdir(path.join(CONTENT, "GetContent"))) await put(`article/${f.slice(0, -5)}`, parseArticle(await read(`GetContent/${f}`), f.slice(0, -5)));
  return dir;
}

const live = process.argv.includes("--live");
const fx = live ? null : await fixtureContent();
const client = live
  ? new ContentClient(process.argv.includes("--seed") ? { cacheDir: await seededCache(new Date().toISOString()) } : {})
  : fx.client;
const rows = [];
for (const r of REVIEW) {
  const out = await howToReport({ description: r.description }, client);
  const m = out.best_match;
  const problemOk = m ? m.problem_types.some((p) => p.toLowerCase() === r.complaint_type.toLowerCase()) : false;
  const articleOk = m?.ka_number === r.expect_ka;
  rows.push({ ...r, got: m ? `${m.ka_number} ${m.title}` : "(none)", agency: m?.agency ?? m?.agencies_named_in_text?.join("; ") ?? null, problem: m?.problem_type ?? null, problemOk, articleOk, second: out.alternatives[0]?.ka_number ?? null, first_line: out.first_line });
}
for (const r of rows) console.log(JSON.stringify(r));
console.error(`articles as expected: ${rows.filter((r) => r.articleOk).length}/${rows.length}; problem type named: ${rows.filter((r) => r.problemOk).length}/${rows.length}`);
if (fx?.missing.length) console.error("not recorded:", [...new Set(fx.missing)].join(" "));
if (live) console.error(`live requests: ${client.requests}`);
