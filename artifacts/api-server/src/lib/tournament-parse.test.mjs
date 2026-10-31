import assert from "node:assert/strict";
import test from "node:test";

import { aggregateTournaments, parseBool, parseNumber, parseTournamentLog, parseTournamentResults } from "./tournament-parse.ts";

const LOG_HEADER = ["Tournament ID", "Date", "Title", "Status", "Venue", "Format", "Start time", "Buy-in ($)", "Top-up ($)", "Bounty amount ($)", "Bounty basis", "Starting stack", "Top-up stack", "1st place share", "2nd place share", "3rd place share", "Notes", "Players", "Entries", "Rebuys", "Top-ups", "Free entries", "Total knockouts", "Total collected ($)", "Bounty pool ($)", "Main prize pool ($)", "Winner", "Runner-up", "3rd place", "Winner prize ($)", "Top bounty hunter", "Most knockouts", "Data check"];
const RES_HEADER = ["Tournament ID", "Date", "Player", "Rebuys", "Top-up", "Free entry", "Finish place", "Knockouts", "Eliminated by", "Entries", "Invested ($)", "Bounties won ($)", "Main prize ($)", "Total return ($)", "Net profit ($)", "In the money"];

const log = [
  LOG_HEADER,
  ["20261004-1", "2026-10-04", "Poker Club Tournament", "Completed", "", "Rebuy + Freezeout", "", "$10.00", "$0.00", "$2.50", "Per player", "10,000", "0", "50.0%", "33.9%", "16.1%", "older format", "3", "4", "1", "0", "0", "2", "$40.00", "$7.50", "$32.50", "Ana", "Ben", "Cy", "$16.25", "Ana", "2", "✓ OK"],
  ["20261011-1", "2026-10-11", "Poker Club Tournament", "Completed", "", "Rebuy + Top-up", "8:30 pm", "$10.00", "$10.00", "$2.50", "Per entry", "10,000", "10,000", "50.0%", "33.3%", "16.7%", "", "2", "2", "0", "1", "0", "1", "$30.00", "$5.00", "$25.00", "Ben", "Ana", "", "$12.50", "Ben", "1", "✓ OK"],
  ["20261018-1", "2026-10-18", "Planned", "Planned", ...Array(28).fill("")],
  ["", "", "", "", ...Array(29).fill("")],
];
const results = [
  RES_HEADER,
  ["20261004-1", "", "Ana", "1", "FALSE", "FALSE", "1", "2", "", "2", "$20.00", "$5.00", "$16.25", "$21.25", "$1.25", "TRUE"],
  ["20261004-1", "", "Ben", "0", "FALSE", "FALSE", "", "0", "", "1", "$10.00", "-", "-", "-", "($10.00)", "FALSE"],
  ["20261004-1", "", "Cy", "0", "FALSE", "TRUE", "", "0", "", "1", "$10.00", "-", "-", "-", "($10.00)", "FALSE"],
  ["20261011-1", "", "Ben", "0", "TRUE", "FALSE", "1", "1", "", "1", "$20.00", "$2.50", "$12.50", "$15.00", "($5.00)", "TRUE"],
  ["20261011-1", "", "Ana", "0", "TRUE", "FALSE", "2", "0", "Ben", "1", "$20.00", "-", "$12.50", "$12.50", "($7.50)", "TRUE"],
  ["20261011-1", "", "ana", "0", "TRUE", "FALSE", "3", "0", "Ben", "1", "$20.00", "-", "-", "-", "($20.00)", "FALSE"],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
];

test("sheet-formatted numbers are read correctly", () => {
  assert.equal(parseNumber("$1,250.50"), 1250.5);
  assert.equal(parseNumber("($20.00)"), -20);
  assert.equal(parseNumber("-$5"), -5);
  assert.equal(parseNumber("-"), 0);
  assert.equal(parseNumber(""), 0);
  assert.equal(parseNumber("744%"), 744);
  assert.equal(parseNumber("10,000"), 10000);
  assert.equal(parseNumber(12), 12);
  assert.equal(parseBool("TRUE"), true);
  assert.equal(parseBool("FALSE"), false);
});

test("results are grouped by tournament and duplicate names collapse", () => {
  const byId = parseTournamentResults(results);
  assert.equal(byId.get("20261004-1").length, 3);
  assert.equal(byId.get("20261011-1").length, 2); // "ana" repeats "Ana"
  const ana = byId.get("20261004-1")[0];
  assert.equal(ana.finishPlace, 1);
  assert.equal(ana.netProfit, 1.25);
  assert.equal(ana.entries, 2);
  assert.equal(byId.get("20261004-1")[1].finishPlace, null);
  assert.equal(byId.get("20261004-1")[2].freeEntry, true);
});

test("tournaments come back newest first, completed only, with results attached", () => {
  const events = parseTournamentLog(log, results);
  assert.deepEqual(events.map((event) => event.id), ["20261011-1", "20261004-1"]);
  const first = events[1];
  assert.equal(first.date, "2026-10-04");
  assert.equal(first.buyIn, 10);
  assert.equal(first.shares.second, 33.9);
  assert.equal(first.bountyBasis, "Per player");
  assert.equal(first.startTime, null);
  assert.equal(first.venue, null);
  assert.equal(first.dataCheck, "✓ OK");
  // Known finishers first, then the rest by result.
  assert.deepEqual(first.results.map((r) => r.player), ["Ana", "Ben", "Cy"]);
});

test("columns are found by name, so their order does not matter", () => {
  const shuffled = (rows) => rows.map((row) => [...row].reverse());
  const events = parseTournamentLog(shuffled(log), shuffled(results));
  assert.equal(events.length, 2);
  assert.equal(events[0].winner, "Ben");
});

test("a missing or empty tab gives no tournaments instead of failing", () => {
  assert.deepEqual(parseTournamentLog([], []), []);
  assert.deepEqual(parseTournamentLog(log, []), []);
});

test("aggregates roll every tournament up per player", () => {
  const snapshot = aggregateTournaments(parseTournamentLog(log, results));
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.eventDate, "2026-10-11");
  const ana = snapshot.players.find((p) => p.player === "Ana");
  assert.equal(ana.tournaments, 2);
  assert.equal(ana.netProfit, -6.25);
  assert.equal(ana.profitableTournaments, 1);
  assert.equal(ana.bestResult, 1.25);
  assert.equal(ana.worstResult, -7.5);
  assert.equal(snapshot.totalPlayers, 3);
});
