import assert from "node:assert/strict";
import test from "node:test";
import { cleanCurrency, cleanGuidelines, cleanName, cleanTimezone } from "./club-settings-parse.ts";

test("club names are tidied and bounded", () => {
  assert.equal(cleanName("  Friday   Night Poker "), "Friday Night Poker");
  assert.equal(cleanName("A"), null);
  assert.equal(cleanName("x".repeat(61)), null);
  assert.equal(cleanName(5), null);
});

test("currencies must be real ISO codes", () => {
  assert.equal(cleanCurrency("usd"), "USD");
  assert.equal(cleanCurrency("AUD"), "AUD");
  assert.equal(cleanCurrency("US"), null);
  assert.equal(cleanCurrency("ZZZ1"), null);
});

test("timezones must be real", () => {
  assert.equal(cleanTimezone("America/New_York"), "America/New_York");
  assert.equal(cleanTimezone("Australia/Melbourne"), "Australia/Melbourne");
  assert.equal(cleanTimezone("Mars/Olympus"), null);
  assert.equal(cleanTimezone(""), null);
});

test("guidelines are plain text with a length cap; blank clears them", () => {
  assert.equal(cleanGuidelines("  Be kind.\r\nNo phones.  "), "Be kind.\nNo phones.");
  assert.equal(cleanGuidelines("   "), null);
  assert.equal(cleanGuidelines("x".repeat(8001)), undefined);
});
