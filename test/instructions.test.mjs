import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { SERVER_INSTRUCTIONS } from "../dist/instructions.js";

// The shared explanations moved out of the tool schemas into the server instructions.
// These tests make sure they are really sent, and that the district list is right.

function initialize() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("no initialize answer")); }, 10_000);
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        try {
          const m = JSON.parse(line);
          if (m.id === 1) { clearTimeout(timer); child.kill(); resolve(m.result); }
        } catch { /* partial line */ }
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } }) + "\n");
  });
}

test("initialize sends the server instructions", async () => {
  const result = await initialize();
  assert.equal(result.instructions, SERVER_INSTRUCTIONS);
});

test("the instructions keep the shared explanations the tool schemas point to", () => {
  for (const re of [/Manhattan 101-112/, /Staten Island 501-503/, /Joint Interest Areas/, /council_district is 1 to 51/, /fiscal year runs July 1 to June 30/, /last_days ends on the day of the newest request/, /not an official City report/, /reports, not problems/]) {
    assert.match(SERVER_INSTRUCTIONS, re);
  }
});

test("the Joint Interest Area list in the instructions matches BoardStat's manifest", () => {
  const m = JSON.parse(readFileSync(new URL("./fixtures/boardstat/manifest.json", import.meta.url)));
  const ids = m.districts.cd.filter((e) => e.jia).map((e) => Number(e.id));
  const listed = SERVER_INSTRUCTIONS.match(/outside every community district\): ([^.]+)\./)[1]
    .split(", ")
    .flatMap((x) => {
      const [a, b] = x.split("-").map(Number);
      return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
    });
  assert.deepEqual(listed.sort((a, b) => a - b), ids.sort((a, b) => a - b));
});
