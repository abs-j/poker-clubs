import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateLiveLedgerTotals,
  calculateLivePlayerTotals,
  cleanNotesPlayers,
  formatLiveLedgerTimestamp,
  chooseLedgerDate,
  liveLedgerSheetRowRangesForSession,
  liveLedgerSessionDate,
  normalizeGoogleSheetsDate,
  parseMelbourneTimestamp,
  resolveCurrentLiveSession,
  shouldDiscardEmptyLiveSession,
} from "./live-ledger-utils.ts";
import {
  assertValidLiveActivityDeleteBackupId,
  createLiveActivitySheetRollbackGuard,
  deleteLiveActivitySessionSafely,
  LiveActivitySessionDeleteConflictError,
  LiveActivitySessionNotClosedError,
  LiveActivitySessionNotFoundError,
} from "./live-ledger-deletion.ts";

test("selects only the sheet rows belonging to a deleted ledger session", () => {
  assert.deepEqual(
    liveLedgerSheetRowRangesForSession(
      [
        ["event_id", "session_key"],
        ["event-1", "session-1"],
        ["event-2", "session-1"],
        ["other-event", "session-2"],
        ["", "session-1"],
        ["event-1", "legacy-mismatch"],
      ],
      "session-1",
      new Set(["event-1", "event-2"]),
    ),
    [
      [2, 3],
      [5, 6],
    ],
  );
});

test("rejects stale backups and sessions that are not closed before deletion", async () => {
  const validBackupId = "a".repeat(64);
  assertValidLiveActivityDeleteBackupId(validBackupId);
  assert.throws(
    () => assertValidLiveActivityDeleteBackupId("stale"),
    LiveActivitySessionDeleteConflictError,
  );

  let sideEffects = 0;
  const deletionOptions = {
    backupId: validBackupId,
    currentBackupId: validBackupId,
    environment: "development",
    rows: [],
    sessionKey: "closed-session",
    eventIds: new Set(),
    selectRanges: liveLedgerSheetRowRangesForSession,
    onMutationStarted() {
      sideEffects += 1;
    },
    async clearRanges() {
      sideEffects += 1;
    },
    async deleteEvents() {
      sideEffects += 1;
    },
    async deleteSession() {
      sideEffects += 1;
    },
  };

  await assert.rejects(
    deleteLiveActivitySessionSafely({
      ...deletionOptions,
      session: { status: "ended" },
      currentBackupId: "b".repeat(64),
    }),
    LiveActivitySessionDeleteConflictError,
  );
  for (const status of ["open", "finalizing"]) {
    await assert.rejects(
      deleteLiveActivitySessionSafely({
        ...deletionOptions,
        session: { status },
      }),
      LiveActivitySessionNotClosedError,
    );
  }
  await assert.rejects(
    deleteLiveActivitySessionSafely({
      ...deletionOptions,
      session: undefined,
    }),
    LiveActivitySessionNotFoundError,
  );
  assert.equal(sideEffects, 0);
});

test("production clears only the selected session row, leaving open and malformed rows intact", async () => {
  const originalRows = [
    ["event_id", "session_key", "session_date"],
    ["closed-event", "closed-session", "2026-09-01"],
    ["open-event", "current-session", "2026-09-30"],
    ["malformed", "", "not-a-session"],
    ["other-event", "other-session", "2026-09-02"],
  ];
  const sheetRows = originalRows.map((row) => [...row]);
  let requestedRanges;

  let databaseSessions = ["closed-session", "current-session"];
  let databaseEvents = ["closed-event", "open-event"];
  const { clearedSheetRows } = await deleteLiveActivitySessionSafely({
    session: { status: "ended" },
    backupId: "a".repeat(64),
    currentBackupId: "a".repeat(64),
    environment: "production",
    rows: sheetRows,
    sessionKey: "closed-session",
    eventIds: new Set(["closed-event"]),
    selectRanges: liveLedgerSheetRowRangesForSession,
    onMutationStarted() {},
    async clearRanges(ranges) {
      requestedRanges = ranges;
      for (const [startRow, endRow] of ranges) {
        for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
          sheetRows[rowNumber - 1] = Array(15).fill("");
        }
      }
    },
    async deleteEvents(eventIds) {
      assert.deepEqual([...eventIds], ["closed-event"]);
      databaseEvents = databaseEvents.filter((eventId) => !eventIds.has(eventId));
    },
    async deleteSession(sessionKey) {
      assert.equal(sessionKey, "closed-session");
      databaseSessions = databaseSessions.filter((key) => key !== sessionKey);
    },
  });

  assert.equal(clearedSheetRows, 1);
  assert.deepEqual(requestedRanges, [[2, 2]]);
  assert.deepEqual(databaseSessions, ["current-session"]);
  assert.deepEqual(databaseEvents, ["open-event"]);
  assert.deepEqual(sheetRows[2], originalRows[2]);
  assert.deepEqual(sheetRows[3], originalRows[3]);
  assert.deepEqual(sheetRows[4], originalRows[4]);
});

