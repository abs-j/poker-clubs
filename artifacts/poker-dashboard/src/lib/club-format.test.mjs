import assert from "node:assert/strict";
import test from "node:test";
import { clubToday, setClubFormat } from "./club-format.ts";

test("today is the date where the club is, not where the browser is", () => {
  const instant = new Date("2026-10-31T14:30:00Z");
  setClubFormat({ timeZone: "Australia/Melbourne" });
  assert.equal(clubToday(instant), "2026-11-01");
  setClubFormat({ timeZone: "America/Los_Angeles" });
  assert.equal(clubToday(instant), "2026-10-31");
  setClubFormat({ timeZone: "Not/AZone" });
  assert.equal(clubToday(instant), "2026-10-31");
  setClubFormat({ timeZone: "Australia/Melbourne" });
});
