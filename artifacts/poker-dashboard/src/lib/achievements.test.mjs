import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBadges,
  buildBuzz,
  buildFormDots,
  buildSharedGames,
  buildSeason,
  monthKey,
} from "./achievements.ts";

const rec = (player, net) => ({ player, buyIn: 10, cashOut: 10 + net, net, status: null });
const game = (n, date, players) => ({
  sessionNumber: n,
  date,
  totalBuyIn: players.length * 10,
  playerCount: players.length,
  winner: null,
  winnerProfit: 0,
  players,
});

const sessions = [
  game(1, "2026-07-03", [rec("Ana", 30), rec("Ben", -10), rec("Cy", -20)]),
  game(2, "2026-07-17", [rec("Ana", 10), rec("Ben", -5), rec("Cy", -5)]),
  game(3, "2026-10-02", [rec("Ana", -20), rec("Ben", 15), rec("Cy", 5), rec("Bad Beat Jackpot", 0)]),
  game(4, "2026-10-09", [rec("Ana", -5), rec("Ben", 10), rec("Cy", -5)]),
  game(5, "2026-10-16", [rec("Ana", 5), rec("Ben", 20), rec("Cy", -25)]),
];

test("form dots list the last games oldest first", () => {
  const dots = buildFormDots(sessions, "ben", 3);
  assert.deepEqual(dots.map((dot) => dot.result), ["win", "win", "win"]);
  const ana = buildFormDots(sessions, "Ana", 5).map((dot) => dot.result);
  assert.deepEqual(ana, ["win", "win", "loss", "loss", "win"]);
});

test("seasons are calendar months", () => {
  assert.equal(monthKey("2026-07-03"), "2026-07");
  assert.equal(monthKey("2026-12-31"), "2026-12");
  assert.equal(monthKey("2027-01-01"), "2027-01");
});

test("heater needs three wins in a row to the latest game", () => {
  const badges = buildBadges(sessions);
  assert.ok(!badges.get("ana")?.some((badge) => badge.id === "heater"));
  const ben = buildBadges([
    ...sessions,
    game(6, "2026-10-23", [rec("Ana", -5), rec("Ben", 5), rec("Cy", 0)]),
  ]).get("ben");
  const heater = ben.find((badge) => badge.id === "heater");
  assert.equal(heater.reason, "4 wins in a row");
});

test("iron player and big night go to the right people, jackpot row ignored", () => {
  const badges = buildBadges(sessions);
  const ids = (key) => (badges.get(key) ?? []).map((badge) => badge.id);
  assert.ok(ids("ana").includes("iron-player"));
  assert.ok(ids("ben").includes("iron-player"));
  assert.ok(ids("ana").includes("big-night"));
  assert.ok(!badges.has("bad beat jackpot"));
});

test("comeback picks the biggest losing-to-winning swing", () => {
  const badges = buildBadges(sessions);
  // Cy: -5 then +5 is a swing of 10. Ben: -5 then +15 is a swing of 20.
  assert.ok(badges.get("ben").some((badge) => badge.id === "comeback"));
  assert.ok(!(badges.get("cy") ?? []).some((badge) => badge.id === "comeback"));
});

test("giant killer is given for beating the all-time leader on the night", () => {
  const badges = buildBadges(sessions);
  // Going into game 3 Ana leads. Ben won the night and beat her.
  assert.ok(badges.get("ben").some((badge) => badge.id === "giant-killer"));
});

test("season is the month of the latest game", () => {
  const season = buildSeason(sessions);
  assert.equal(season.label, "Oct 2026");
  assert.equal(season.games, 3);
  assert.equal(season.leader.name, "Ben");
  assert.equal(season.leader.net, 45);
  assert.equal(season.mostWins.name, "Ben");
  assert.equal(season.mostWins.wins, 3);
  assert.equal(season.lead, 65);
  assert.equal(season.closed, false);
  const earlier = buildSeason(sessions, "2026-07");
  assert.equal(earlier.closed, true);
  assert.equal(earlier.leader.name, "Ana");
});

test("buzz leads with a new money leader, then the latest winner and the biggest pot", () => {
  const items = buildBuzz(sessions, 6);
  assert.equal(items[0].text, "Ben took the lead on the money leaderboard, passing Ana.");
  assert.ok(items.some((item) => item.text.startsWith("Ben won the latest game")));
  assert.ok(items.some((item) => item.id === "biggest-pot"));
  assert.ok(items.some((item) => item.id.startsWith("hot-")));
});

