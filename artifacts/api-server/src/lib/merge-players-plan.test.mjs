import assert from "node:assert/strict";
import test from "node:test";
import { buildTournamentEvent } from "./tournament-native.ts";
import { combineCash, combineTournamentField, combinedSettlement } from "./merge-players-plan.ts";

const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const money = {
  buyIn: 20,
  topUp: 10,
  bounty: 5,
  winnerKeepsBounty: true,
  shares: { first: 50, second: 30, third: 20 },
};

const eventFor = (players) => buildTournamentEvent({
  id: "t",
  date: "2026-03-01",
  title: "Freezeout",
  venue: null,
  notes: null,
  startingStack: 0,
  ...money,
  players,
});

const nets = (event) => round(event.results.reduce((sum, result) => sum + result.netProfit, 0));

test("cash results add up, so the club total does not change", () => {
  const nights = [
    { name: "Pat", buyInCents: 2000, cashOutCents: 5000 },
    { name: "Patt", buyInCents: 1000, cashOutCents: 0 },
    { name: "Other", buyInCents: 1000, cashOutCents: 0 },
  ];
  const before = nights.reduce((sum, row) => sum + row.buyInCents - row.cashOutCents, 0);
  const combined = combineCash(nights[0], nights[1]);
  assert.deepEqual(combined, { buyInCents: 3000, cashOutCents: 5000 });
  const after = [combined, nights[2]].reduce((sum, row) => sum + row.buyInCents - row.cashOutCents, 0);
  assert.equal(after, before);
  assert.equal(combined.cashOutCents - combined.buyInCents, (5000 - 2000) + (0 - 1000));
});

test("a shared night stays settled only when both names were settled", () => {
  assert.equal(combinedSettlement(true, true), "keep");
  assert.equal(combinedSettlement(true, false), "clear");
  assert.equal(combinedSettlement(false, true), "clear");
  assert.equal(combinedSettlement(false, false), "clear");
});

test("combining a tournament keeps the money: club total, the other player, and the pair's net", () => {
  const players = [
    { name: "Pat", finishPlace: 1, entries: 1, topUp: false, freeEntry: false, knockouts: 1, payout: null },
    { name: "Patt", finishPlace: 2, entries: 2, topUp: true, freeEntry: false, knockouts: 1, payout: null },
    { name: "Other", finishPlace: 3, entries: 1, topUp: false, freeEntry: true, knockouts: 0, payout: null },
  ];
  const before = eventFor(players);
  const combined = combineTournamentField(players, money, "pat", "patt");
  assert.equal("error" in combined, false);
  const after = eventFor(combined.players);
  assert.equal(after.totalCollected, before.totalCollected);
  assert.equal(nets(after), nets(before));
  const other = (event) => event.results.find((result) => result.player === "Other").netProfit;
  assert.equal(other(after), other(before));
  const pair = before.results.filter((result) => result.player === "Pat" || result.player === "Patt").reduce((sum, result) => sum + result.netProfit, 0);
  assert.equal(after.results.find((result) => result.player === "Pat").netProfit, round(pair));
  assert.equal(after.results.some((result) => result.player === "Patt"), false);
});

test("two top-ups or two free entries in one tournament are refused", () => {
  const base = { entries: 1, knockouts: 0, payout: null, freeEntry: false, topUp: false };
  const topped = [
    { ...base, name: "Pat", finishPlace: 1, topUp: true },
    { ...base, name: "Patt", finishPlace: 2, topUp: true },
  ];
  assert.match(combineTournamentField(topped, money, "pat", "patt").error, /top-up/);
  const free = [
    { ...base, name: "Pat", finishPlace: 1, freeEntry: true },
    { ...base, name: "Patt", finishPlace: 2, freeEntry: true },
  ];
  assert.match(combineTournamentField(free, money, "pat", "patt").error, /free entry/);
});
