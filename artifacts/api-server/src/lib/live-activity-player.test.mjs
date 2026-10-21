import test from "node:test";
import assert from "node:assert/strict";
import { resolveAttributedPlayer } from "./live-activity-player.ts";

test("accepts a newly typed player name and normalizes its spacing", () => {
  assert.equal(resolveAttributedPlayer("  New   Player  ", "Member", ["Alex"]), "New Player");
});

test("uses the canonical roster name when the typed name matches an existing player", () => {
  assert.equal(resolveAttributedPlayer("alex smith", "Member", ["Alex Smith"]), "Alex Smith");
});

test("maps the authenticated member's own name back to the member identity", () => {
  assert.equal(resolveAttributedPlayer("  current   member ", "Current Member", ["Alex"]), "Current Member");
});

test("rejects a blank name or one longer than the supported limit", () => {
  assert.throws(() => resolveAttributedPlayer(" ", "Member", []), /player name/i);
  assert.throws(() => resolveAttributedPlayer("x".repeat(81), "Member", []), /player name/i);
});
