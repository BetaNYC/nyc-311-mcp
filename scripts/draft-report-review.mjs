// The #18 review: draft_311_report over the 20 common problem types and 10 harder cases
// (test/draft-review-set.mjs), against the recorded 311 content and the recorded
// cs9t-e3x8 rows. No network. Prints one JSON line per case and a Markdown table.
//   node scripts/draft-report-review.mjs
import { draftReport } from "../dist/draft-report.js";
import { redactZip } from "../dist/envelope.js";
import { fixtureContent } from "../test/content-fixture.mjs";
import { fixtureSla } from "../test/sla-fixture.mjs";
import { fixtureData } from "../test/district-fixture.mjs";
import { COMMON, TRICKY } from "../test/draft-review-set.mjs";

const { client, missing } = await fixtureContent();
const { soda } = await fixtureSla();
const { data } = await fixtureData();
const rows = [];
for (const c of [...COMMON, ...TRICKY]) {
  const out = await draftReport(c.args, client, soda, data);
  const r = out.reports;
  rows.push({
    id: c.id,
    input: redactZip(c.args.description + (c.args.location ? ` | ${c.args.location}` : "") + (c.args.borough ? ` | ${c.args.borough}` : "") + (c.args.when ? ` | ${c.args.when}` : "")),
    drafted: out.drafted,
    articles: r.map((x) => (x.report_at ? `${x.report_at.ka_number} ${x.report_at.title}` : x.status)).join(" + ") || (out.emergency ? "none: call 911" : "none"),
    placeholders: r.flatMap((x) => x.placeholders).join(" "),
    questions: r.reduce((n, x) => n + x.questions_to_ask.length, 0),
    detail_options: r.map((x) => (x.what?.problem_detail_options?.options.length ?? 0) + (x.what?.problem_detail_options?.more ?? 0)).join("+"),
    first_line: out.first_line,
  });
}
for (const r of rows) console.log(JSON.stringify(r));
console.log("\n| # | Input | Matched article | Placeholders | Questions | Detail options (2024) |\n|---|---|---|---|---:|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.input.replace(/\|/g, "/")} | ${r.articles} | ${r.placeholders || "none"} | ${r.questions} | ${r.detail_options || "-"} |`);
if (missing.length) console.error("not recorded:", [...new Set(missing)].join(" "));
