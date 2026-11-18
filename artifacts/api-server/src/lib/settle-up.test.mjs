import assert from "node:assert/strict";
import test from "node:test";
import { mineUnsettled, nightState, settleLines, waitingPayers } from "./settle-up.ts";
import { canSettle } from "./ledger-permissions.ts";

const results = [
  { playerId: 1, name: "Ann", netCents: 2500 },
  { playerId: 2, name: "Ben", netCents: -1500 },
  { playerId: 3, name: "Cat", netCents: -1000 },
  { playerId: 4, name: "Dan", netCents: 0 },
];
const mark = { settledAt: new Date("2026-10-31T10:00:00Z"), settledBy: "Ann" };

test("lines are listed biggest winner first, and a player who broke even is settled", () => {
  const lines = settleLines(results, new Map());
  assert.deepEqual(lines.map((line) => line.name), ["Ann", "Dan", "Cat", "Ben"]);
  assert.equal(lines.find((line) => line.name === "Dan").settled, true);
  assert.equal(lines.find((line) => line.name === "Ben").settled, false);
});

test("a ticked player records who ticked and when", () => {
  const lines = settleLines(results, new Map([[2, mark]]));
  const ben = lines.find((line) => line.name === "Ben");
  assert.equal(ben.settled, true);
  assert.equal(ben.settledBy, "Ann");
  assert.equal(ben.settledAt, "2026-10-31T10:00:00.000Z");
});

test("the night is open, partial, then settled as players are ticked", () => {
  assert.equal(nightState(settleLines(results, new Map())), "open");
  assert.equal(nightState(settleLines(results, new Map([[2, mark]]))), "partial");
  assert.equal(nightState(settleLines(results, new Map([[1, mark], [2, mark], [3, mark]]))), "settled");
});

test("a night where everyone broke even has nothing to settle", () => {
  const even = settleLines([{ playerId: 1, name: "Ann", netCents: 0 }, { playerId: 2, name: "Ben", netCents: 0 }], new Map());
  assert.equal(nightState(even), "none");
  assert.equal(nightState([]), "none");
});

test("what a person owes and is owed counts only their unsettled nights, newest first", () => {
  const nights = [
    { nightId: 1, date: "2026-10-01", bank: "Ann", lines: settleLines(results, new Map()) },
    { nightId: 2, date: "2026-10-08", bank: null, lines: settleLines(results, new Map([[2, mark]])) },
    { nightId: 3, date: "2026-10-15", bank: "Cat", lines: settleLines([{ playerId: 2, name: "ben", netCents: 700 }], new Map()) },
  ];
  const ben = mineUnsettled(nights, " BEN ");
  assert.deepEqual(ben.owe.map((entry) => entry.nightId), [1]);
  assert.deepEqual(ben.owed.map((entry) => entry.nightId), [3]);
  assert.equal(ben.oweCents, 1500);
  assert.equal(ben.owedCents, 700);
  assert.equal(ben.owe[0].bank, "Ann");

  const ann = mineUnsettled(nights, "Ann");
  assert.equal(ann.owedCents, 5000);
  assert.equal(ann.oweCents, 0);
  assert.deepEqual(mineUnsettled(nights, "Dan"), { owe: [], owed: [], oweCents: 0, owedCents: 0 });
  assert.deepEqual(mineUnsettled(nights, ""), { owe: [], owed: [], oweCents: 0, owedCents: 0 });
});

test("the host, the bank and an admin can tick; nobody else can", () => {
  assert.equal(canSettle({ name: "Bo", isAdmin: false }, "Bo", null), true);
  assert.equal(canSettle({ name: " ann ", isAdmin: false }, "Bo", "Ann"), true);
  assert.equal(canSettle({ name: "Ada", isAdmin: true }, "Bo", null), true);
  assert.equal(canSettle({ name: "Cy", isAdmin: false }, "Bo", "Ann"), false);
  assert.equal(canSettle({ name: "Cy", isAdmin: false }, "Bo", null), false);
  assert.equal(canSettle({ name: "", isAdmin: false }, "Bo", ""), false);
});

test("waitingPayers lists unticked losers, biggest debt first, and skips settled, winners and even players", () => {
  const lines = settleLines(results, new Map([[3, mark]]));
  assert.deepEqual(waitingPayers(lines), [{ name: "Ben", cents: 1500 }]);
  assert.deepEqual(waitingPayers(settleLines(results, new Map())), [
    { name: "Ben", cents: 1500 },
    { name: "Cat", cents: 1000 },
  ]);
  assert.deepEqual(waitingPayers(settleLines(results, new Map([[2, mark], [3, mark]]))), []);
});
