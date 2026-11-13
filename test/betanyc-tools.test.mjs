// whats_changed and about_betanyc, the two tools every BetaNYC MCP server carries
// (betanyc-ai-workspace platform/system/whats-changed-standard.md § 7). They read this repo's
// WHATS-CHANGED.md and never touch the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callTool, TOOLS, SHARED_TOOL_LINE } from "../dist/tools.js";
import { SHARED_MODULE_VERSION } from "../dist/betanyc-tools.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const whatsChanged = readFileSync(new URL("../WHATS-CHANGED.md", import.meta.url), "utf8");
const PAGE = "https://betanyc.github.io/nyc-311-mcp/whats-changed.html";
const REPO = "https://github.com/BetaNYC/nyc-311-mcp";
// Dated entries only: the tool leaves out an "## Unreleased:" entry (the version waiting for its tag).
const entryCount = (whatsChanged.match(/^## [0-9]{4}-[0-9]{2}-[0-9]{2}: /gm) ?? []).length;
const unreleased = (whatsChanged.match(/^## Unreleased: /gm) ?? []).length;

const textOf = (r) => r.content[0].text;

test("both shared tools are advertised, read-only, with an output schema", () => {
  for (const name of ["whats_changed", "about_betanyc"]) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, name);
    assert.equal(t.outputSchema.type, "object", name);
    assert.equal(t.annotations.readOnlyHint, true, name);
    assert.equal(t.inputSchema.additionalProperties, false, name);
  }
});

test("whats_changed answers from this repo's WHATS-CHANGED.md, with every entry valid", async () => {
  const r = await callTool("whats_changed", { limit: 50 });
  assert.notEqual(r.isError, true, textOf(r));
  const s = r.structuredContent;
  assert.deepEqual(s.server, { name: "nyc-311-mcp", version: pkg.version });
  assert.equal(s.source, PAGE);
  assert.equal(s.history_begins, "2026-06-21");
  assert.equal(s.total_matching, entryCount);
  assert.equal(s.returned, entryCount);
  if (unreleased) assert.match(s.note, /not released yet/, "the note says an unreleased entry is left out");
  else assert.equal(s.note, null, "no entry was left out for an error");
  assert.doesNotMatch(s.note ?? "", /error/, "no entry was left out for an error");
  for (const e of s.entries) {
    assert.ok(e.url.startsWith(`${PAGE}#${e.date}-`), e.url);
    for (const l of e.links) assert.match(l.url, /^https:\/\//, `${e.title}: ${l.url}`);
  }
  assert.ok(textOf(r).endsWith(`\n\n${SHARED_TOOL_LINE}`));
});

test("the version in package.json has its own MCP entry, dated or Unreleased (release protocol)", async () => {
  assert.ok(unreleased <= 1);
  assert.match(whatsChanged, new RegExp(`- \\*\\*MCP version:\\*\\* \\[nyc-311-mcp ${pkg.version.replace(/\./g, "\\.")}\\]`));
  const r = await callTool("whats_changed", { tag: "mcp", limit: 50 });
  assert.equal(r.structuredContent.filters.tag, "MCP", "any case is accepted; answers use the canonical spelling");
  assert.ok(r.structuredContent.returned >= 4);
});

test("whats_changed filters: Correction entries carry advice for people who used the old answers", async () => {
  const r = await callTool("whats_changed", { tag: "Correction" });
  assert.ok(r.structuredContent.returned >= 1);
  for (const e of r.structuredContent.entries) {
    assert.ok(e.tags.includes("Correction"));
    assert.ok(e.if_you_used_the_old_numbers, e.title);
  }
  const since = await callTool("whats_changed", { since: "2026-11-01" });
  for (const e of since.structuredContent.entries) assert.ok(e.date >= "2026-11-01", e.date);
});

test("whats_changed rejects bad arguments by name", async () => {
  for (const [args, re] of [
    [{ since: "last week" }, /since must be a real date/],
    [{ tag: "Parks" }, /tag must be one of/],
    [{ limit: 51 }, /limit must be a whole number from 1 to 50/],
    [{ council_district: 1 }, /does not accept 'council_district'/],
  ]) {
    const r = await callTool("whats_changed", args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(textOf(r), re);
    assert.ok(textOf(r).endsWith(`\n\n${SHARED_TOOL_LINE}`));
  }
});

test("about_betanyc names the server, its version, and where to report a problem", async () => {
  const r = await callTool("about_betanyc", {});
  assert.notEqual(r.isError, true, textOf(r));
  const s = r.structuredContent;
  assert.deepEqual(s.server, {
    name: "nyc-311-mcp",
    version: pkg.version,
    repository: REPO,
    shared_module_version: SHARED_MODULE_VERSION,
  });
  assert.equal(s.built_by, "BetaNYC, a project of the Fund for the City of New York");
  assert.deepEqual(s.bugs_and_requests, { issues: `${REPO}/issues`, new_issue: `${REPO}/issues/new` });
  assert.equal(s.whats_changed, PAGE);
  assert.ok(textOf(r).endsWith(`\n\n${SHARED_TOOL_LINE}`));
  const bad = await callTool("about_betanyc", { verbose: true });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /takes no parameters/);
});

test("over stdio, the SDK client accepts both answers against their output schemas", async () => {
  // Client.callTool validates structuredContent against the outputSchema from tools/list
  // and throws when it does not match, so this is the MCP contract checked end to end.
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], stderr: "ignore" });
  const client = new Client({ name: "betanyc-tools-test", version: "0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 23);
    const wc = await client.callTool({ name: "whats_changed", arguments: { limit: 3 } });
    assert.equal(wc.structuredContent.returned, 3);
    const about = await client.callTool({ name: "about_betanyc", arguments: {} });
    assert.equal(about.structuredContent.server.version, pkg.version);
  } finally {
    await client.close();
  }
});

test("WHATS-CHANGED.md ships in the npm package", () => {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8" });
  const files = JSON.parse(out)[0].files.map((f) => f.path);
  assert.ok(files.includes("WHATS-CHANGED.md"), files.join(", "));
  assert.ok(files.includes("dist/betanyc-tools.js"));
});
