import assert from "node:assert/strict";
import test from "node:test";
import { pickYear, yearsOf } from "./years.ts";

test("years come from the dates, oldest first, without duplicates", () => {
  assert.deepEqual(yearsOf(["2026-03-01", "2025-11-02", "2026-04-05", "bad"]), [2025, 2026]);
  assert.deepEqual(yearsOf([]), []);
});

test("a club with one year of history always shows everything", () => {
  assert.equal(pickYear([2026], undefined), "all");
  assert.equal(pickYear([2026], "2026"), "2026");
  assert.equal(pickYear([], undefined), "all");
});

test("a multi-year club defaults to its latest year", () => {
  assert.equal(pickYear([2024, 2025, 2026], undefined), "2026");
  assert.equal(pickYear([2024, 2025, 2026], "junk"), "2026");
  assert.equal(pickYear([2024, 2025, 2026], "1999"), "2026");
});

test("a multi-year club can pick an earlier year or all time", () => {
  assert.equal(pickYear([2024, 2025, 2026], "2025"), "2025");
  assert.equal(pickYear([2024, 2025, 2026], "all"), "all");
});
