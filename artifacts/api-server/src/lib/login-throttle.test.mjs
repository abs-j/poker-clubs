import assert from "node:assert/strict";
import test from "node:test";

import { applyFailure, describeWait, secondsUntilUnblocked } from "./login-throttle-logic.ts";

const limit = { maxFailures: 3, windowMs: 60_000, blockMs: 120_000 };

test("failures accumulate and block on the limit", () => {
  let state = null;
  for (let i = 0; i < 2; i++) state = applyFailure(state, 1_000 + i, limit);
  assert.equal(state.failures, 2);
  assert.equal(secondsUntilUnblocked(state, 2_000), 0);
  state = applyFailure(state, 3_000, limit);
  assert.equal(state.failures, 3);
  assert.equal(secondsUntilUnblocked(state, 3_000), 120);
  assert.equal(secondsUntilUnblocked(state, 3_000 + 60_000), 60);
  assert.equal(secondsUntilUnblocked(state, 3_000 + 120_000), 0);
});

test("an old window starts again from one", () => {
  const old = { failures: 2, windowStartedAt: 0, blockedUntil: 0 };
  const next = applyFailure(old, 61_000, limit);
  assert.equal(next.failures, 1);
  assert.equal(next.windowStartedAt, 61_000);
});

test("wait times read naturally", () => {
  assert.equal(describeWait(1), "1 second");
  assert.equal(describeWait(40), "40 seconds");
  assert.equal(describeWait(60), "1 minute");
  assert.equal(describeWait(61), "2 minutes");
  assert.equal(describeWait(900), "15 minutes");
});
