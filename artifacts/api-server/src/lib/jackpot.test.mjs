import assert from "node:assert/strict";
import test from "node:test";
import { jackpotFromCents, parsePayoutAmount, validateJackpotPayout } from "./jackpot.ts";

test("the pot is contributed surplus minus payouts", () => {
  const summary = jackpotFromCents(1200, 450, 2, [
    { id: 1, player: "Ann", amount: 4.5, at: "2026-10-31T00:00:00.000Z", by: "Bo" },
  ]);
  assert.equal(summary.contributed, 12);
  assert.equal(summary.paidOut, 4.5);
  assert.equal(summary.total, 7.5);
  assert.equal(summary.nights, 2);
  assert.equal(summary.payouts.length, 1);
});

test("a fully paid pot shows zero left", () => {
  const summary = jackpotFromCents(400, 400, 1, []);
  assert.equal(summary.total, 0);
  assert.equal(summary.contributed, 4);
  assert.equal(summary.paidOut, 4);
});

test("payout amounts parse from dollars and reject junk", () => {
  assert.equal(parsePayoutAmount(4), 400);
  assert.equal(parsePayoutAmount("4.50"), 450);
  assert.equal(parsePayoutAmount("$1,234.56"), 123456);
  assert.equal(parsePayoutAmount("abc"), null);
  assert.equal(parsePayoutAmount(""), null);
});

test("a payout must be positive and not more than what is left", () => {
  assert.equal(validateJackpotPayout(0, 500), "Enter an amount greater than zero.");
  assert.equal(validateJackpotPayout(-100, 500), "Enter an amount greater than zero.");
  assert.equal(validateJackpotPayout(600, 500), "That is more than the jackpot has left.");
  assert.equal(validateJackpotPayout(500, 500), null);
  assert.equal(validateJackpotPayout(1, 500), null);
});
