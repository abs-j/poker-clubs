import assert from "node:assert/strict";
import test from "node:test";
import { nightsToCsv, tournamentsToCsv } from "./export-csv.ts";
import { parseHistory } from "./import-parse.ts";
import { parseTournamentImport } from "./tournament-import.ts";
import { buildTournamentEvent } from "./tournament-native.ts";

const nights = [
  { date: "2026-03-03", players: [{ name: "Sam", buyIn: 20, cashOut: 35.5 }, { name: "Al, Jr.", buyIn: 20, cashOut: 4.5 }] },
  { date: "2026-03-10", players: [{ name: 'Bo "The Bluff"', buyIn: 10, cashOut: 10 }, { name: "Cy", buyIn: 10, cashOut: 10 }] },
];

test("an export reads back as the same nights", () => {
  const parsed = parseHistory(nightsToCsv(nights));
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.nights, nights);
  assert.deepEqual(parsed.warnings, []);
});

test("names with commas and quotes survive", () => {
  const csv = nightsToCsv(nights);
  assert.match(csv, /"Al, Jr\."/);
  assert.match(csv, /"Bo ""The Bluff"""/);
});

test("a name that would run as a spreadsheet formula is defused", () => {
  const csv = nightsToCsv([{ date: "2026-03-03", players: [{ name: "=HYPERLINK(\"http://x\")", buyIn: 1, cashOut: 1 }, { name: "Ok", buyIn: 1, cashOut: 1 }] }]);
  assert.doesNotMatch(csv, /\r\n=HYPERLINK|,=HYPERLINK/);
  assert.match(csv, /'=HYPERLINK/);
});

test("an empty club exports just the headings", () => {
  assert.equal(nightsToCsv([]), "Date,Player,Buy-in,Cash-out,Net\r\n");
});

test("a surplus is a jackpot row on that night, and a payout is its own row that is not a player", () => {
  const nights = [{ date: "2026-03-03", players: [{ name: "Sam", buyIn: 20, cashOut: 16 }], jackpot: 4 }];
  const payouts = [
    { date: "2026-03-03", name: "Sam", amount: 1.5 },
    { date: "2026-03-15", name: "Al, Jr.", amount: 2 },
  ];
  const csv = nightsToCsv(nights, payouts);
  assert.match(csv, /2026-03-03,Bad Beat Jackpot,0\.00,4\.00,4\.00/);
  assert.match(csv, /2026-03-03,Bad Beat Jackpot payout to Sam,1\.50,0\.00,-1\.50/);
  assert.match(csv, /2026-03-15,"Bad Beat Jackpot payout to Al, Jr\.",2\.00,0\.00,-2\.00/);
  const parsed = parseHistory(csv);
  assert.equal(parsed.error, undefined);
  assert.deepEqual(parsed.nights, [{ date: "2026-03-03", players: [{ name: "Sam", buyIn: 20, cashOut: 16 }] }]);
  assert.ok(!parsed.warnings.some((warning) => warning.includes("differ by")));
  assert.ok(parsed.warnings.some((warning) => warning.includes("Bad Beat Jackpot payout to Al, Jr.")));
});

test("a payout to a name that would run as a formula does not start the cell with the formula", () => {
  const csv = nightsToCsv([], [{ date: "2026-03-15", name: "=HYPERLINK(\"http://x\")", amount: 1 }]);
  assert.doesNotMatch(csv, /\r\n=HYPERLINK|,=HYPERLINK/);
  assert.match(csv, /Bad Beat Jackpot payout to =HYPERLINK/);
});

const played = (name, extra) => ({
  name,
  finishPlace: 1,
  entries: 1,
  topUp: false,
  freeEntry: false,
  knockouts: 0,
  payout: null,
  ...extra,
});

const freezeout = {
  id: "club-7",
  date: "2026-10-04",
  title: 'Friday "Final"',
  venue: "Hall, Room 2",
  notes: "Bring chips, and a pen",
  buyIn: 10,
  topUp: 5,
  bounty: 2.5,
  startingStack: 10000,
  winnerKeepsBounty: true,
  shares: { first: 60, second: 40, third: 0 },
  players: [
    played("Ana", { finishPlace: 1, entries: 2, knockouts: 3 }),
    played("Bo, Jr.", { finishPlace: 2, entries: 1, topUp: true, knockouts: 1 }),
    played("Cy", { finishPlace: 3, entries: 1, freeEntry: true }),
    played("Di", { finishPlace: null, entries: 1 }),
  ],
};

const explicit = {
  id: "club-8",
  date: "2026-11-01",
  title: "Payout Night",
  venue: null,
  notes: null,
  buyIn: 20,
  topUp: 0,
  bounty: 0,
  startingStack: 0,
  winnerKeepsBounty: false,
  shares: { first: 50, second: 30, third: 20 },
  players: [
    played("Ana", { finishPlace: 1, payout: 25 }),
    played("Bo, Jr.", { finishPlace: 2, payout: 15 }),
  ],
};

const eventView = (input) => {
  const event = buildTournamentEvent(input);
  return {
    date: event.date,
    title: event.title,
    venue: event.venue,
    notes: event.notes,
    buyIn: event.buyIn,
    topUp: event.topUp,
    bounty: event.bounty,
    startingStack: event.startingStack,
    shares: event.shares,
    totalCollected: event.totalCollected,
    bountyPool: event.bountyPool,
    mainPrizePool: event.mainPrizePool,
    dataCheck: event.dataCheck,
    winner: event.winner,
    results: event.results.map((result) => ({
      player: result.player,
      entries: result.entries,
      topUp: result.topUp,
      freeEntry: result.freeEntry,
      finishPlace: result.finishPlace,
      knockouts: result.knockouts,
      mainPrize: result.mainPrize,
      bountiesWon: result.bountiesWon,
      netProfit: result.netProfit,
    })),
  };
};

test("tournament sheets import back as the same tournaments", () => {
  const csv = tournamentsToCsv([freezeout, explicit]);
  assert.match(csv.log, /"Friday ""Final"""/);
  assert.match(csv.log, /"Hall, Room 2"/);
  assert.match(csv.results, /"Bo, Jr\."/);
  assert.doesNotMatch(csv.log, /(^|,)Player(,|$)/i);
  assert.match(csv.results.split(/\r?\n/)[0], /(^|,)Player(,|$)/);
  const parsed = parseTournamentImport(csv.log, csv.results);
  assert.equal(parsed.error, undefined, parsed.error);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.tournaments.length, 2);
  const byTitle = new Map(parsed.tournaments.map((tournament) => [tournament.title, tournament]));
  const broughtBack = byTitle.get(freezeout.title);
  const paid = byTitle.get(explicit.title);
  assert.equal(broughtBack.winnerKeepsBounty, true);
  assert.equal(paid.winnerKeepsBounty, false);
  assert.equal(broughtBack.startingStack, 10000);
  assert.equal(broughtBack.players.find((player) => player.name === "Di").finishPlace, null);
  assert.deepEqual(eventView(broughtBack), eventView(freezeout));
  assert.deepEqual(eventView(paid), eventView(explicit));
  assert.deepEqual(paid.players.map((player) => [player.name, player.payout]), [["Ana", 25], ["Bo, Jr.", 15]]);
});

test("a club with no tournaments exports just the two headings", () => {
  const csv = tournamentsToCsv([]);
  assert.equal(csv.log.split(/\r\n/).filter(Boolean).length, 1);
  assert.equal(csv.results.split(/\r\n/).filter(Boolean).length, 1);
  assert.match(csv.log, /^Tournament ID,Date,Title,Status,/);
  assert.match(csv.results, /^Tournament ID,Player,Entries,/);
});
