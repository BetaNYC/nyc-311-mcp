// Beta test round 1 (2026-11-08): argument errors came back as raw zod JSON. Each now says,
// in a sentence, what was wrong and how to fix it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../dist/tools.js";
import { SAFETY_LINE } from "../dist/emergency.js";

async function err(name, args) {
  let fetched = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; throw new Error("no network in tests"); };
  try {
    const r = await callTool(name, args);
    assert.equal(r.isError, true, `${name} should fail`);
    return { text: r.content[0].text, fetched };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const NOT_RAW = (t) => {
  assert.doesNotMatch(t, /"code"\s*:|"path"\s*:|invalid_type|invalid_enum_value|too_big|too_small|invalid_union|ZodError|\[\s*\{/, t);
  // The error itself stays short; the closing text (SAFETY_LINE) follows it as the last line.
  const message = t.endsWith(SAFETY_LINE) ? t.slice(0, -SAFETY_LINE.length).trim() : t;
  assert.ok(message.length < 400, `short: ${message.length} chars`);
};

const CASES = [
  ["get_status", { type: "Hurricane" }, /'type' must be one of: CodeBlue, FireHydrant, OEM, SnowOnSidewalk, SnowOnStreet/],
  ["get_status", {}, /'type' is required/],
  ["how_to_report", { description: "" }, /'description' needs at least 3 characters/],
  ["draft_311_report", { description: "" }, /'description' needs at least 3 characters/],
  ["top_problems", { community_district: 309, last_days: 30, limit: 100000 }, /'limit' can be at most 100/],
  ["find_requests", { community_district: 309, last_days: 30, limit: 5000 }, /'limit' can be at most 200/],
  ["find_district", { address: "" }, /'address' cannot be empty/],
  ["address_history", { address: "", last_days: 30 }, /'address' cannot be empty/],
  ["cb_monthly_list", { month: "2026-10" }, /'community_district' is required/],
  ["top_problems", { community_district: 309, last_days: "thirty" }, /'last_days' should be a whole number/],
  ["get_service_request_list", { sr_numbers: [] }, /at least one 311 number/],
];

for (const [name, args, re] of CASES) {
  test(`${name} ${JSON.stringify(args)}: a plain sentence`, async () => {
    const { text } = await err(name, args);
    assert.match(text, re);
    NOT_RAW(text);
  });
}

test("the reporting tools end argument errors with the safety line", async () => {
  for (const name of ["how_to_report", "draft_311_report"]) {
    const { text } = await err(name, { description: "" });
    assert.ok(text.endsWith(`\n\n${SAFETY_LINE}`), text);
    assert.equal(text.split(SAFETY_LINE).length, 2, "once");
  }
});

test("an empty sr_numbers list is refused here and never sent to the City", async () => {
  process.env.NYC_311_API_KEY ??= "test-key-never-sent";
  const { fetched } = await err("get_service_request_list", { sr_numbers: [] });
  assert.equal(fetched, false);
});
