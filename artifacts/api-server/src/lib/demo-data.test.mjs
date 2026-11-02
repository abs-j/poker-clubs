import assert from "node:assert/strict";
import test from "node:test";

import { buildDemoDashboard, DEMO_PLAYERS, DEMO_VIEWER } from "../../../poker-dashboard/src/demo/data.ts";
import { GetPokerDashboardResponse } from "../../../../lib/api-zod/src/generated/api.ts";

test("the demo payload passes the same schema the real dashboard does", () => {
  const dashboard = buildDemoDashboard(new Date(2026, 10, 2));
  const parsed = GetPokerDashboardResponse.safeParse(dashboard);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3)));
  assert.ok(dashboard.sessions.length > 25);
  assert.equal(dashboard.tournaments.length, 3);
  assert.ok(dashboard.leaderboard.some((row) => row.name === DEMO_VIEWER));
});

test("every night balances and the demo is deterministic and relative to today", () => {
  const a = buildDemoDashboard(new Date(2026, 10, 2));
  const b = buildDemoDashboard(new Date(2026, 10, 2));
  assert.deepEqual(a.sessions, b.sessions);
  for (const session of a.sessions) assert.ok(Math.abs(session.totalBuyIn - session.totalCashOut) < 0.01, session.date);
  const later = buildDemoDashboard(new Date(2027, 5, 20));
  assert.ok(later.sessions.at(-1).date > a.sessions.at(-1).date);
  assert.ok(new Set(DEMO_PLAYERS.map((p) => p.name)).size === DEMO_PLAYERS.length);
});
