import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PACKAGE_VERSION } from "../dist/version.js";

// Beta test round 1 (2026-11-08): the beta reported 1.1.0, the released version, so a
// tester could not tell them apart. The server reports package.json's version.
test("the server reports package.json's version, and the beta's is a prerelease", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(PACKAGE_VERSION, pkg.version);
  assert.notEqual(pkg.version, "1.1.0");
});
