import assert from "node:assert/strict";
import test from "node:test";
import { checkResolution, gapOf, parseResolution, resolveBalance } from "./night-balance.ts";

const p = (name, buyIn, cashOut) => ({ name, buyInCents: buyIn, cashOutCents: cashOut });
const over = () => [p("Ann", 2000, 1500), p("Bo", 2000, 2000)]; // $5 left on the table
const under = () => [p("Ann", 2000, 2500), p("Bo", 2000, 1700), p("Cy", 2000, 2000)]; // $2 too much paid out

test("the gap says which way the night is out", () => {
  assert.deepEqual(gapOf(over()), { direction: "over", cents: 500 });
  assert.deepEqual(gapOf(under()), { direction: "under", cents: 200 });
  assert.deepEqual(gapOf([p("Ann", 1000, 1000)]), { direction: "balanced", cents: 0 });
});

test("a surplus goes to the jackpot and the players are untouched", () => {
  const out = resolveBalance(over(), { mode: "jackpot" });
  assert.equal(out.jackpotCents, 500);
  assert.equal(out.remainingCents, 0);
  assert.deepEqual(out.players, over());
});

test("a shortfall can come off one player", () => {
  const out = resolveBalance(under(), { mode: "player", name: " ann " });
  assert.deepEqual(out.deductions, [{ name: "Ann", cents: 200 }]);
  assert.equal(out.players[0].cashOutCents, 2300);
  assert.equal(out.remainingCents, 0);
  assert.equal(gapOf(out.players).direction, "balanced");
});

test("a shortfall can be shared, with odd cents going to the first players", () => {
  const out = resolveBalance([p("Ann", 1000, 1300), p("Bo", 1000, 1000), p("Cy", 1000, 701)], { mode: "split" });
  assert.equal(out.deductions.reduce((sum, row) => sum + row.cents, 0), 1);
  assert.equal(out.remainingCents, 0);
  const evenly = resolveBalance([p("Ann", 1000, 1301), p("Bo", 1000, 1000), p("Cy", 1000, 1000)], { mode: "split" });
  assert.equal(evenly.remainingCents, 0);
  assert.equal(gapOf(evenly.players).direction, "balanced");
});

test("sharing never takes more than a player cashed out", () => {
  const out = resolveBalance([p("Ann", 1000, 50), p("Bo", 1000, 3000), p("Cy", 1000, 0)], { mode: "split" });
  // total buy-in 3000, cash-out 3050: out by 50, shared between Ann and Bo, 25 each
  assert.deepEqual(out.deductions, [{ name: "Ann", cents: 25 }, { name: "Bo", cents: 25 }]);
  const tiny = resolveBalance([p("Ann", 100, 10), p("Bo", 100, 300)], { mode: "split" });
  assert.ok(tiny.players.every((player) => player.cashOutCents >= 0));
});

test("a choice that no longer fits the gap does nothing", () => {
  assert.equal(resolveBalance(under(), { mode: "jackpot" }).jackpotCents, 0);
  assert.equal(resolveBalance(over(), { mode: "split" }).remainingCents, 500);
  assert.equal(resolveBalance(over(), null).remainingCents, 500);
  assert.equal(resolveBalance(over(), { mode: "none" }).remainingCents, 500);
  assert.equal(resolveBalance([p("Ann", 1000, 1000)], { mode: "jackpot" }).jackpotCents, 0);
});

test("a choice is checked against tonight's ledger before it is saved", () => {
  assert.equal(checkResolution(over(), { mode: "jackpot" }), null);
  assert.match(checkResolution(under(), { mode: "jackpot" }), /surplus/);
  assert.match(checkResolution(over(), { mode: "split" }), /shortfall/);
  assert.match(checkResolution(under(), { mode: "player", name: "Zed" }), /Choose a player/);
  assert.match(checkResolution([p("Ann", 100, 50), p("Bo", 1000, 1350)], { mode: "player", name: "Ann" }), /cashed out less/);
  assert.equal(checkResolution(under(), { mode: "player", name: "Ann" }), null);
  assert.equal(checkResolution(over(), { mode: "none" }), null);
  assert.match(checkResolution([p("Ann", 1000, 1000)], { mode: "jackpot" }), /already balanced/);
});

test("submitted choices are read strictly", () => {
  assert.deepEqual(parseResolution({ mode: "jackpot", extra: 1 }), { mode: "jackpot" });
  assert.deepEqual(parseResolution({ mode: "player", name: " Ann " }), { mode: "player", name: "Ann" });
  assert.equal(parseResolution({ mode: "player" }), null);
  assert.equal(parseResolution({ mode: "steal" }), null);
  assert.equal(parseResolution("jackpot"), null);
});
