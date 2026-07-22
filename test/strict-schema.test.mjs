import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOLS, callTool } from "../dist/tools.js";

// These tests never touch the live 311 API. A key is set so getApiKey() does not
// short-circuit, and fetch is stubbed so anything that escapes argument
// validation is served locally instead of reaching api.nyc.gov.
process.env.NYC_311_API_KEY = "test-key-never-sent-anywhere";
const STUB_BODY = { inEffect: false };
globalThis.fetch = async () =>
  new Response(JSON.stringify(STUB_BODY), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

test("every advertised tool schema rejects unknown parameters", () => {
  for (const tool of TOOLS) {
    assert.equal(
      tool.inputSchema.additionalProperties,
      false,
      `${tool.name}.inputSchema is missing additionalProperties: false`
    );
  }
});

test("get_status rejects an unknown parameter instead of silently dropping it", async () => {
  const result = await callTool("get_status", {
    type: "CodeBlue",
    bogus_unknown_param: "SHOULD_REJECT",
  });
  const text = result.content[0].text;
  assert.equal(result.isError, true, `expected an error, got: ${text}`);
  assert.match(text, /unrecognized|unknown|not permitted/i);
  // The message must name the offending key and the accepted ones.
  assert.match(text, /bogus_unknown_param/);
  assert.match(text, /\btype\b/);
});

test("get_status still answers a valid call", async () => {
  const result = await callTool("get_status", { type: "CodeBlue" });
  assert.notEqual(result.isError, true, result.content[0].text);
  assert.deepEqual(JSON.parse(result.content[0].text), STUB_BODY);
});

test("get_status still rejects a missing required type", async () => {
  const result = await callTool("get_status", {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /type/);
});
