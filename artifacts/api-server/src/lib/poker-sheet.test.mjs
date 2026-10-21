import assert from "node:assert/strict";
import test from "node:test";

import {
  findNextCanonicalWriteRange,
  parseTournamentSnapshot,
} from "./poker-sheet.ts";

function makeSessionLogRows() {
  const rows = Array.from({ length: 999 }, () => Array(11).fill(""));

  rows[0] = ["Date", "Player", "Buy In", "Cash Out"];
  for (let rowNumber = 2; rowNumber <= 528; rowNumber += 1) {
    rows[rowNumber - 1][0] = "01/01/2026";
    rows[rowNumber - 1][1] = `Player ${rowNumber}`;
  }

  rows[998][9] = "application-marker-near-used-range";
  return rows;
}

test("selects the first contiguous empty block after real data for two players", () => {
  const range = findNextCanonicalWriteRange(makeSessionLogRows(), 2);

  assert.deepEqual(range, { start: 529, end: 530 });
});

test("selects the first contiguous empty block after real data for three players", () => {
  const range = findNextCanonicalWriteRange(makeSessionLogRows(), 3);

  assert.deepEqual(range, { start: 529, end: 531 });
});

test("does not treat a marker-only row as available", () => {
  const rows = makeSessionLogRows();
  rows[528][9] = "application-marker-in-first-gap";

  const range = findNextCanonicalWriteRange(rows, 2);

  assert.deepEqual(range, { start: 530, end: 531 });
  assert.equal(rows[528][9], "application-marker-in-first-gap");
});

function tournamentRow(player, buyIn, payout, netProfit) {
  const row = Array(14).fill("");
  row[1] = player;
  row[6] = buyIn;
  row[10] = payout;
  row[11] = netProfit;
  return row;
}

test("parses tournament earnings from Net Profit without adding gross payouts", () => {
  const snapshot = parseTournamentSnapshot([
    ["", "Tournament snapshot"],
    ["", "Player Name"],
    tournamentRow("Abhay", "$20.00", "$168.75", "$148.75"),
    tournamentRow("Toby", "$10.00", "$0.00", "-$10.00"),
    tournamentRow("TOTAL", "$30.00", "$168.75", "$138.75"),
  ]);

  assert.deepEqual(snapshot, {
    available: true,
    eventDate: "2026-10-04",
    totalPlayers: 2,
    totalInvested: 30,
    totalReturned: 168.75,
    totalNetProfit: 138.75,
    players: [
      { player: "Abhay", buyIn: 20, returned: 168.75, netProfit: 148.75 },
      { player: "Toby", buyIn: 10, returned: 0, netProfit: -10 },
    ],
  });
});

test("keeps a missing or empty tournament source explicitly unavailable", () => {
  assert.deepEqual(parseTournamentSnapshot([]), {
    available: false,
    eventDate: null,
    totalPlayers: 0,
    totalInvested: 0,
    totalReturned: 0,
    totalNetProfit: 0,
    players: [],
  });

  assert.equal(
    parseTournamentSnapshot([["", "Player Name"]]).available,
    false,
  );
});

test("rejects duplicate tournament player rows rather than double-counting them", () => {
  assert.throws(
    () =>
      parseTournamentSnapshot([
        ["", "Player Name"],
        tournamentRow("Abhay", "$20.00", "$168.75", "$148.75"),
        tournamentRow("  abhay  ", "$20.00", "$168.75", "$148.75"),
      ]),
    /duplicate player/i,
  );
});
import { isPlayedSession } from "./poker-sheet.ts";

test("a log entry holding only the jackpot line is not a played game", () => {
  assert.equal(isPlayedSession({ players: [{ player: "Bad Beat Jackpot" }] }), false);
  assert.equal(isPlayedSession({ players: [{ player: " bad beat jackpot " }] }), false);
  assert.equal(isPlayedSession({ players: [{ player: "Bad Beat Jackpot" }, { player: "Ana" }] }), true);
  assert.equal(isPlayedSession({ players: [] }), false);
});
