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
