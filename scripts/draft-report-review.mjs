// The #18 review: draft_311_report over the 20 common problem types and 10 harder cases
// (test/draft-review-set.mjs), against the recorded 311 content and the recorded
// cs9t-e3x8 rows. No network. Prints one JSON line per case and a Markdown table.
//   node scripts/draft-report-review.mjs
import { draftReport } from "../dist/draft-report.js";
import { redactZip } from "../dist/envelope.js";
import { fixtureContent } from "../test/content-fixture.mjs";
import { fixtureSla } from "../test/sla-fixture.mjs";
import { fixtureData } from "../test/district-fixture.mjs";
import { COMMON, TRICKY, EMERGENCY, MISSED } from "../test/draft-review-set.mjs";

const { client, missing } = await fixtureContent();
const { soda } = await fixtureSla();
const { data } = await fixtureData();
const rows = [];
for (const c of [...COMMON, ...TRICKY, ...EMERGENCY, MISSED]) {
  const out = await draftReport(c.args, client, soda, data);
  const r = out.reports;
  rows.push({
    id: c.id,
    input: redactZip(c.args.description + (c.args.location ? ` | ${c.args.location}` : "") + (c.args.borough ? ` | ${c.args.borough}` : "") + (c.args.when ? ` | ${c.args.when}` : "")),
    drafted: out.drafted,
    articles: r.map((x) => (x.report_at ? `${x.report_at.ka_number} ${x.report_at.title}` : x.status)).join(" + ") || (out.emergency ? "none: call 911" : out.first_line.startsWith("If anyone is in danger") ? "none: no article (911 first)" : "none"),
    placeholders: r.flatMap((x) => x.placeholders).join(" "),
    questions: r.reduce((n, x) => n + x.questions_to_ask.length, 0),
    detail_options: r.map((x) => (x.what?.problem_detail_options?.options.length ?? 0) + (x.what?.problem_detail_options?.more ?? 0)).join("+"),
    first_line: out.first_line,
    safety: out.safety_line && out.assistant_instruction ? "yes" : "NO",
  });
}
for (const r of rows) console.log(JSON.stringify(r));
console.log("\n| # | Input | Matched article | Placeholders | Questions | Detail options (2024) | Safety line + instruction |\n|---|---|---|---|---:|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.input.replace(/\|/g, "/")} | ${r.articles} | ${r.placeholders || "none"} | ${r.questions} | ${r.detail_options || "-"} | ${r.safety} |`);
if (missing.length) console.error("not recorded:", [...new Set(missing)].join(" "));
