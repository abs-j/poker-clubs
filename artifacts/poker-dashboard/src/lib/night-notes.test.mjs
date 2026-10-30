import assert from "node:assert/strict";
import test from "node:test";
import { parseNightNotes } from "./night-notes.ts";

const roster = ["Ann", "Bo Lee", "Cy"];

test("the arrow format from a notes app", () => {
  const { rows, newNames, skipped } = parseNightNotes("Ann - $10 -> $48\nBo Lee - $30 -> $5.10\nCy - $20 -> $0", roster);
  assert.deepEqual(rows, [
    { name: "Ann", buyIn: "10", cashOut: "48" },
    { name: "Bo Lee", buyIn: "30", cashOut: "5.10" },
    { name: "Cy", buyIn: "20", cashOut: "0" },
  ]);
  assert.deepEqual(newNames, []);
  assert.deepEqual(skipped, []);
});

test("a pasted arrow that lost its '>' or became a dash still reads as buy-in then cash-out", () => {
  const { rows } = parseNightNotes("Ann - $40 -$4.55\nBo Lee - $10 - $42.70\nCy- $20 -> $31.25", roster);
  assert.deepEqual(rows.map((r) => [r.name, r.buyIn, r.cashOut]), [["Ann", "40", "4.55"], ["Bo Lee", "10", "42.70"], ["Cy", "20", "31.25"]]);
});

test("names match the roster ignoring case; unknown names are reported, not dropped", () => {
  const { rows, newNames } = parseNightNotes("ann - 10 -> 12\nDee - 10 -> 8", roster);
  assert.equal(rows[0].name, "Ann");
  assert.deepEqual(newNames, ["Dee"]);
});

test("a rebuy written with + or as a second line is added up", () => {
  const { rows } = parseNightNotes("Ann - $20 + $20 -> $50\nCy - 10 -> 0\nCy - 10 -> 25", roster);
  assert.deepEqual(rows, [{ name: "Ann", buyIn: "40", cashOut: "50" }, { name: "Cy", buyIn: "20", cashOut: "25" }]);
});

test("trailing notes in brackets, blank lines and lines without amounts", () => {
  const { rows, skipped } = parseNightNotes("Poker night 30 Oct\n\nAnn - $10 -> $48 (+$38)\nBo Lee: 10 to 0", roster);
  assert.deepEqual(rows.map((r) => [r.name, r.buyIn, r.cashOut]), [["Ann", "10", "48"], ["Bo Lee", "10", "0"]]);
  assert.deepEqual(skipped, ["Poker night 30 Oct"]);
});
