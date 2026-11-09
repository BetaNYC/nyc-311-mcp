// Beta retest 10 (2026-11-09, home machine, 1.2.0-beta.10) FAILED on new phrasings: two ordinary
// complaints led with 911 and two wrong answers were rated strong.
//   - "black smoke pours out of the chimney of the building next door every morning" → Smoke or
//     Fumes, 911; "a man sleeps passed out on a bench in the park every night" → Medical
//     Emergency, 911. Cause: the danger words fired with no regard for a recurring condition.
//     Now RECURRING ("every morning", "always", "keeps ...ing") quiets the ambiguous dangers
//     (smoke, a crash, someone passed out or not moving, a theft or break-in that keeps
//     happening) unless something says it is happening now; fire, gas, carbon monoxide, not
//     breathing, bleeding and weapons are never quieted.
//   - "someone smashed the window of my parked car overnight and took my bag" → Illegal Parking;
//     "someone spray painted threats on the wall of my building" → Apartment Maintenance. Cause:
//     a problem entry fired on a word used as a modifier ("my parked car", "spray painted"). Now
//     "my parked car" names a car, a smashed car window is criminal mischief (the crime pointer,
//     no 911 line for something already over), and spray paint is graffiti.
// Measured on 458 phrasings (rounds 6 to 11): on beta.10, 9 wrong answers rated strong, 3 missed
// emergencies and 4 ordinary complaints leading with "Call 911"; now none. (Requiring the person's own words to appear in the
// article was measured too: at one word it dropped 81 right answers from strong, at two 229, and
// caught nothing more, so it is not used.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { howToReport } from "../dist/how-to-report.js";
import { assessDanger } from "../dist/emergency.js";
import { stressClient } from "./stress-client.mjs";

const client = await stressClient();
const ROUND11 = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "phrasings", "round11.json"), "utf8"));
const NOW = ROUND11.filter((r) => r.src === "r11 now");
const RECURRING = ROUND11.filter((r) => r.src === "r11 recurring");

test("20 pairs: the same danger word, happening now (911) and recurring (no 911)", () => {
  assert.equal(NOW.length, 20);
  assert.equal(RECURRING.length, 20);
});

for (const [i, r] of NOW.entries()) {
  test(`pair ${i + 1}, now: ${r.d}`, async () => {
    const out = await howToReport({ description: r.d }, client);
    assert.ok(out.emergency, `no 911: ${out.first_line}`);
    assert.match(out.first_line, /call 911/i);
  });
  const rec = RECURRING[i];
  test(`pair ${i + 1}, recurring: ${rec.d}`, async () => {
    const out = await howToReport({ description: rec.d }, client);
    assert.equal(out.emergency, null, `${rec.d}: ${out.first_line}`);
    assert.doesNotMatch(out.first_line, /^call 911/i);
    const top = out.best_match ?? out.alternatives?.[0] ?? null;
    if (!rec.ok.includes(top?.ka_number)) assert.doesNotMatch(out.best_match?.confidence ?? "", /^strong/, `${rec.d}: ${top?.title}`);
  });
}

for (const r of ROUND11.filter((x) => x.src === "r11 report" || x.src === "r11")) {
  test(`round 11 ${r.src}: ${r.d}`, async () => {
    const out = await howToReport({ description: r.d }, client);
    if (r.danger) {
      assert.ok(out.emergency, `no 911: ${out.first_line}`);
      return;
    }
    assert.equal(out.emergency, null, out.first_line);
    assert.doesNotMatch(out.first_line, /^call 911/i, out.first_line);
    const top = out.best_match ?? out.alternatives?.[0] ?? null;
    if (r.src === "r11 report") assert.ok(r.ok.includes(top?.ka_number), `${r.d}: ${top?.ka_number} ${top?.title}`);
    if (!r.ok.includes(top?.ka_number)) assert.doesNotMatch(out.best_match?.confidence ?? "", /^strong/, `${r.d}: ${top?.title}`);
  });
}

test("recurrence never quiets a clear danger, and is reported", () => {
  for (const d of ["I smell gas every morning in the hallway", "the building next door catches fire every winter and it is on fire now", "my neighbor collapsed and keeps having seizures", "a man passes out on the stoop every night and today he is not breathing"]) {
    assert.ok(assessDanger(d).kinds.length > 0, d);
  }
  const a = assessDanger("black smoke pours out of the chimney every morning");
  assert.equal(a.kinds.length, 0);
  assert.equal(a.recurring, true);
});

test("a stolen bag from a smashed car is a crime that is over: no 911 line, the crime pointer, and no parking article", async () => {
  const out = await howToReport({ description: "someone smashed the window of my parked car overnight and took my bag" }, client);
  assert.equal(out.emergency, null);
  assert.doesNotMatch(out.first_line, /^call 911/i);
  assert.ok(out.crime, "the crime pointer (precinct, Crime Stoppers)");
  assert.ok(![out.best_match, ...out.alternatives].some((a) => a && /parking|parked/i.test(a.title)));
});

test("alternatives: no parking article for a park, no unrelated 911 article under a danger", async () => {
  const swings = await howToReport({ description: "the swings in the park are broken" }, client);
  assert.ok(![swings.best_match, ...swings.alternatives].some((a) => a && /parking/i.test(a.title)), "park is not parking");
  const gun = await howToReport({ description: "a man is threatening people with a gun outside the deli" }, client);
  assert.ok(![gun.best_match, ...gun.alternatives].some((a) => a && /cannabis/i.test(a.title)));
});
