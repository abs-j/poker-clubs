import test from "node:test";
import assert from "node:assert/strict";
import {
  CreatePokerLiveActivityBody,
  UpdatePokerLiveActivityBody,
  DeletePokerLiveActivityBody,
  ResetAdminLiveLedgerBody,
} from "../../../../lib/api-zod/src/generated/api.ts";

test("normal live activity entries accept an optional comment", () => {
  assert.equal(
    CreatePokerLiveActivityBody.safeParse({ action: "buy_in", amount: 50 }).success,
    true,
  );
  assert.equal(
    CreatePokerLiveActivityBody.safeParse({
      action: "cash_out",
      amount: 40,
      comment: "Leaving early",
    }).success,
    true,
  );
});

test("edits and deletes require a comment within the supported length", () => {
  assert.equal(
    UpdatePokerLiveActivityBody.safeParse({
      action: "buy_in",
      amount: 60,
    }).success,
    false,
  );
  assert.equal(
    UpdatePokerLiveActivityBody.safeParse({
      action: "buy_in",
      amount: 60,
      comment: "Corrected amount",
    }).success,
    true,
  );
  assert.equal(DeletePokerLiveActivityBody.safeParse({}).success, false);
  assert.equal(
    DeletePokerLiveActivityBody.safeParse({ comment: "Duplicate entry" }).success,
    true,
  );
  assert.equal(
    DeletePokerLiveActivityBody.safeParse({ comment: "x".repeat(501) }).success,
    false,
  );
});

test("admin ledger reset requires a fresh backup hash and exact confirmation", () => {
  assert.equal(
    ResetAdminLiveLedgerBody.safeParse({
      backupId: "a".repeat(64),
      confirmation: "RESET LIVE LEDGER",
    }).success,
    true,
  );
  assert.equal(
    ResetAdminLiveLedgerBody.safeParse({
      backupId: "not-a-hash",
      confirmation: "RESET LIVE LEDGER",
    }).success,
    false,
  );
  assert.equal(
    ResetAdminLiveLedgerBody.safeParse({
      backupId: "a".repeat(64),
      confirmation: "reset",
    }).success,
    false,
  );
});