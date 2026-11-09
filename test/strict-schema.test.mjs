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

// #7, for every tool rather than one: a valid call plus one invented parameter
// must be refused. VALID_ARGS must name every tool, so a tool added later
// without an entry fails here instead of going untested.
const VALID_ARGS = {
  get_calendar: { date: "2026-07-04" },
  get_status: { type: "CodeBlue" },
  get_service_request: { sr_number: "311-17323508" },
  get_service_request_list: { sr_numbers: ["311-17323508"] },
};

test("VALID_ARGS covers every advertised tool", () => {
  assert.deepEqual(Object.keys(VALID_ARGS).sort(), TOOLS.map((t) => t.name).sort());
});

for (const [name, args] of Object.entries(VALID_ARGS)) {
  test(`${name} answers its valid call and rejects the same call plus an unknown parameter`, async () => {
    const ok = await callTool(name, args);
    assert.notEqual(ok.isError, true, ok.content[0].text);
    const bad = await callTool(name, { ...args, council_district: "10" });
    assert.equal(bad.isError, true, `${name} silently dropped council_district: ${bad.content[0].text}`);
    assert.match(bad.content[0].text, /council_district/);
  });
}
