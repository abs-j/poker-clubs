import assert from "node:assert/strict";
import test from "node:test";
import { nightFingerprint, parseDate, parseDelimited, parseHistory, parseMoney, sheetExportUrl } from "./import-parse.ts";

test("money in the formats a spreadsheet produces", () => {
  assert.equal(parseMoney("$1,234.50"), 1234.5);
  assert.equal(parseMoney("(20.00)"), -20);
  assert.equal(parseMoney("-$5"), -5);
  assert.equal(parseMoney("−3.5"), -3.5);
  assert.equal(parseMoney(""), 0);
  assert.equal(parseMoney("-"), 0);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney("12.3.4"), null);
});

test("dates in the formats people type", () => {
  assert.equal(parseDate("13/03/2026"), "2026-03-13");
  assert.equal(parseDate("3/4/26"), "2026-04-03");
  assert.equal(parseDate("3/4/26", "mdy"), "2026-03-04");
  assert.equal(parseDate("2026-03-13"), "2026-03-13");
  assert.equal(parseDate("2026/3/9"), "2026-03-09");
  assert.equal(parseDate("13 Mar 2026"), "2026-03-13");
  assert.equal(parseDate("March 13th, 2026"), "2026-03-13");
  assert.equal(parseDate("Fri 13/03/2026"), "2026-03-13");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("soon"), null);
});

