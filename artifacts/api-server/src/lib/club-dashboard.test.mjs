import assert from "node:assert/strict";
import test from "node:test";
import { buildClubDashboard } from "./club-dashboard.ts";

const nights = [
  { date: "2026-02-20", players: [{ name: "Sam", buyIn: 20, cashOut: 50 }, { name: "Al", buyIn: 20, cashOut: 0 }, { name: "Bo", buyIn: 10, cashOut: 0 }] },
  { date: "2026-01-10", players: [{ name: "Sam", buyIn: 10, cashOut: 0 }, { name: "al", buyIn: 10, cashOut: 20 }] },
  { date: "2026-04-03", players: [{ name: "Bo", buyIn: 10, cashOut: 30 }, { name: "Sam", buyIn: 20, cashOut: 0 }] },
];

test("nights are numbered by date, whatever order they arrive in", () => {
  const dashboard = buildClubDashboard({ title: "T", nights });
  assert.deepEqual(dashboard.sessions.map((s) => [s.sessionNumber, s.date, s.month]), [[1, "2026-01-10", "01"], [2, "2026-02-20", "02"], [3, "2026-04-03", "04"]]);
  assert.equal(dashboard.totals.latestGameDate, "2026-04-03");
  assert.equal(dashboard.totals.totalSessions, 3);
});

test("standings merge names that differ only by case and rank by profit", () => {
  const { leaderboard } = buildClubDashboard({ title: "T", nights });
  // "al" and "Al" are one person; the first spelling seen (oldest night) is kept.
  assert.deepEqual(leaderboard.map((p) => [p.rank, p.name, p.profitTotal, p.gamesPlayed]), [
    [1, "Bo", 10, 2],
    [2, "Sam", 0, 3],
    [3, "al", -10, 2],
  ]);
});

test("standing maths", () => {
  const sam = buildClubDashboard({ title: "T", nights }).leaderboard.find((p) => p.name === "Sam");
  assert.equal(sam.buyInTotal, 50);
  assert.equal(sam.cashOutTotal, 50);
  assert.equal(sam.gamesPlayed, 3);
  assert.equal(sam.positiveSessionPct, 33.33);
  assert.equal(sam.netPct, 0);
  assert.equal(sam.maxWin, 30);
  assert.equal(sam.maxLoss, -20);
});

test("January and February are not dropped, quarters cover them", () => {
  const { months, quarters } = buildClubDashboard({ title: "T", nights });
  assert.deepEqual(months.map((m) => m.month), ["01", "02", "04"]);
  assert.deepEqual(quarters.map((q) => [q.quarter, q.sessionCount]), [["Q1", 2], ["Q2", 1]]);
  assert.equal(months[1].range, "February 1 — February 28");
});

test("nights balance and totals add up", () => {
  const { totals } = buildClubDashboard({ title: "T", nights });
  assert.equal(totals.totalBuyIn, 100);
  assert.equal(totals.totalCashOut, 100);
  assert.equal(totals.balanceStatus, "balanced");
  assert.equal(totals.activePlayers, 3);
});

test("cumulative profit carries forward for people who skip a night", () => {
  const { playerProfitHistory } = buildClubDashboard({ title: "T", nights });
  const bo = playerProfitHistory.filter((p) => p.player === "Bo").map((p) => [p.sessionNumber, p.cumulativeProfit]);
  // Bo first plays on night 2 and again on night 3.
  assert.deepEqual(bo, [[2, -10], [3, 10]]);
  const sam = playerProfitHistory.filter((p) => p.player === "Sam").map((p) => [p.sessionNumber, p.cumulativeProfit]);
  assert.deepEqual(sam, [[1, -10], [2, 20], [3, 0]]);
});

test("a club with no nights gets an empty but complete payload", () => {
  const dashboard = buildClubDashboard({ title: "New", nights: [] });
  assert.equal(dashboard.totals.latestSession, null);
  assert.deepEqual([dashboard.leaderboard, dashboard.sessions, dashboard.months, dashboard.quarters, dashboard.tournaments], [[], [], [], [], []]);
  assert.equal(dashboard.defaultPlayer, null);
});

test("tournaments ride along in the payload and feed the tournament snapshot", () => {
  const event = {
    id: "club-1", date: "2026-03-05", title: "Freezeout", status: "Completed", format: "Freezeout", startTime: null, venue: null,
    buyIn: 20, topUp: 0, bounty: 0, bountyBasis: null, startingStack: 0, topUpStack: 0, shares: { first: 50, second: 30, third: 20 },
    players: 2, entries: 2, rebuys: 0, topUps: 0, freeEntries: 0, knockouts: 0, totalCollected: 40, bountyPool: 0, mainPrizePool: 40,
    winner: "Sam", runnerUp: "Al", thirdPlace: null, winnerPrize: 25, topBountyHunter: null, mostKnockouts: 0, notes: null, dataCheck: "OK",
    results: [
      { player: "Sam", entries: 1, rebuys: 0, topUp: false, freeEntry: false, finishPlace: 1, knockouts: 0, eliminatedBy: null, invested: 20, bountiesWon: 0, mainPrize: 25, totalReturn: 25, netProfit: 5, inTheMoney: true },
      { player: "Al", entries: 1, rebuys: 0, topUp: false, freeEntry: false, finishPlace: 2, knockouts: 0, eliminatedBy: null, invested: 20, bountiesWon: 0, mainPrize: 15, totalReturn: 15, netProfit: -5, inTheMoney: true },
    ],
  };
  const dashboard = buildClubDashboard({ title: "T", nights: [], tournaments: [event] });
  assert.equal(dashboard.tournaments.length, 1);
  assert.equal(dashboard.tournamentSnapshot.available, true);
  assert.deepEqual(dashboard.tournamentSnapshot.players.map((p) => [p.player, p.netProfit]), [["Sam", 5], ["Al", -5]]);
  assert.equal(buildClubDashboard({ title: "T", nights: [] }).tournamentSnapshot.available, false);
});
