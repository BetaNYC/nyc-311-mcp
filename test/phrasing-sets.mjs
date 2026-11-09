// Every phrasing set from beta rounds 6 to 10, as [{ src, d, ok, danger }]: `ok` is the list of
// right articles (empty: no answer may be strong; null: an emergency, where 911 is what counts),
// `danger` true for an emergency, false for an ordinary complaint. Read from the round test files
// and test/fixtures/phrasings/, so the measurement covers exactly what the tests hold.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The array literal that follows `marker` in a test file (the files hold plain JSON-like data). */
function arrayAfter(file, marker) {
  const s = readFileSync(path.join(HERE, file), "utf8");
  const i = s.indexOf(marker);
  if (i < 0) throw new Error(`${marker} not found in ${file}`);
  const j = s.indexOf("[", i);
  let depth = 0;
  let k = j;
  for (; k < s.length; k++) {
    const c = s[k];
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
    else if (c === '"') for (k++; s[k] !== '"'; k++) if (s[k] === "\\") k++;
  }
  return new Function(`return ${s.slice(j, k + 1)}`)();
}

export function allPhrasings() {
  const out = [];
  const add = (src, d, ok, danger) => out.push({ src, d, ok, danger });
  for (const d of arrayAfter("how-to-report-beta-round6.test.mjs", "const PARK_RESTROOMS")) add("r6", d, ["KA-01060"], false);
  for (const c of arrayAfter("how-to-report-beta-round7.test.mjs", "const CASES = [")) add("r7", c.d, c.danger ? null : c.ok, !!c.danger);
  for (const [d, ka, , f] of arrayAfter("how-to-report-beta-round8.test.mjs", "const REPORT = [")) add("r8 report", d, f ? null : [ka], !!f);
  for (const c of arrayAfter("how-to-report-beta-round8.test.mjs", "const CASES = [")) add("r8", c.d, c.danger ? null : c.ok, !!c.danger);
  for (const [d, ka, , f] of arrayAfter("how-to-report-beta-round9.test.mjs", "const REPORT = [")) add("r9 report", d, f === "danger" ? null : [ka], f === "danger");
  for (const d of arrayAfter("how-to-report-beta-round9.test.mjs", "const NEVER_911 =")) add("r9 never 911", d, null, false);
  for (const d of arrayAfter("how-to-report-beta-round9.test.mjs", "const ALWAYS_911 =")) add("r9 always 911", d, null, true);
  for (const [d, ka, , f] of arrayAfter("how-to-report-beta-round9.test.mjs", "const STRESS = [")) add("r9", d, f === "danger" ? null : Array.isArray(ka) ? ka : [ka], f === "danger");
  for (const f of ["round10-report.json", "round10-stress.json", "round11.json"]) out.push(...JSON.parse(readFileSync(path.join(HERE, "fixtures", "phrasings", f), "utf8")));
  // One entry per description (the first wins).
  const seen = new Set();
  return out.filter((r) => !seen.has(r.d) && seen.add(r.d));
}
