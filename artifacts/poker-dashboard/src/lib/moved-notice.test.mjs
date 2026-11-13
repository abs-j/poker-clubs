import assert from "node:assert/strict";
import test from "node:test";

import { afterJoinPath, clearMovedFrom, joinCarrySearch, movedFromParam, readMovedFrom, rememberMovedFrom } from "./moved-notice.ts";

function memoryStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test("reads only a short slug as the old site", () => {
  assert.equal(movedFromParam("?from=monash"), "monash");
  assert.equal(movedFromParam("?from=Monash"), "monash");
  assert.equal(movedFromParam("?from=https://evil.example"), null);
  assert.equal(movedFromParam("?from="), null);
  assert.equal(movedFromParam(""), null);
});

test("opens the live ledger after joining only for next=live", () => {
  assert.equal(afterJoinPath("?from=monash&next=live"), "/dashboard?view=live");
  assert.equal(afterJoinPath("?next=https://evil.example"), "/dashboard");
  assert.equal(afterJoinPath("?next=//evil.example"), "/dashboard");
  assert.equal(afterJoinPath(""), "/dashboard");
});

test("keeps from and next through sign-up and drops everything else", () => {
  assert.equal(joinCarrySearch("?from=monash&next=live&x=1"), "?from=monash&next=live");
  assert.equal(joinCarrySearch("?next=other"), "");
  assert.equal(joinCarrySearch(""), "");
});

test("remembers the old site until cleared, and survives blocked storage", () => {
  const store = memoryStore();
  assert.equal(readMovedFrom(store), null);
  rememberMovedFrom("monash", store);
  assert.equal(readMovedFrom(store), "monash");
  clearMovedFrom(store);
  assert.equal(readMovedFrom(store), null);

  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  rememberMovedFrom("monash", blocked);
  assert.equal(readMovedFrom(blocked), null);
  clearMovedFrom(null);
});
