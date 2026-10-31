import assert from "node:assert/strict";
import test from "node:test";
import { payoutCents, remainingJackpotCents } from "./jackpot.ts";

test("the running total is the surplus minus payouts", () => {
  assert.equal(remainingJackpotCents(400, 0), 400);
  assert.equal(remainingJackpotCents(400, 150), 250);
  assert.equal(remainingJackpotCents(400, 400), 0);
  assert.equal(remainingJackpotCents(0, 0), 0);
});

test("a payout has to be a positive amount that fits in what is left", () => {
  assert.deepEqual(payoutCents(1.5, 400), { cents: 150 });
  assert.deepEqual(payoutCents("4.50", 450), { cents: 450 });
  assert.deepEqual(payoutCents("4", 400), { cents: 400 });
  assert.deepEqual(payoutCents("$1.25", 200), { cents: 125 });
  assert.match(payoutCents(5, 400).error, /more than the jackpot/);
  assert.match(payoutCents("4.01", 400).error, /more than the jackpot/);
  assert.match(payoutCents(0, 400).error, /greater than zero/);
  assert.match(payoutCents(-2, 400).error, /greater than zero/);
  assert.match(payoutCents("abc", 400).error, /amount like 4/);
  assert.match(payoutCents("", 400).error, /greater than zero/);
  assert.match(payoutCents(1, 0).error, /empty/);
  assert.match(payoutCents(1, -50).error, /empty/);
  assert.equal("error" in payoutCents(null, 400), true);
});
