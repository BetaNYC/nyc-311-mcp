// What ships in the npm package. These checks run `npm pack --dry-run`, and on some npm versions
// (CI's, on Node 18, 20 and 22) `prepare` still runs despite --ignore-scripts, so tsc rewrites
// dist/ while other test files are importing it ("unexpected EOF", #49 review). So they live
// here, outside the one-folder-deep test/*.test.mjs glob, and `npm test` runs this file by
// itself after the main suite has finished. test/live-split.test.mjs keeps it that way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DS_TEXT = readFileSync(new URL("../../DATA-SOURCES.json", import.meta.url), "utf8");
const packed = () =>
  JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" }))[0].files.map((f) => f.path);

test("WHATS-CHANGED.md, DATA-SOURCES.json, data.json and the shared module ship in the npm package", () => {
  const files = packed();
  for (const f of ["DATA-SOURCES.json", "data.json", "WHATS-CHANGED.md", "dist/betanyc-tools.js"]) assert.ok(files.includes(f), `${f}: ${files.join(", ")}`);
  assert.ok(!files.includes("croissant.json"), "this repo publishes no data files of its own");
});

test("the website copy of data.json matches, and only with a real contact", () => {
  // GitHub Pages serves docs/ from main, so a docs/data.json would publish the placeholder.
  const site = new URL("../../docs/data.json", import.meta.url);
  if (DS_TEXT.includes("contact-not-yet-named@example.invalid")) {
    assert.equal(existsSync(site), false, "docs/data.json would publish the placeholder contact");
  } else {
    assert.equal(readFileSync(site, "utf8"), readFileSync(new URL("../../data.json", import.meta.url), "utf8"), "docs/data.json must match data.json");
  }
});

// Nothing that is only for development ships (#49, post-merge check): no compiled test files
// (src/nyc-311.test.ts builds to dist/ because npm test runs it from there), no tests, no
// eval, no env files, no Python caches, no Finder files. And everything `files` promises does.
const FORBIDDEN = [
  [/\.test\./, "a test file"],
  [/(^|\/)test\//, "the test folder"],
  [/(^|\/)eval\//, "the eval folder"],
  [/(^|\/)\.env/, "an env file"],
  [/(^|\/)__pycache__(\/|$)/, "a Python cache"],
  [/\.pyc$/, "a Python cache file"],
  [/(^|\/)\.DS_Store$/, "a Finder file"],
];

test("the package ships no test, eval, env, cache or Finder files", () => {
  const files = packed();
  const bad = files.flatMap((f) => FORBIDDEN.filter(([re]) => re.test(f)).map(([, why]) => `${f} (${why})`));
  assert.deepEqual(bad, [], `should not ship: ${bad.join(", ")}`);
});

test("the package ships dist/, WHATS-CHANGED.md and everything package.json `files` promises", () => {
  const files = packed();
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.ok(files.includes("dist/index.js"), "dist/index.js (the server) is missing");
  assert.ok(files.includes("WHATS-CHANGED.md"));
  for (const entry of pkg.files.filter((e) => !e.startsWith("!"))) {
    const found = files.some((f) => f === entry || f.startsWith(`${entry.replace(/\/$/, "")}/`));
    assert.ok(found, `package.json files promises ${entry}, but the package has nothing for it`);
  }
});