test("buzz describes streaks as nights in profit, not wins", () => {
  const items = buildBuzz(sessions, 8);
  const hot = items.find((item) => item.id.startsWith("hot-"));
  assert.ok(hot);
  assert.match(hot.text, /finished in profit 3 games in a row/);
  assert.ok(!items.some((item) => /won \d+ games in a row/.test(item.text)));
});

test("buzz names everyone who shared the top result", () => {
  const tied = [
    game(1, "2026-10-02", [rec("Ana", 10), rec("Ben", -10), rec("Cy", 0)]),
    game(2, "2026-10-09", [rec("Ana", 20), rec("Ben", 20), rec("Cy", -40)]),
  ];
  const items = buildBuzz(tied, 6);
  const latest = items.find((item) => item.id === "latest-winner");
  assert.equal(latest.text, "Ana and Ben shared the top spot in the latest game, $20 up each.");
});

test("buzz reports a new monthly points leader only when the latest game was scored", () => {
  const row = (name, rank, points, date) => ({ key: name.toLowerCase(), name, rank, points, history: [{ date }] });
  const fresh = {
    seasonLabel: "Oct 2026",
    now: [row("Ben", 1, 30, "2026-10-16"), row("Ana", 2, 22, "2026-10-16")],
    before: [row("Ana", 1, 20, "2026-10-09"), row("Ben", 2, 10, "2026-10-09")],
    latestNightDate: "2026-10-16",
  };
  const items = buildBuzz(sessions, 8, fresh);
  assert.ok(items.some((item) => item.text === "Ben took the lead in Oct 2026 points, passing Ana."));
  const stale = buildBuzz(sessions, 8, { ...fresh, latestNightDate: "2026-10-09" });
  assert.ok(!stale.some((item) => item.id === "points-leader"));
  const champion = buildBuzz(sessions, 8, { ...fresh, latestNightDate: null, champion: { label: "Sep 2026", name: "Cy" } });
  assert.ok(champion.some((item) => item.text === "Sep 2026 points champion: Cy."));
});

test("shared games add up what each player won or lost in the games both played", () => {
  const shared = buildSharedGames(sessions, "Ana", "Ben");
  assert.ok(shared);
  assert.equal(shared.name, "Ben");
  assert.equal(shared.games, 5);
  assert.equal(shared.yourNet, 20);
  assert.equal(shared.theirNet, 30);
  assert.equal(shared.recent.length, 5);
  assert.deepEqual(shared.recent.map((row) => row.sessionNumber), [1, 2, 3, 4, 5]);
});

test("shared games only count nights both players sat in", () => {
  const lopsided = [
    game(1, "2026-07-03", [rec("Ana", 10), rec("Ben", -10)]),
    game(2, "2026-07-10", [rec("Ana", 20), rec("Cy", -20)]),
  ];
  const shared = buildSharedGames(lopsided, "Ana", "Ben");
  assert.equal(shared.games, 1);
  assert.equal(shared.yourNet, 10);
  assert.equal(buildSharedGames(lopsided, "Ana", "Ana"), null);
  assert.equal(buildSharedGames(lopsided, "Ana", "Nobody"), null);
});


import { buildTrophyShelf, newlyEarned, BADGE_ORDER } from "./achievements.ts";

const tournament = (n, date, players) => ({ ...game(n, date, players), eventType: "tournament" });

test("first win, perfect month and tournament win are kept badges", () => {
  const set = [
    game(1, "2026-09-04", [rec("Ana", -10), rec("Ben", 10)]),
    game(2, "2026-10-02", [rec("Ana", 5), rec("Ben", -5)]),
    game(3, "2026-10-09", [rec("Ana", 15), rec("Ben", -15)]),
    tournament(4, "2026-10-16", [rec("Ana", 40), rec("Ben", -40)]),
  ];
  const badges = buildBadges(set);
  const ids = (key) => badges.get(key).map((badge) => badge.id);
  assert.ok(ids("ana").includes("first-win"));
  assert.ok(ids("ana").includes("perfect-month"));
  assert.ok(ids("ana").includes("tournament-win"));
  assert.ok(!ids("ben").includes("perfect-month"));
  assert.ok(!ids("ben").includes("tournament-win"));
  assert.equal(badges.get("ana").find((badge) => badge.id === "perfect-month").reason, "Won all 3 games in October 2026");
  // One win in a month is not a perfect month.
  const single = buildBadges([game(1, "2026-09-04", [rec("Cy", 10)])]);
  assert.ok(!single.get("cy").some((badge) => badge.id === "perfect-month"));
});

