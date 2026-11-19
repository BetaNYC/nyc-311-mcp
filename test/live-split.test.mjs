// #47: checks that call live services live in test/live/ and never run in `npm test` or CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const live = readdirSync(new URL("./live/", import.meta.url));

test("test/live/ holds the live checks", () => {
  assert.ok(live.includes("boardstat-live-check.mjs"));
  assert.ok(live.includes("run-call-center-report.mjs"));
});

test("no live check is named *.test.mjs, so no test glob can pick one up", () => {
  assert.deepEqual(live.filter((f) => /\.test\.m?js$/.test(f)), []);
});

test("the default test command does not reach test/live/", () => {
  assert.doesNotMatch(pkg.scripts.test, /live/);
  assert.match(pkg.scripts.test, /test\/\*\.test\.mjs/, "the test glob is one folder deep");
});

// #49 review: `npm pack` may run `prepare` (tsc) and rewrite dist/ while other files import it,
// so the pack checks run alone, after the main suite, from test/serial/.
test("the npm pack checks run alone, after the main suite, and nowhere else", () => {
  const serial = readdirSync(new URL("./serial/", import.meta.url));
  assert.deepEqual(serial, ["pack.test.mjs"]);
  const [main, ...rest] = pkg.scripts.test.split(" && node --test test/serial/");
  assert.deepEqual(rest, ["pack.test.mjs"], "the serial file runs in its own node --test, last");
  assert.doesNotMatch(main, /serial/, "the main command must not also run the serial file");
  assert.match(main, /node --test dist\/nyc-311\.test\.js test\/\*\.test\.mjs$/);
  for (const f of readdirSync(new URL("./", import.meta.url)).filter((f) => /\.test\.mjs$/.test(f))) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /["']pack["']/, `${f} runs npm pack inside the parallel suite`);
  }
});