test("development deletion never invokes the shared-sheet writer", async () => {
  let mutationStarted = false;
  let clearCalled = false;
  let databaseSessions = ["closed-session", "current-session"];
  const { clearedSheetRows } = await deleteLiveActivitySessionSafely({
    session: { status: "ended" },
    backupId: "a".repeat(64),
    currentBackupId: "a".repeat(64),
    environment: "development",
    rows: [
      ["event_id", "session_key"],
      ["closed-event", "closed-session"],
    ],
    sessionKey: "closed-session",
    eventIds: new Set(["closed-event"]),
    selectRanges: liveLedgerSheetRowRangesForSession,
    onMutationStarted() {
      mutationStarted = true;
    },
    async clearRanges() {
      clearCalled = true;
    },
    async deleteEvents() {},
    async deleteSession(sessionKey) {
      databaseSessions = databaseSessions.filter((key) => key !== sessionKey);
    },
  });

  assert.equal(clearedSheetRows, 0);
  assert.equal(mutationStarted, false);
  assert.equal(clearCalled, false);
  assert.deepEqual(databaseSessions, ["current-session"]);
});

test("restores the full sheet snapshot when a clear partially succeeds and then fails", async () => {
  const originalRows = [
    ["event_id", "session_key"],
    ["closed-event", "closed-session"],
    ["open-event", "current-session"],
    ["malformed", "", "unrelated"],
  ];
  let sheetRows = originalRows.map((row) => [...row]);
  let deleteCalled = false;
  let restoreFailures = 0;
  const rollback = createLiveActivitySheetRollbackGuard(() => {
    restoreFailures += 1;
  });

  await assert.rejects(
    rollback.run(async () => {
      await deleteLiveActivitySessionSafely({
        session: { status: "ended" },
        backupId: "a".repeat(64),
        currentBackupId: "a".repeat(64),
        environment: "production",
        rows: originalRows,
        sessionKey: "closed-session",
        eventIds: new Set(["closed-event"]),
        selectRanges: liveLedgerSheetRowRangesForSession,
        onMutationStarted: () => {
          rollback.markMutationStarted(originalRows, async (rows) => {
            sheetRows = rows;
          });
        },
        async clearRanges(ranges) {
          for (const [startRow, endRow] of ranges) {
            for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
              sheetRows[rowNumber - 1] = Array(15).fill("");
            }
          }
          throw new Error("Sheets cleared rows but the request failed");
        },
        async deleteEvents() {
          deleteCalled = true;
        },
        async deleteSession() {
          deleteCalled = true;
        },
      });
    }),
    /Sheets cleared rows but the request failed/,
  );

  assert.deepEqual(sheetRows, originalRows);
  assert.equal(deleteCalled, false);
  assert.equal(restoreFailures, 0);
});

