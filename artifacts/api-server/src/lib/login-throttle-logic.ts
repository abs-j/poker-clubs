// Pure sign-in throttling rules (no database), so they can be unit tested.

export type ThrottleState = { failures: number; windowStartedAt: number; blockedUntil: number };
export type ThrottleLimit = { maxFailures: number; windowMs: number; blockMs: number };

/** Applies one more failed attempt to a counter and returns the new state. */
export function applyFailure(previous: ThrottleState | null, now: number, limit: ThrottleLimit): ThrottleState {
  const fresh = !previous || now - previous.windowStartedAt > limit.windowMs;
  const base: ThrottleState = fresh
    ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
    : { ...previous };
  base.failures += 1;
  if (base.failures >= limit.maxFailures) base.blockedUntil = now + limit.blockMs;
  return base;
}

/** Whole seconds until the block ends, or 0 when not blocked. */
export function secondsUntilUnblocked(state: ThrottleState | null, now: number): number {
  if (!state || state.blockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((state.blockedUntil - now) / 1000));
}

/** "12 minutes", "1 minute" or "40 seconds", for the message a member reads. */
export function describeWait(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export const MEMBER_LIMITS = {
  // One phone can only guess a handful of times...
  device: { maxFailures: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
  // ...but a shared campus network must not lock everyone out over a few typos.
  network: { maxFailures: 30, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
} as const;

export const ADMIN_LIMITS = {
  device: { maxFailures: 5, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
  network: { maxFailures: 10, windowMs: 15 * 60_000, blockMs: 30 * 60_000 },
} as const;
