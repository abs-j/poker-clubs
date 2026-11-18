import assert from "node:assert/strict";
import test from "node:test";

import { editDistance, filterPeople, firstGameFlags, looksLikeJunk, peopleCounts, suggestDuplicates } from "./admin-people.ts";

const p = (playerId, name, role = null, played = 0) => ({ playerId, name, role, played });

test("editDistance caps early", () => {
  assert.equal(editDistance("sadeesha", "sadesha", 1), 1);
  assert.equal(editDistance("abc", "xyz", 1), 2);
});

test("suggests likely duplicates and keeps the name with more history", () => {
  const hints = suggestDuplicates([
    p(1, "Sadeesha", null, 12),
    p(2, "Sadesha", null, 2),
    p(3, "Scout", null, 1),
    p(4, "Scoutt", null, 5),
    p(5, "Jackie", null, 9),
    p(6, "Jackie 2", null, 1),
    p(7, "Max", null, 4),
    p(8, "Mia", null, 4),
  ]);
  const pairs = hints.map((h) => `${h.keep.name}<-${h.merge.name}`).sort();
  assert.deepEqual(pairs, ["Jackie<-Jackie 2", "Sadeesha<-Sadesha", "Scoutt<-Scout"]);
});

test("never suggests merging away a joined account", () => {
  const hints = suggestDuplicates([p(1, "Vedant", "member", 3), p(2, "Vedantt", null, 9)]);
  assert.deepEqual(hints.map((h) => `${h.keep.name}<-${h.merge.name}`), ["Vedant<-Vedantt"]);
  assert.equal(suggestDuplicates([p(1, "Vedant", "member"), p(2, "Vedent", "member")]).length, 0);
});

test("flags junk names", () => {
  assert.equal(looksLikeJunk(p(1, "asd")), true);
  assert.equal(looksLikeJunk(p(2, "Bad beat jackpot cr")), true);
  assert.equal(looksLikeJunk(p(3, "bad beat")), true);
  assert.equal(looksLikeJunk(p(4, "Ben", "member", 10)), false);
});

test("filters and counts", () => {
  const people = [p(1, "Abhay", "owner"), p(2, "Ben", "member"), p(3, "Gobi", "admin"), p(4, "Toby")];
  assert.deepEqual(peopleCounts(people), { all: 4, admins: 2, members: 1, unjoined: 1 });
  assert.deepEqual(filterPeople(people, "", "admins").map((x) => x.name), ["Abhay", "Gobi"]);
  assert.deepEqual(filterPeople(people, "to", "unjoined").map((x) => x.name), ["Toby"]);
  assert.deepEqual(filterPeople(people, "BE", "all").map((x) => x.name), ["Ben"]);
});

test("short names with few games are flagged", () => {
  const pairs = suggestDuplicates([p(1, "Shiv", "member", 20), p(2, "Shivv", null, 1), p(3, "Shivam", null, 1)])
    .map((h) => `${h.keep.name}<-${h.merge.name}`)
    .sort();
  assert.deepEqual(pairs, ["Shiv<-Shivam", "Shiv<-Shivv"]);
  // Two established short names are left alone.
  assert.equal(suggestDuplicates([p(1, "Ben", null, 30), p(2, "Bex", null, 30)]).length, 0);
  assert.equal(suggestDuplicates([p(1, "Shiv", null, 30), p(2, "Shivam", null, 30)]).length, 0);
});

test("a first game is flagged when it resembles an established name", () => {
  const people = [p(1, "Shiv", "member", 20), p(2, "Ben", "member", 15), p(3, "Toby", null, 8)];
  const flags = firstGameFlags(["Shivv", "ben", "Zed", "Toby", " shivv "], people);
  assert.deepEqual(flags.map((f) => [f.name, f.isNew, f.matches.map((m) => m.name)]), [["Shivv", true, ["Shiv"]]]);
});

test("a roster name with no games yet is flagged but one with games is not", () => {
  const people = [p(1, "Sadeesha", null, 12), p(2, "Sadesha", null, 0), p(3, "Sadeesh", null, 4)];
  const flags = firstGameFlags(["Sadesha", "Sadeesh"], people);
  assert.deepEqual(flags.map((f) => [f.name, f.isNew]), [["Sadesha", false]]);
});
