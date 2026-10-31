import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateLiveLedgerTotals,
  calculateLivePlayerTotals,
  cleanNotesPlayers,
  chooseLedgerDate,
  liveLedgerSessionDate,
  resolveCurrentLiveSession,
  shouldDiscardEmptyLiveSession,
} from "./live-ledger-utils.ts";

test("uses Melbourne calendar dates across midnight", () => {
  assert.equal(liveLedgerSessionDate(new Date("2026-05-01T13:59:59.000Z")), "2026-05-01");
  assert.equal(liveLedgerSessionDate(new Date("2026-05-01T14:00:00.000Z")), "2026-05-02");
});

test("an open ledger stays current after its Melbourne session date changes", () => {
  const previousDayOpen = { sessionDate: "2026-05-01", status: "open" };
  const todayClosed = { sessionDate: "2026-05-02", status: "ended" };
  assert.equal(resolveCurrentLiveSession(previousDayOpen, todayClosed), previousDayOpen);
  assert.equal(resolveCurrentLiveSession(null, todayClosed), todayClosed);
});

test("reports exact buy-in and cash-out totals as balanced", () => {
  assert.deepEqual(
    calculateLiveLedgerTotals([
      { action: "buy_in", amountCents: 12_500 },
      { action: "buy_in", amountCents: 3_000 },
      { action: "cash_out", amountCents: 15_500 },
    ]),
    {
      buyInsCents: 15_500,
      cashOutsCents: 15_500,
      differenceCents: 0,
      balanceStatus: "balanced",
    },
  );
});

test("reports buy-ins minus cash-outs when buy-ins are higher", () => {
  assert.deepEqual(
    calculateLiveLedgerTotals([
      { action: "buy_in", amountCents: 10_000 },
      { action: "cash_out", amountCents: 9_999 },
    ]),
    {
      buyInsCents: 10_000,
      cashOutsCents: 9_999,
      differenceCents: 1,
      balanceStatus: "unbalanced",
    },
  );
});

test("reports a negative balance when cash-outs are higher than buy-ins", () => {
  assert.deepEqual(
    calculateLiveLedgerTotals([
      { action: "buy_in", amountCents: 9_999 },
      { action: "cash_out", amountCents: 10_000 },
    ]),
    {
      buyInsCents: 9_999,
      cashOutsCents: 10_000,
      differenceCents: -1,
      balanceStatus: "unbalanced",
    },
  );
});

test("an empty ledger has zero totals", () => {
  assert.deepEqual(calculateLiveLedgerTotals([]), {
    buyInsCents: 0,
    cashOutsCents: 0,
    differenceCents: 0,
    balanceStatus: "balanced",
  });
});

test("rejects unexpected stored activity types", () => {
  assert.throws(
    () => calculateLiveLedgerTotals([{ action: "transfer", amountCents: 100 }]),
    /Unknown live ledger action/,
  );
});

test("calculates buy-in and cash-out totals by player within one session", () => {
  assert.deepEqual(
    calculateLivePlayerTotals(
      [
        { sessionKey: "session-1", memberName: "Alex", action: "buy_in", amountCents: 5_000, deleted: false },
        { sessionKey: "session-1", memberName: " alex ", action: "cash_out", amountCents: 7_500, deleted: false },
        { sessionKey: "session-1", memberName: "Sam", action: "buy_in", amountCents: 2_000, deleted: false },
        { sessionKey: "session-2", memberName: "Alex", action: "buy_in", amountCents: 9_000, deleted: false },
        { sessionKey: "session-1", memberName: "Alex", action: "cash_out", amountCents: 3_000, deleted: true },
      ],
      "session-1",
    ),
    [
      { playerName: "Alex", buyInsCents: 5_000, cashOutsCents: 7_500 },
      { playerName: "Sam", buyInsCents: 2_000, cashOutsCents: 0 },
    ],
  );
});

test("discards only a session with no activity rows", () => {
  assert.equal(shouldDiscardEmptyLiveSession([]), true);
  assert.equal(shouldDiscardEmptyLiveSession([{ deletedAt: null }]), false);
  assert.equal(shouldDiscardEmptyLiveSession([{ deletedAt: new Date() }]), false);
});

test("activity committed before the locked close scan prevents discard", () => {
  const rowsVisibleToClose = [
    { deletedAt: null },
  ];
  assert.equal(shouldDiscardEmptyLiveSession(rowsVisibleToClose), false);
});
test("a night starts for tonight unless a real past date is chosen", () => {
  assert.deepEqual(chooseLedgerDate(undefined, "2026-10-31"), { date: "2026-10-31" });
  assert.deepEqual(chooseLedgerDate("", "2026-10-31"), { date: "2026-10-31" });
  assert.deepEqual(chooseLedgerDate("2026-10-31", "2026-10-31"), { date: "2026-10-31" });
  assert.deepEqual(chooseLedgerDate("2026-03-03", "2026-10-31"), { date: "2026-03-03" });
  assert.deepEqual(chooseLedgerDate("2024-02-29", "2026-10-31"), { date: "2024-02-29" });
  for (const bad of ["2026-11-01", "2026-02-30", "2026-13-01", "31/10/2026", "1999-12-31", 5, {}]) {
    assert.ok("error" in chooseLedgerDate(bad, "2026-10-31"), `${JSON.stringify(bad)} should be refused`);
  }
});

test("players read from notes are tidied, merged by name and dropped when they have no money", () => {
  const read = cleanNotesPlayers([
    { name: "  Ann ", buyIn: "20", cashOut: 45.5 },
    { name: "ann", buyIn: 10, cashOut: "0" },
    { name: "Bo", buyIn: 0, cashOut: 0 },
    { name: "", buyIn: 5, cashOut: 5 },
    { name: "Cy", buyIn: "", cashOut: 7 },
  ]);
  assert.deepEqual(read, { players: [
    { name: "Ann", buyInCents: 3000, cashOutCents: 4550 },
    { name: "Cy", buyInCents: 0, cashOutCents: 700 },
  ] });
});

test("notes with a bad amount, a long name or nobody are refused", () => {
  for (const bad of [[], "x", null, [{ name: "Ann", buyIn: -1, cashOut: 0 }], [{ name: "Ann", buyIn: "abc", cashOut: 0 }], [{ name: "x".repeat(81), buyIn: 1, cashOut: 0 }], [{ name: "Bo", buyIn: 0, cashOut: 0 }], Array.from({ length: 101 }, (_, i) => ({ name: `P${i}`, buyIn: 1, cashOut: 1 }))]) {
    assert.ok("error" in cleanNotesPlayers(bad), `${JSON.stringify(bad).slice(0, 60)} should be refused`);
  }
});
