// #48: in server mode, stdout carries only MCP protocol (JSON-RPC, one message per line);
// anything else breaks the stdio transport. Diagnostics go to stderr. No network: the only
// tool called fails before any request (no NYC_311_API_KEY).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

test("every line the server writes to stdout is a JSON-RPC message", async () => {
  const env = { ...process.env };
  delete env.NYC_311_API_KEY;
  const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"], env });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", () => {});
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  const answered = (id) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${id}`)), 10_000);
      const look = () => {
        if (out.split("\n").some((l) => l.includes(`"id":${id}`))) {
          clearTimeout(timer);
          resolve();
        } else setTimeout(look, 20);
      };
      look();
    });
  send({ id: 1, method: "initialize", params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "0" } } });
  await answered(1);
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "tools/list" });
  await answered(2);
  send({ id: 3, method: "tools/call", params: { name: "get_status", arguments: { type: "CodeBlue" } } });
  await answered(3);
  send({ id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } });
  await answered(4);
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));

  const lines = out.split("\n").filter((l) => l !== "");
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    let m;
    assert.doesNotThrow(() => (m = JSON.parse(line)), `not JSON on stdout: ${line.slice(0, 200)}`);
    assert.equal(m.jsonrpc, "2.0", `not JSON-RPC on stdout: ${line.slice(0, 200)}`);
  }
});
