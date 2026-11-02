import assert from "node:assert/strict";
import test from "node:test";

import { buildCashRecap, buildTournamentRecap, describeDate, RECAP_FORMATS } from "./recaps.ts";

const p = (player, buyIn, cashOut) => ({ player, buyIn, cashOut, net: cashOut - buyIn });

test("dates read naturally and ignore the time zone", () => {
  assert.deepEqual(describeDate("2026-10-10"), { long: "Saturday 10 Oct", full: "10 Oct 2026" });
  assert.deepEqual(describeDate("2026-10-11"), { long: "Sunday 11 Oct", full: "11 Oct 2026" });
  assert.equal(describeDate("nonsense").full, "nonsense");
});

test("all three Instagram formats exist with sensible safe areas", () => {
  assert.deepEqual(Object.keys(RECAP_FORMATS).sort(), ["feed", "square", "story"]);
  assert.equal(RECAP_FORMATS.story.height, 1920);
  assert.ok(RECAP_FORMATS.story.safeTop > RECAP_FORMATS.feed.safeTop);
});

test("a cash night recap has a cover, results, highlights and a caption", () => {
  const pack = buildCashRecap({
    date: "2026-10-10",
    sessionNumber: 8,
    totalBuyIn: 300,
    players: [p("Ranuka", 20, 55.75), p("Abhay", 20, 44.5), p("Ben", 40, 5), p("Bad Beat Jackpot", 7.25, 0)],
  });
  assert.deepEqual(pack.slides.map((s) => s.kind), ["cover", "ranking", "tiles"]);
  const [cover, ranking, tiles] = pack.slides;
  assert.equal(cover.headline, "Ranuka took the night");
  assert.equal(cover.value, "+$35.75");
  assert.deepEqual(cover.chips, ["3 players", "$300 in the pot"]);
  assert.equal(ranking.rows.length, 3);
  assert.ok(!ranking.rows.some((r) => /jackpot/i.test(r.name)));
  assert.equal(ranking.rows[2].value, "−$35.00");
  assert.equal(tiles.tiles.find((t) => t.label === "Roughest night").value, "Ben");
  assert.equal(tiles.tiles.find((t) => t.label === "Finished in profit").value, "2 of 3");
  assert.match(pack.caption, /Saturday 10 Oct/);
  assert.match(pack.caption, /Ranuka took the night, \+\$35\.75/);
  assert.match(pack.caption, /#pokernight/);
  assert.equal(pack.id, "cash-8");
});

test("a night nobody won says so", () => {
  const pack = buildCashRecap({ date: "2026-10-10", sessionNumber: 1, totalBuyIn: 40, players: [p("A", 10, 10), p("B", 10, 10), p("C", 10, 10), p("D", 10, 10)] });
  assert.equal(pack.slides[0].headline, "Everyone played it safe");
});

test("a tournament recap has a podium, results, highlights and a caption", () => {
  const pack = buildTournamentRecap({
    id: "20261011-1", date: "2026-10-11", title: "Friday Tournament", players: 12, entries: 16, rebuys: 4, topUps: 9,
    knockouts: 15, mainPrizePool: 210, bountyPool: 40, winner: "Ranuka", winnerPrize: 105, topBountyHunter: "Ranuka", mostKnockouts: 4,
    results: [
      { player: "Ranuka", finishPlace: 1, knockouts: 4, mainPrize: 105, bountiesWon: 12.5, netProfit: 97.5 },
      { player: "Vivan", finishPlace: 2, knockouts: 3, mainPrize: 70, bountiesWon: 7.5, netProfit: 57.5 },
      { player: "Jason", finishPlace: 3, knockouts: 2, mainPrize: 35, bountiesWon: 5, netProfit: 20 },
      { player: "Abhay", finishPlace: 4, knockouts: 1, mainPrize: 0, bountiesWon: 2.5, netProfit: -17.5 },
    ],
  });
  assert.deepEqual(pack.slides.map((s) => s.kind), ["cover", "podium", "ranking", "tiles"]);
  assert.equal(pack.slides[0].value, "$105.00");
  assert.deepEqual(pack.slides[1].places.map((x) => x.name), ["Ranuka", "Vivan", "Jason"]);
  assert.equal(pack.slides[1].note, "Plus $40 in bounties");
  assert.equal(pack.slides[2].rows[3].value, "−$17.50");
  assert.match(pack.caption, /Ranuka took it down, \$105\.00/);
  assert.match(pack.caption, /Top bounty hunter: Ranuka \(4\)/);
  assert.equal(pack.id, "tournament-20261011-1");
});

test("a tournament without recorded places still produces a recap", () => {
  const pack = buildTournamentRecap({
    id: "x", date: "2026-10-04", title: "T", players: 4, entries: 5, rebuys: 1, topUps: 0, knockouts: 3, mainPrizePool: 40, bountyPool: 0,
    winner: "Ana", winnerPrize: 20, topBountyHunter: null, mostKnockouts: 0,
    results: [
      { player: "Ana", finishPlace: 1, knockouts: 2, mainPrize: 20, bountiesWon: 0, netProfit: 10 },
      { player: "Ben", finishPlace: null, knockouts: 1, mainPrize: 0, bountiesWon: 0, netProfit: -5 },
      { player: "Cy", finishPlace: null, knockouts: 0, mainPrize: 0, bountiesWon: 0, netProfit: -10 },
    ],
  });
  assert.deepEqual(pack.slides.map((s) => s.kind), ["cover", "ranking", "tiles"]);
  assert.deepEqual(pack.slides[1].rows.map((r) => r.name), ["Ana", "Ben", "Cy"]);
});

import { setClubFormat } from "./club-format.ts";

setClubFormat({ name: "Friday Cards" });

test("captions use the club's own name", () => {
  const pack = buildCashRecap({ date: "2026-10-10", sessionNumber: 8, totalBuyIn: 40, players: [p("A", 10, 30), p("B", 10, 0), p("C", 10, 5), p("D", 10, 5)] });
  assert.match(pack.caption, /♠ Friday Cards · /);
  assert.doesNotMatch(pack.caption, /Monash|#monashpoker/);
  assert.match(pack.caption, /#pokernight/);
});

import { buildWrappedRecap } from "./recaps.ts";

test("a finished month becomes a paged wrapped pack with a caption", () => {
  const pack = buildWrappedRecap({
    monthKey: "2026-10",
    label: "Oct 2026",
    games: 3,
    players: 2,
    totalPot: 180,
    leader: { name: "Ben", net: 45, wins: 2, games: 3 },
    bestNight: { name: "Ben", net: 30, date: "2026-10-16" },
    standings: [
      { name: "Ben", net: 45, wins: 2, games: 3 },
      { name: "Ana", net: -20, wins: 1, games: 3 },
    ],
    viewer: { name: "Ana", rank: 2, of: 2, net: -20, games: 3, wins: 1, bestGame: 10 },
  });
  assert.deepEqual(pack.slides.map((slide) => slide.kind), ["cover", "tiles", "ranking"]);
  assert.equal(pack.slides[0].eyebrow, "Poker Wrapped");
  assert.equal(pack.slides[0].value, "−$20.00");
  assert.match(pack.caption, /Poker Wrapped · Oct 2026/);
  assert.match(pack.caption, /Ben led the month/);
  assert.match(pack.caption, /You finished 2nd of 2/);
  assert.equal(pack.id, "wrapped-2026-10");
});

import { redactAmounts } from "./recaps.ts";

test("hiding amounts leaves names and places but no money", () => {
  const cash = buildCashRecap({
    date: "2026-10-10", sessionNumber: 8, totalBuyIn: 80,
    players: [p("Ana", 20, 50), p("Ben", 20, 0), p("Cy", 20, 20), p("Di", 20, 10)],
  });
  const wrapped = buildWrappedRecap({
    monthKey: "2026-10", label: "Oct 2026", games: 3, players: 2, totalPot: 180,
    leader: { name: "Ben", net: 45, wins: 2, games: 3 }, bestNight: { name: "Ben", net: 30, date: "2026-10-16" },
    standings: [{ name: "Ben", net: 45, wins: 2, games: 3 }, { name: "Ana", net: -20, wins: 1, games: 3 }],
    viewer: { name: "Ana", rank: 2, of: 2, net: -20, games: 3, wins: 1, bestGame: 10 },
  });
  for (const pack of [cash, wrapped]) {
    const hidden = redactAmounts(pack);
    const text = JSON.stringify(hidden.slides) + hidden.caption;
    assert.doesNotMatch(text, /\$/, text);
    assert.equal(hidden.id, pack.id);
    assert.equal(hidden.slides.length, pack.slides.length);
  }
  const hiddenCash = redactAmounts(cash);
  assert.equal(hiddenCash.slides[0].headline, "Ana took the night");
  assert.deepEqual(hiddenCash.slides[1].rows.map((row) => row.name), ["Ana", "Cy", "Di", "Ben"]);
});
