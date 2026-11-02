import assert from "node:assert/strict";
import test from "node:test";

import { isFirstViewDay, nightSeenId, readSeenStore, seenRecord, withSeen } from "./home-seen.ts";

test("a card shows the first time, stays up that day, and hides the next day", () => {
  assert.equal(isFirstViewDay(null, "cash:4:2026-10-16", "2026-10-17"), true);
  const seen = { id: "cash:4:2026-10-16", day: "2026-10-17" };
  assert.equal(isFirstViewDay(seen, "cash:4:2026-10-16", "2026-10-17"), true);
  assert.equal(isFirstViewDay(seen, "cash:4:2026-10-16", "2026-10-18"), false);
  assert.equal(isFirstViewDay(null, "", "2026-10-17"), false);
});

test("a newer game shows again and a repeat view does not move the day", () => {
  const store = withSeen({}, "c1", "Ana", "cash:4:2026-10-16", "2026-10-17");
  assert.equal(withSeen(store, "c1", "ana", "cash:4:2026-10-16", "2026-10-18"), store);
  const newer = withSeen(store, "c1", "Ana", "cash:5:2026-10-23", "2026-10-24");
  assert.deepEqual(seenRecord(newer, "c1", "Ana"), { id: "cash:5:2026-10-23", day: "2026-10-24" });
});

test("each club and each member remembers their own game", () => {
  let store = withSeen({}, "c1", "Ana", "cash:1:2026-10-01", "2026-10-02");
  store = withSeen(store, "c2", "Ana", "cash:7:2026-10-05", "2026-10-06");
  store = withSeen(store, "c1", "Ben", "cash:9:2026-10-09", "2026-10-09");
  assert.equal(seenRecord(store, "c1", "Ana")?.id, "cash:1:2026-10-01");
  assert.equal(seenRecord(store, "c2", "Ana")?.id, "cash:7:2026-10-05");
  assert.equal(seenRecord(store, "c2", "Ben"), null);
});

test("broken storage is ignored and tournaments get their own id", () => {
  assert.deepEqual(readSeenStore("not json"), {});
  assert.deepEqual(readSeenStore('{"c1|ana":{"id":1,"day":"nope"}}'), {});
  const raw = JSON.stringify({ "c1|ana": { id: "cash:1:2026-10-01", day: "2026-10-02" } });
  assert.equal(seenRecord(readSeenStore(raw), "c1", "Ana")?.day, "2026-10-02");
  assert.equal(nightSeenId({ sessionNumber: 4, date: "2026-10-09", isTournament: false, net: 5 }), "cash:4:2026-10-09");
  assert.equal(nightSeenId({ sessionNumber: 4, date: "2026-10-09", isTournament: true, net: 5 }), "tournament:2026-10-09:5");
});
