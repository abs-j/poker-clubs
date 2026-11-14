import test from "node:test";
import assert from "node:assert/strict";
import { balanceGap, shareShortfall } from "./record-night.ts";

test("gap direction and size, ignoring blank rows", () => {
  assert.deepEqual(balanceGap([{ name: "A", buyIn: "20", cashOut: "30" }, { name: "B", buyIn: "20", cashOut: "10" }, { name: "", buyIn: "99", cashOut: "0" }]), { direction: "balanced", cents: 0 });
  assert.deepEqual(balanceGap([{ name: "A", buyIn: "20", cashOut: "30" }]), { direction: "under", cents: 1000 });
  assert.deepEqual(balanceGap([{ name: "A", buyIn: "$30", cashOut: "20.50" }]), { direction: "over", cents: 950 });
});

test("shortfall is shared evenly and capped at each cash-out", () => {
  assert.deepEqual(shareShortfall([{ name: "A", cashOutCents: 1000 }, { name: "B", cashOutCents: 1000 }], 501), [251, 250]);
  assert.deepEqual(shareShortfall([{ name: "A", cashOutCents: 100 }, { name: "B", cashOutCents: 1000 }], 500), [100, 400]);
  assert.deepEqual(shareShortfall([{ name: "", cashOutCents: 1000 }, { name: "B", cashOutCents: 1000 }], 300), [0, 300]);
});
