import assert from "node:assert/strict";
import test from "node:test";
import { nightsToCsv } from "./export-csv.ts";
import { parseHistory } from "./import-parse.ts";

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