test("quoted cells, commas inside quotes, CRLF and tab-separated paste", () => {
  assert.deepEqual(parseDelimited('a,"b,c","d ""q"""\r\n1,2,3'), [["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  assert.deepEqual(parseDelimited("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseDelimited("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
});

test("a sheet where the date is only on the first row of each night", () => {
  const text = [
    ",,,,",
    "Date,Player,Buy-in,Cash-out,Net",
    "13/03/2026,Rhys,$20.00,$53.75,$33.75",
    ",Wes,$10.00,$0.00,-$10.00",
    ",Alex,$10.00,$33.05,$23.05",
    ",Total,$40.00,$86.80,",
    "14/03/2026,Rhys,$10.00,$0.00,-$10.00",
    ",Wes,$10.00,$20.00,$10.00",
  ].join("\n");
  const result = parseHistory(text);
  assert.equal(result.error, undefined);
  assert.equal(result.nights.length, 2);
  assert.deepEqual(result.nights[0].players.map((p) => p.name), ["Rhys", "Wes", "Alex"]);
  assert.equal(result.nights[1].date, "2026-03-14");
  assert.equal(result.rowsRead, 5);
  // Night one is unbalanced (40 in, 86.80 out): the import warns but still reads it.
  assert.ok(result.warnings.some((w) => w.includes("2026-03-13") && w.includes("differ")));
});

test("a flat export with the date on every row groups by date", () => {
  const text = "Date,Player,Buy In,Cash Out\n2026-03-13,A,10,5\n2026-03-13,B,10,15\n2026-03-20,A,10,10\n2026-03-20,B,10,10";
  const result = parseHistory(text);
  assert.equal(result.nights.length, 2);
  assert.equal(result.nights[0].players.length, 2);
});

test("the same player twice on one date starts a second night", () => {
  const text = "Date,Player,Buy-in,Cash-out\n2026-03-13,A,10,5\n2026-03-13,B,10,15\n2026-03-13,A,10,15\n2026-03-13,B,10,5";
  const result = parseHistory(text);
  assert.equal(result.nights.length, 2);
});

test("columns can be in any order and extra columns are ignored", () => {
  const text = "Notes,Cash-out,Player,Date,Buy-in\nx,30,Sam,2026-05-01,20";
  const result = parseHistory(text);
  assert.deepEqual(result.nights[0].players[0], { name: "Sam", buyIn: 20, cashOut: 30 });
});

test("day-first dates by default, month-first on request", () => {
  const text = "Date,Player,Buy-in,Cash-out\n03/04/2026,A,10,10";
  assert.equal(parseHistory(text).nights[0].date, "2026-04-03");
  assert.equal(parseHistory(text, { dateOrder: "mdy" }).nights[0].date, "2026-03-04");
});

test("bad rows are skipped with a reason, not guessed at", () => {
  const text = "Date,Player,Buy-in,Cash-out,Net\nsoon,A,10,10,\n2026-03-13,B,ten,10,\n2026-03-13,C,10,10,5\n2026-03-13,D,0,0,";
  const result = parseHistory(text);
  assert.equal(result.nights.length, 1);
  assert.deepEqual(result.nights[0].players.map((p) => p.name), ["C"]);
  assert.ok(result.warnings.some((w) => w.includes("couldn't read the date")));
  assert.ok(result.warnings.some((w) => w.includes("amounts for B")));
  assert.ok(result.warnings.some((w) => w.includes("Net doesn't match")));
});

test("clear errors for empty input and missing headings", () => {
  assert.match(parseHistory("   ").error, /Paste/);
  assert.match(parseHistory("A,B,C\n1,2,3").error, /columns/);
});

test("identical nights have the same fingerprint regardless of order or case", () => {
  const one = { date: "2026-03-13", players: [{ name: "Sam", buyIn: 10, cashOut: 5 }, { name: "Al", buyIn: 10, cashOut: 15 }] };
  const two = { date: "2026-03-13", players: [{ name: "al ", buyIn: 10, cashOut: 15 }, { name: "SAM", buyIn: 10, cashOut: 5 }] };
  assert.equal(nightFingerprint(one), nightFingerprint(two));
  assert.notEqual(nightFingerprint(one), nightFingerprint({ ...one, date: "2026-03-14" }));
});

test("only Google Sheets links become export addresses", () => {
  const id = "10COQnx6Rd_KzLNsxwZCqd6GDnUXy4GBGYPhRas_msyw";
  assert.equal(
    sheetExportUrl(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=2039085069`),
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=2039085069`,
  );
  assert.equal(sheetExportUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`)?.endsWith("gid=0"), true);
  assert.equal(sheetExportUrl("https://evil.example/spreadsheets/d/" + id), null);
  assert.equal(sheetExportUrl("http://docs.google.com/spreadsheets/d/" + id), null);
  assert.equal(sheetExportUrl("file:///etc/passwd"), null);
});

test("rows that are not people are skipped, and the import says so", () => {
  const text = "Date,Player,Buy-in,Cash-out\n2026-03-13,Sam,10,10\n,Bad Beat Jackpot,5,0\n,Balance (Hide),0,3\n,Adj,1,1\n,Al,10,10\n,Grand Total,25,24";
  const result = parseHistory(text);
  assert.deepEqual(result.nights[0].players.map((p) => p.name), ["Sam", "Al"]);
  assert.ok(result.warnings.some((w) => w.includes("Bad Beat Jackpot") && w.includes("Balance (Hide)")));
});

test("a jackpot row that balances the night is not reported as a gap", () => {
  const text = "Date,Player,Buy-in,Cash-out\n2026-10-06,Sam,20,15\n,Al,10,7.75\n,Bad Beat Jackpot,0,7.25";
  const result = parseHistory(text);
  assert.deepEqual(result.nights[0].players.map((p) => p.name), ["Sam", "Al"]);
  assert.ok(!result.warnings.some((w) => w.includes("differ by")));
});

test("a night that is out by more than its jackpot row still warns, by the remaining amount", () => {
  const text = "Date,Player,Buy-in,Cash-out\n2026-10-06,Sam,20,10\n,Al,10,7.75\n,Bad Beat Jackpot,0,7.25";
  const result = parseHistory(text);
  assert.ok(result.warnings.some((w) => w.includes("differ by $5.00")));
});

test("a second row for the same person on a night is a rebuy and is added up quietly", () => {
  const text = "Date,Player,Buy-in,Cash-out\n2026-03-13,Sam,10,0\n,Al,10,25\n,Sam,10,5";
  const result = parseHistory(text);
  assert.deepEqual(result.nights[0].players[0], { name: "Sam", buyIn: 20, cashOut: 5 });
  assert.deepEqual(result.warnings, []);
});

test("one unreadable date gives one warning, not one per row beneath it", () => {
  const text = "Date,Player,Buy-in,Cash-out\nAPL Game,A,10,10\n,B,10,10\n,C,10,10\n2026-03-13,D,10,10\n,E,10,10";
  const result = parseHistory(text);
  assert.equal(result.warnings.filter((w) => w.includes("APL Game")).length, 1);
  assert.equal(result.warnings.filter((w) => w.includes("no date above")).length, 0);
  assert.equal(result.nights.length, 1);
});
