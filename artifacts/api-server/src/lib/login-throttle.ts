// Sign-in rate limiting. The decision logic is pure so it can be tested; the database
// functions below keep the counters across restarts and across server instances.
import { eq, lt } from "drizzle-orm";
import { db, loginThrottle } from "@workspace/db";

import {
  ADMIN_LIMITS,
  MEMBER_LIMITS,
  applyFailure,
  describeWait,
  secondsUntilUnblocked,
  type ThrottleLimit,
  type ThrottleState,
} from "./login-throttle-logic";

export { ADMIN_LIMITS, MEMBER_LIMITS, describeWait };

async function readState(key: string): Promise<ThrottleState | null> {
  const [row] = await db.select().from(loginThrottle).where(eq(loginThrottle.key, key)).limit(1);
  if (!row) return null;
  return {
    failures: row.failures,
    windowStartedAt: row.windowStartedAt.getTime(),
    blockedUntil: row.blockedUntil?.getTime() ?? 0,
  };
}

/** Seconds the caller must wait, taking the longest block across the given keys. */
export async function retryAfterSeconds(keys: string[]): Promise<number> {
  const now = Date.now();
  const waits = await Promise.all(keys.map(async (key) => secondsUntilUnblocked(await readState(key), now)));
  return Math.max(0, ...waits);
}

/** Records a failure against each key and returns each key's new failure count, in order. */
export async function recordFailure(entries: Array<{ key: string; limit: ThrottleLimit }>): Promise<number[]> {
  const now = Date.now();
  const counts: number[] = [];
  for (const { key, limit } of entries) {
    const next = applyFailure(await readState(key), now, limit);
    counts.push(next.failures);
    const values = {
      failures: next.failures,
      windowStartedAt: new Date(next.windowStartedAt),
      blockedUntil: next.blockedUntil ? new Date(next.blockedUntil) : null,
    };
    await db
      .insert(loginThrottle)
      .values({ key, ...values })
      .onConflictDoUpdate({ target: loginThrottle.key, set: values });
  }
  return counts;
}

export async function clearFailures(keys: string[]): Promise<void> {
  for (const key of keys) await db.delete(loginThrottle).where(eq(loginThrottle.key, key));
}

/** Drops counters whose block and window have both ended, so the table stays small. */
export async function pruneThrottle(olderThanMs = 24 * 60 * 60_000): Promise<void> {
  await db.delete(loginThrottle).where(lt(loginThrottle.windowStartedAt, new Date(Date.now() - olderThanMs)));
}
