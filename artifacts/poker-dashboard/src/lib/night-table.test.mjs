import assert from "node:assert/strict";
import test from "node:test";
import { nightTotals, remainingCents, suggestedJackpotCents } from "./night-table.ts";

const row = (name, buyIn, cashOut, adjustment = "") => ({ name, buyIn, cashOut, adjustment });

test("totals show cash in, cash out, adjustments and net, ignoring unnamed rows", () => {
  const rows = [row("Ann", "20", "15"), row("Bo", "20", "20"), row("", "99", "99")];
  assert.deepEqual(nightTotals(rows), { inCents: 4000, outCents: 3500, adjustmentCents: 0, netCents: -500 });
});

test("a surplus fills the jackpot and balances the night", () => {
  const rows = [row("Ann", "20", "15"), row("Bo", "20", "20")];
  assert.equal(suggestedJackpotCents(rows), 500);
  assert.equal(remainingCents(rows, 500), 0);
  assert.equal(remainingCents(rows, 0), -500);
});

test("a deficit needs negative adjustments, never a jackpot", () => {
  const short = [row("Ann", "20", "25"), row("Bo", "20", "17")];
  assert.equal(suggestedJackpotCents(short), 0);
  assert.equal(remainingCents(short, 0), 200);
  const covered = [row("Ann", "20", "25", "-2"), row("Bo", "20", "17")];
  assert.equal(remainingCents(covered, 0), 0);
});
