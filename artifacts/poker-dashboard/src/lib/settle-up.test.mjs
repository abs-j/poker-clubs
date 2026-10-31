import assert from "node:assert/strict";
import test from "node:test";
import { settleBadge, settleLineText, settleTotalText } from "./settle-up.ts";

test("a loser owes the bank and a winner is owed by it", () => {
  assert.equal(settleLineText({ name: "Ben", netCents: -1500 }, "Ann"), "Owes $15.00 to Ann");
  assert.equal(settleLineText({ name: "Cat", netCents: 2550 }, "Ann"), "Is owed $25.50 by Ann");
});

test("without a bank, or for the bank themselves, no one is named", () => {
  assert.equal(settleLineText({ name: "Ben", netCents: -1500 }, null), "Owes $15.00");
  assert.equal(settleLineText({ name: " ann ", netCents: 2500 }, "Ann"), "Is owed $25.00");
  assert.equal(settleLineText({ name: "Dan", netCents: 0 }, "Ann"), "Even");
});

test("the Games label shows what is left, and nothing when no one owes", () => {
  assert.equal(settleBadge("none", 0), null);
  assert.equal(settleBadge("open", 3), "3 to settle");
  assert.equal(settleBadge("partial", 1), "1 to settle");
  assert.equal(settleBadge("settled", 0), "Settled");
  assert.equal(settleTotalText(-4050), "$40.50");
});
