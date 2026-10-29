import assert from "node:assert/strict";
import test from "node:test";
import { parseTournamentImport } from "./tournament-import.ts";
import { buildTournamentEvent } from "./tournament-native.ts";

const logHeader = "Tournament ID,Date,Title,Status,Buy-in ($),Top-up ($),Bounty amount ($),Starting stack,Winner keeps own bounty,1st place share,2nd place share,3rd place share,Total collected ($),Bounty pool ($),Main prize pool ($),Data check";
const resultsHeader = "Tournament ID,Player,Entries,Rebuys,Top-up,Free entry,Finish place,Knockouts,Main prize ($),Net profit ($)";

// 4 players at $10 with a $2.50 bounty. Di's first entry is free but her rebuy is paid, and the
// winner keeps her own bounty: 4 paid entries = $40, 6 bounties = $15, main pool $25.
const results = [
  "t1,Ana,2,1,FALSE,FALSE,1,3,$15.00,$5.00",
  "t1,Bo,1,0,FALSE,FALSE,2,1,$10.00,$2.50",
  "t1,Cy,1,0,FALSE,TRUE,3,0,-,$0.00",
  "t1,Di,2,1,FALSE,TRUE,4,1,-,($7.50)",
].join("\n");
const log = (collected = "$40.00") =>
  `${logHeader}\nt1,2026-10-04,Friday Freezeout,Completed,$10.00,$0.00,$2.50,"10,000",TRUE,60.0%,40.0%,0.0%,${collected},$15.00,$25.00,✓ OK`;

test("a club's tournament tabs import as recorded, and the totals match the sheet's own", () => {
  const result = parseTournamentImport(log(), `${resultsHeader}\n${results}`);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.tournaments.length, 1);
  const tournament = result.tournaments[0];
  assert.equal(tournament.winnerKeepsBounty, true);
  assert.deepEqual(tournament.players.map((p) => [p.name, p.entries, p.freeEntry, p.payout]), [
    ["Ana", 2, false, 15], ["Bo", 1, false, 10], ["Cy", 1, true, null], ["Di", 2, true, null],
  ]);
  const event = buildTournamentEvent(tournament);
  assert.equal(event.totalCollected, 40);
  assert.equal(event.bountyPool, 15);
  assert.equal(event.mainPrizePool, 25);
  assert.equal(event.results[0].bountiesWon, 10); // 3 knockouts plus her own
  assert.equal(event.dataCheck, "OK");
});

test("a total the app works out differently from the sheet is reported, not hidden", () => {
  const result = parseTournamentImport(log("$50.00"), `${resultsHeader}\n${results}`);
  assert.equal(result.tournaments.length, 1);
  assert.ok(result.warnings.some((w) => w.includes("collected $40 vs $50")));
});

test("tabs with nothing readable give a clear error", () => {
  assert.match(parseTournamentImport("", "x").error, /both/);
  assert.match(parseTournamentImport("a,b\n1,2", "c,d\n3,4").error, /No completed tournaments/);
});