test("veteran needs ten games and the shelf shows progress while locked", () => {
  const many = Array.from({ length: 10 }, (_, i) => game(i + 1, `2026-0${(i % 9) + 1}-10`, [rec("Ana", i % 2 ? -5 : 5), rec("Ben", 1)]));
  assert.ok(buildBadges(many).get("ana").some((badge) => badge.id === "veteran"));
  const shelf = buildTrophyShelf(many.slice(0, 7), "Ana");
  assert.deepEqual(shelf.map((trophy) => trophy.id), BADGE_ORDER);
  const veteran = shelf.find((trophy) => trophy.id === "veteran");
  assert.equal(veteran.earned, false);
  assert.deepEqual(veteran.progress, { current: 7, target: 10 });
  assert.equal(shelf.find((trophy) => trophy.id === "first-win").earned, true);
});

test("only badges not seen before are announced", () => {
  const current = [{ id: "first-win", label: "First win", reason: "" }, { id: "veteran", label: "Veteran", reason: "" }];
  assert.deepEqual(newlyEarned(current, ["first-win"]).map((badge) => badge.id), ["veteran"]);
  assert.deepEqual(newlyEarned(current, ["first-win", "veteran"]), []);
});

test("kept-badge reasons use readable dates", () => {
  const badges = buildBadges([game(1, "2026-10-02", [rec("Ana", 5), rec("Ben", -5)])]);
  assert.equal(badges.get("ana").find((badge) => badge.id === "first-win").reason, "In profit on 2 Oct 2026");
});

import { buildAccountStats } from "./achievements.ts";

test("account stats summarise a member's record", () => {
  const stats = buildAccountStats(sessions, "ana");
  assert.equal(stats.playerName, "Ana");
  assert.equal(stats.games, 5);
  assert.equal(stats.gamesInProfit, 3);
  assert.equal(stats.net, 20);
  assert.equal(stats.bestGame, 30);
  assert.equal(stats.worstGame, -20);
  assert.equal(stats.firstDate, "2026-07-03");
  assert.equal(stats.longestWinStreak, 2);
  assert.equal(stats.recent.length, 5);
  assert.equal(stats.recent[0].date, "2026-10-16");
  assert.equal(buildAccountStats(sessions, "Nobody"), null);
});

import { buildCareers } from "./career.ts";

test("career data decides the lifetime badges, not the few dated nights", () => {
  // Only two dated nights, but the member has played 51 games and has a 3-win run.
  const nights = [
    game(1, "2026-10-02", [rec("Ana", 5), rec("Ben", -5)]),
    game(2, "2026-10-09", [rec("Ana", -5), rec("Ben", 5)]),
  ];
  const history = [];
  let total = 0;
  const steps = [-20, 30, -5, ...Array.from({ length: 45 }, (_, i) => (i % 2 ? -1 : 2)), 4, 6, 8];
  steps.forEach((step, index) => {
    total += step;
    history.push({ sessionNumber: index + 1, player: "Ana", cumulativeProfit: total });
  });
  const careers = buildCareers(
    [
      { name: "Ana", profitTotal: total, gamesPlayed: 51, positiveSessionPct: 50, maxWin: 30, maxLoss: -20 },
      { name: "Ben", profitTotal: 5, gamesPlayed: 2, positiveSessionPct: 50, maxWin: 5, maxLoss: -5 },
    ],
    history,
  );
  const badges = buildBadges(nights, careers);
  const ids = (key) => (badges.get(key) ?? []).map((badge) => badge.id);
  assert.ok(ids("ana").includes("veteran"));
  assert.ok(ids("ana").includes("heater"));
  assert.ok(ids("ana").includes("iron-player"));
  assert.ok(ids("ana").includes("comeback"));
  assert.ok(!ids("ben").includes("veteran"));
  const shelf = buildTrophyShelf(nights, "Ben", badges, 2);
  assert.deepEqual(shelf.find((trophy) => trophy.id === "veteran").progress, { current: 2, target: 10 });
});

test("the tournament winner badge goes to the recorded winner, not the biggest profit", () => {
  const tournamentNight = {
    ...game(9, "2026-10-11", [rec("Ana", 40), rec("Ben", 30)]),
    eventType: "tournament",
    winner: "Ben",
  };
  const badges = buildBadges([tournamentNight]);
  assert.ok(badges.get("ben").some((badge) => badge.id === "tournament-win"));
  assert.ok(!(badges.get("ana") ?? []).some((badge) => badge.id === "tournament-win"));
});
