import assert from "node:assert/strict";
import test from "node:test";
import { buildTournamentEvent, validateTournament } from "./tournament-native.ts";

const base = () => ({
  date: "2026-10-04",
  title: "Friday Freezeout",
  buyIn: 20,
  shares: { first: 50, second: 30, third: 20 },
  players: [
    { name: "Ana", finishPlace: 1, entries: 1, knockouts: 2 },
    { name: "Bo", finishPlace: 2, entries: 2, knockouts: 1 },
    { name: "Cy", finishPlace: 3, entries: 1, knockouts: 0 },
    { name: "Di", finishPlace: 4, entries: 1, knockouts: 0 },
  ],
});
const build = (body) => {
  const checked = validateTournament(body, "t1");
  assert.ok("value" in checked, checked.error);
  return buildTournamentEvent(checked.value);
};

test("a freezeout pays the pool out by the shares, rebuys included", () => {
  const event = build(base());
  assert.equal(event.totalCollected, 100); // 5 entries x 20
  assert.equal(event.mainPrizePool, 100);
  assert.deepEqual(event.results.map((r) => [r.player, r.mainPrize]), [["Ana", 50], ["Bo", 30], ["Cy", 20], ["Di", 0]]);
  assert.equal(event.results[1].invested, 40);
  assert.equal(event.results[1].rebuys, 1);
  assert.equal(event.results[1].netProfit, -10);
  assert.equal(event.winner, "Ana");
  assert.equal(event.runnerUp, "Bo");
  assert.equal(event.dataCheck, "OK");
  assert.equal(event.entries, 5);
  assert.equal(event.format, "Freezeout");
});

test("results balance: net profit across the table adds up to zero", () => {
  const event = build(base());
  assert.equal(Math.round(event.results.reduce((sum, r) => sum + r.netProfit, 0) * 100) / 100, 0);
});

test("bounties are paid per knockout; what knockouts don't claim rolls into the prize pool", () => {
  const event = build({ ...base(), bounty: 5 });
  assert.equal(event.bountyPool, 15); // 3 knockouts x 5
  assert.equal(event.mainPrizePool, 85); // 100 collected - 15 paid in bounties
  assert.equal(event.dataCheck, "OK");
  assert.equal(event.format, "Bounty tournament");
  const ana = event.results.find((r) => r.player === "Ana");
  assert.equal(ana.bountiesWon, 10);
  assert.equal(ana.mainPrize, 42.5);
  assert.equal(ana.totalReturn, 52.5);
  assert.equal(event.topBountyHunter, "Ana");
  assert.equal(event.mostKnockouts, 2);
});

test("with fewer than three places the shares are re-split among those present", () => {
  const event = build({ ...base(), players: [{ name: "A", finishPlace: 1, entries: 1 }, { name: "B", finishPlace: 2, entries: 1 }] });
  assert.equal(event.mainPrizePool, 40);
  assert.deepEqual(event.results.map((r) => r.mainPrize), [25, 15]); // 50:30 re-split
  assert.equal(event.results.reduce((sum, r) => sum + r.mainPrize, 0), 40);
});

test("the pool always pays out to the cent, rounding crumbs go to first", () => {
  const event = build({ ...base(), buyIn: 10, shares: { first: 33, second: 33, third: 34 }, players: [
    { name: "A", finishPlace: 1, entries: 1 }, { name: "B", finishPlace: 2, entries: 1 }, { name: "C", finishPlace: 3, entries: 1 },
  ] });
  assert.equal(Math.round(event.results.reduce((sum, r) => sum + r.mainPrize, 0) * 100) / 100, 30);
});

test("entered payouts replace the shares entirely", () => {
  const body = base();
  body.players[0].payout = 70;
  body.players[1].payout = 30;
  const event = build(body);
  assert.deepEqual(event.results.map((r) => r.mainPrize), [70, 30, 0, 0]);
  assert.equal(event.dataCheck, "OK");
});

test("payouts that don't match the money collected are flagged, not hidden", () => {
  const body = base();
  body.players[0].payout = 90;
  const event = build(body);
  assert.match(event.dataCheck, /differ/);
});

test("a free entry costs nothing and a top-up adds its price", () => {
  const event = build({ ...base(), topUp: 10, players: [
    { name: "A", finishPlace: 1, entries: 1, freeEntry: true },
    { name: "B", finishPlace: 2, entries: 1, topUp: true },
    { name: "C", finishPlace: 3, entries: 1 },
  ] });
  assert.deepEqual(event.results.map((r) => [r.player, r.invested]), [["A", 0], ["B", 30], ["C", 20]]);
  assert.equal(event.freeEntries, 1);
  assert.equal(event.topUps, 1);
});

test("players without a recorded place are listed after those with one", () => {
  const event = build({ ...base(), players: [{ name: "A", entries: 1 }, { name: "B", finishPlace: 1, entries: 1 }, { name: "C", entries: 1 }] });
  assert.equal(event.results[0].player, "B");
  assert.equal(event.results[0].finishPlace, 1);
});

test("the form is checked with messages that say what to fix", () => {
  const err = (change) => validateTournament(change(base()), "t").error;
  assert.match(err((b) => ({ ...b, date: "someday" })), /date/);
  assert.match(err((b) => ({ ...b, players: [b.players[0]] })), /at least two/);
  assert.match(err((b) => ({ ...b, players: [b.players[0], { ...b.players[1], finishPlace: 1 }] })), /both finish 1/);
  assert.match(err((b) => ({ ...b, players: [b.players[0], { ...b.players[0] }] })), /listed twice/);
  assert.match(err((b) => ({ ...b, bounty: 50 })), /bounty can't be more/);
  assert.match(err((b) => ({ ...b, shares: { first: 60, second: 30, third: 30 } })), /more than 100%/);
  assert.match(err((b) => ({ ...b, buyIn: -5 })), /Buy-in must be/);
  assert.match(err((b) => ({ ...b, players: [{ ...b.players[0], entries: 0 }, b.players[1]] })), /entries must be/);
});
