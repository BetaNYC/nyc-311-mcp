import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// The server must stop when the app closes stdin, even if background work is pending
// (beta round 5: fiscal-year 411 months keep loading after the answer).
test("server exits soon after stdin closes", async () => {
  const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise((r) => setTimeout(r, 300));
  const started = Date.now();
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("still running 3 s after stdin closed")); }, 3_000);
    child.on("exit", (c) => { clearTimeout(timer); resolve(c); });
    child.stdin.end();
  });
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 3_000);
});