test("restores selected sheet rows when the database transaction fails at commit", async () => {
  const originalRows = [
    ["event_id", "session_key"],
    ["closed-event", "closed-session"],
    ["malformed", "", "unrelated"],
  ];
  const originalDatabase = {
    sessions: ["closed-session", "current-session"],
    events: ["closed-event", "current-event"],
  };
  let database = structuredClone(originalDatabase);
  let sheetRows = originalRows.map((row) => [...row]);
  const rollback = createLiveActivitySheetRollbackGuard(() => {});

  const failingTransaction = async (operation) => {
    const stagedDatabase = structuredClone(database);
    await operation({
      deleteEvents(eventIds) {
        stagedDatabase.events = stagedDatabase.events.filter(
          (eventId) => !eventIds.has(eventId),
        );
      },
      deleteSession(sessionKey) {
        stagedDatabase.sessions = stagedDatabase.sessions.filter(
          (key) => key !== sessionKey,
        );
      },
    });
    throw new Error("Database commit failed");
  };

  await assert.rejects(
    rollback.run(() =>
      failingTransaction(async (tx) => {
        await deleteLiveActivitySessionSafely({
          session: { status: "ended" },
          backupId: "a".repeat(64),
          currentBackupId: "a".repeat(64),
          environment: "production",
          rows: originalRows,
          sessionKey: "closed-session",
          eventIds: new Set(["closed-event"]),
          selectRanges: liveLedgerSheetRowRangesForSession,
          onMutationStarted: () => {
            rollback.markMutationStarted(originalRows, async (rows) => {
              sheetRows = rows;
            });
          },
          async clearRanges(ranges) {
            for (const [startRow, endRow] of ranges) {
              for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
                sheetRows[rowNumber - 1] = Array(15).fill("");
              }
            }
          },
          deleteEvents: async (eventIds) => tx.deleteEvents(eventIds),
          deleteSession: async (sessionKey) => tx.deleteSession(sessionKey),
        });
      }),
    ),
    /Database commit failed/,
  );

  assert.deepEqual(database, originalDatabase);
  assert.deepEqual(sheetRows, originalRows);
});

test("uses Melbourne calendar dates across midnight", () => {
  assert.equal(liveLedgerSessionDate(new Date("2026-05-01T13:59:59.000Z")), "2026-05-01");
  assert.equal(liveLedgerSessionDate(new Date("2026-05-01T14:00:00.000Z")), "2026-05-02");
});

test("formats mirrored timestamps with the Melbourne UTC offset, including daylight saving", () => {
  assert.equal(
    formatLiveLedgerTimestamp(new Date("2026-05-01T13:00:00.123Z")),
    "2026-05-01T23:00:00.123+10:00",
  );
  assert.equal(
    formatLiveLedgerTimestamp(new Date("2026-01-01T00:00:00.000Z")),
    "2026-01-01T11:00:00.000+11:00",
  );
});

test("parses locale-formatted Sheets timestamps as Melbourne time", () => {
  assert.equal(
    parseMelbourneTimestamp("1/5/2026 11:00 pm")?.toISOString(),
    "2026-05-01T13:00:00.000Z",
  );
  assert.equal(
    parseMelbourneTimestamp("1/1/2026 11:00 pm")?.toISOString(),
    "2026-01-01T12:00:00.000Z",
  );
  assert.equal(parseMelbourneTimestamp("31/02/2026 11:00 pm"), null);
  assert.equal(parseMelbourneTimestamp("4/10/2026 2:30 am"), null);
});

test("an open ledger stays current after its Melbourne session date changes", () => {
  const previousDayOpen = { sessionDate: "2026-05-01", status: "open" };
  const todayClosed = { sessionDate: "2026-05-02", status: "ended" };
  assert.equal(resolveCurrentLiveSession(previousDayOpen, todayClosed), previousDayOpen);
  assert.equal(resolveCurrentLiveSession(null, todayClosed), todayClosed);
});

test("normalizes Google Sheets date serials to ISO session dates", () => {
  assert.equal(normalizeGoogleSheetsDate(46288), "2026-09-23");
  assert.equal(normalizeGoogleSheetsDate("46288"), "2026-09-23");
});

test("keeps valid ISO session dates and rejects invalid values", () => {
  assert.equal(normalizeGoogleSheetsDate("2026-09-23"), "2026-09-23");
  assert.equal(normalizeGoogleSheetsDate("2026-02-30"), null);
  assert.equal(normalizeGoogleSheetsDate("not a date"), null);
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
