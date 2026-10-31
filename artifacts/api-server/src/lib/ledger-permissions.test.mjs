import assert from "node:assert/strict";
import test from "node:test";
import { canEditEntry, canManageExtras, canManageNight, hostOf } from "./ledger-permissions.ts";

const admin = { name: "Ada", isAdmin: true };
const host = { name: "Bo", isAdmin: false };
const author = { name: "Cy", isAdmin: false };
const other = { name: "Dee", isAdmin: false };

test("the host is an explicit hand-over, or whoever started the night", () => {
  assert.equal(hostOf({ hostName: null, startedBy: "Bo" }), "Bo");
  assert.equal(hostOf({ hostName: "  ", startedBy: "Bo" }), "Bo");
  assert.equal(hostOf({ hostName: "Ada", startedBy: "Bo" }), "Ada");
});

test("an admin or the host can manage a night, including when the name differs only by case", () => {
  assert.equal(canManageNight(admin, "Bo"), true);
  assert.equal(canManageNight({ name: " bo ", isAdmin: false }, "Bo"), true);
  assert.equal(canManageNight(host, "Bo"), true);
  assert.equal(canManageNight(other, "Bo"), false);
  assert.equal(canManageNight({ name: "", isAdmin: false }, "Bo"), false);
  assert.equal(canManageNight({ name: "Bo", isAdmin: false }, ""), false);
});

test("an entry can be changed by its author, the host, or an admin", () => {
  assert.equal(canEditEntry(author, "Bo", "Cy"), true);
  assert.equal(canEditEntry({ name: " cy ", isAdmin: false }, "Bo", "Cy"), true);
  assert.equal(canEditEntry(host, "Bo", "Cy"), true);
  assert.equal(canEditEntry(admin, "Bo", "Cy"), true);
  assert.equal(canEditEntry(other, "Bo", "Cy"), false);
  assert.equal(canEditEntry(other, "Dee", "Cy"), true);
});

test("jackpot payouts and tournaments: admin always, otherwise the host of an open or ended night", () => {
  assert.equal(canManageExtras(admin, "none", null), true);
  assert.equal(canManageExtras(host, "none", null), false);
  assert.equal(canManageExtras(host, "open", "Bo"), true);
  assert.equal(canManageExtras({ name: " bo ", isAdmin: false }, "ended", "Bo"), true);
  assert.equal(canManageExtras(other, "open", "Bo"), false);
  assert.equal(canManageExtras(other, "ended", "Bo"), false);
});
