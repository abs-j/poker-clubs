import assert from "node:assert/strict";
import test from "node:test";

import { completedMonthKeys, dismissMonth, monthTitle, parseLocalDate, readDismissedMap, resolveAsOf } from "./wrapped.ts";

test("only months before the current local month count, newest first", () => {
  const asOf = new Date(2026, 9, 28, 12);
  assert.deepEqual(completedMonthKeys(["2026-08-02", "2026-09-30", "2026-10-03", "2026-09-04"], asOf), ["2026-09", "2026-08"]);
  assert.deepEqual(completedMonthKeys(["2026-10-03"], asOf), []);
  assert.deepEqual(completedMonthKeys(["2026-10-03"], new Date(2026, 10, 1, 9)), ["2026-10"]);
});

test("the dev date override is ignored in production builds", () => {
  const now = new Date(2026, 10, 2, 9);
  assert.equal(resolveAsOf("?asOf=2026-12-25", false, now), now);
  assert.equal(resolveAsOf("?asOf=2026-12-25", true, now).getMonth(), 11);
  assert.equal(resolveAsOf("?asOf=2026-02-31", true, now), now);
  assert.equal(parseLocalDate("not a date"), null);
});

test("months read as words and dismissals are tidy", () => {
  assert.equal(monthTitle("2026-10"), "October 2026");
  assert.deepEqual(dismissMonth(["2026-09"], "2026-10"), ["2026-09", "2026-10"]);
  assert.deepEqual(dismissMonth(["2026-09"], "2026-09"), ["2026-09"]);
  assert.deepEqual(dismissMonth([], "bad"), []);
  assert.deepEqual(readDismissedMap('{"ana":["2026-09","x"],"ben":"no"}'), { ana: ["2026-09"] });
  assert.deepEqual(readDismissedMap("{not json"), {});
});
