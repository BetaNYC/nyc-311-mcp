// Beta retest 11 (2026-11-09): eight emergencies happening now got no emergency block, because
// danger words will always miss some wording. Defense in depth: every how_to_report,
// list_311_categories and draft_311_report answer carries one fixed safety line, first in the
// text and in the structured output, whatever was or was not detected; a detected danger still
// leads with its 911 line as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callTool } from "../dist/tools.js";
import { SAFETY_LINE } from "../dist/emergency.js";
import { setContentClient } from "../dist/content-311.js";
import { setSodaClient } from "../dist/soda.js";
import { setBoardStatData } from "../dist/district-tools.js";
import { stressClient } from "./stress-client.mjs";
import { fixtureSla } from "./sla-fixture.mjs";
import { fixtureData } from "./district-fixture.mjs";

test("the safety line is short and says the tool can miss an emergency", () => {
  assert.match(SAFETY_LINE, /call 911/);
  assert.match(SAFETY_LINE, /can miss an emergency/);
  assert.ok(SAFETY_LINE.length <= 100, String(SAFETY_LINE.length));
});

test("every answer path starts with the safety line, in the text and the structured output", async (t) => {
  setContentClient(await stressClient());
  setSodaClient((await fixtureSla()).soda);
  setBoardStatData((await fixtureData()).data);
  t.after(() => {
    setContentClient(null);
    setSodaClient(null);
    setBoardStatData(null);
  });
  const calls = [
    ["how_to_report", { description: "a pothole on my block" }, "a match"],
    ["how_to_report", { description: "my neighbor's security light shines into my bedroom" }, "no match"],
    ["how_to_report", { description: "I smell gas in my kitchen" }, "a danger"],
    ["how_to_report", { description: "my neighbor keeps falling and now he isn't moving" }, "a danger"],
    ["how_to_report", { description: "loud music next door every night" }, "a recurring complaint"],
    ["list_311_categories", {}, "categories"],
    ["draft_311_report", { description: "a pothole on my block", location: "Broadway and W 96 St", borough: "Manhattan" }, "a draft"],
    ["draft_311_report", { description: "I smell gas in my kitchen" }, "no draft: a danger"],
    ["draft_311_report", { description: "my neighbor's security light shines into my bedroom" }, "no draft: no match"],
    ["how_to_report", { description: "x" }, "an argument error"],
    ["draft_311_report", {}, "an argument error"],
  ];
  for (const [name, args, what] of calls) {
    const r = await callTool(name, args);
    const text = r.content[0].text;
    assert.ok(text.startsWith(SAFETY_LINE), `${name}, ${what}: ${text.slice(0, 120)}`);
    if (!r.isError && name !== "list_311_categories") {
      const out = JSON.parse(text.slice(SAFETY_LINE.length));
      assert.equal(out.safety_line, SAFETY_LINE, `${name}, ${what}`);
      assert.equal(Object.keys(out)[0], "safety_line", `${name}, ${what}`);
    }
  }
});
