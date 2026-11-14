import test from "node:test";
import assert from "node:assert/strict";
import { checkResolution, parseResolution, resolveBalance } from "./night-balance.ts";

const night = [
  { name: "Ann", buyInCents: 1000, cashOutCents: 3000 },
  { name: "Bo", buyInCents: 2000, cashOutCents: 1500 },
  { name: "Cy", buyInCents: 1000, cashOutCents: 600 },
];
// buy-ins 4000, cash-outs 5100: short by 1100

test("custom deductions take any amount from any players until balanced", () => {
  const resolution = parseResolution({ mode: "custom", deductions: [{ name: "ann", cents: 700 }, { name: "Cy", cents: 400 }] });
  assert.equal(checkResolution(night, resolution), null);
  const out = resolveBalance(night, resolution);
  assert.equal(out.remainingCents, 0);
  assert.deepEqual(out.players.map((p) => p.cashOutCents), [2300, 1500, 200]);
});

test("custom deductions must match the shortfall exactly", () => {
  const less = parseResolution({ mode: "custom", deductions: [{ name: "Ann", cents: 500 }] });
  assert.match(checkResolution(night, less), /less than the shortfall/);
  const more = parseResolution({ mode: "custom", deductions: [{ name: "Ann", cents: 1200 }] });
  assert.match(checkResolution(night, more), /more than the shortfall/);
});

test("custom deductions cannot take more than a player cashed out", () => {
  const over = parseResolution({ mode: "custom", deductions: [{ name: "Cy", cents: 1100 }] });
  assert.match(checkResolution(night, over), /cashed out less/);
  assert.equal(checkResolution(night, parseResolution({ mode: "custom", deductions: [{ name: "Zed", cents: 1100 }] })), "Zed isn't in this night's ledger.");
});

test("malformed custom input is rejected", () => {
  assert.equal(parseResolution({ mode: "custom", deductions: [] }), null);
  assert.equal(parseResolution({ mode: "custom", deductions: [{ name: "Ann", cents: -5 }] }), null);
});
