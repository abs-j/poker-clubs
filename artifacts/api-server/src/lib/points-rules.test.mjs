import assert from "node:assert/strict";
import test from "node:test";
import { PRESETS, STANDARD_RULES, resolveRules, validateRules } from "./points-rules.ts";

test("every preset is itself a valid custom rule set", () => {
  for (const [id, preset] of Object.entries(PRESETS)) {
    const checked = validateRules(preset.rules);
    assert.ok("rules" in checked, `${id}: ${checked.error}`);
    assert.deepEqual(checked.rules, preset.rules);
  }
});

test("a preset resolves to its rules; unknown or broken input falls back to Standard", () => {
  assert.equal(resolveRules("social", null).rules, PRESETS.social.rules);
  assert.equal(resolveRules("nonsense", null).preset, "standard");
  assert.deepEqual(resolveRules("custom", { turnUp: 1 }), { preset: "standard", rules: STANDARD_RULES });
});

test("custom rules are bounds-checked with a message that names the field", () => {
  const bad = (change) => validateRules(change(JSON.parse(JSON.stringify(STANDARD_RULES))));
  assert.match(bad((r) => ((r.turnUp.cash = -1), r)).error, /Turn-up points \(cash\) must be between/);
  assert.match(bad((r) => ((r.win.flat = 1000), r)).error, /Win bonus must be between/);
  assert.match(bad((r) => ((r.minPlayersToCount = 2.5), r)).error, /whole number/);
  assert.match(bad((r) => ((r.perKnockout = "3"), r)).error, /must be a number/);
  assert.match(bad((r) => ((r.podium.third = 20), r)).error, /Third place/);
  assert.match(bad((r) => ((r.size.min = 1.5), r)).error, /Smallest table weighting must be between/);
  assert.match(validateRules(undefined).error, /must be a number/);
});

test("valid custom numbers are kept, rounded to two places", () => {
  const rules = JSON.parse(JSON.stringify(STANDARD_RULES));
  rules.win.perPlayer = 1.2345;
  const checked = validateRules(rules);
  assert.equal(checked.rules.win.perPlayer, 1.23);
  assert.deepEqual(resolveRules("custom", rules), { preset: "custom", rules: checked.rules });
});
