// Pure jackpot maths: contributed surplus minus payouts. Kept free of the database so tests can run alone.

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export type JackpotPayoutView = {
  id: number;
  player: string;
  amount: number;
  at: string;
  by: string;
};

export type JackpotSummary = {
  /** What's left in the pot, in dollars. */
  total: number;
  /** How many nights closed with a surplus that fed the pot. */
  nights: number;
  /** All surplus that ever went in, in dollars. */
  contributed: number;
  /** All payouts so far, in dollars. */
  paidOut: number;
  payouts: JackpotPayoutView[];
};

/** Dollars on the wire from cent totals. */
export function jackpotFromCents(
  contributedCents: number,
  paidOutCents: number,
  nights: number,
  payouts: JackpotPayoutView[],
): JackpotSummary {
  const contributed = round2(Math.max(0, contributedCents) / 100);
  const paidOut = round2(Math.max(0, paidOutCents) / 100);
  return {
    total: round2(contributed - paidOut),
    nights,
    contributed,
    paidOut,
    payouts,
  };
}

/** Accepts a dollars string/number from the form; returns whole cents or null. */
export function parsePayoutAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(text.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/** Why a payout can't be recorded, or null when it's fine. amountCents and availableCents are whole cents. */
export function validateJackpotPayout(amountCents: number, availableCents: number): string | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "Enter an amount greater than zero.";
  if (amountCents > availableCents) return "That is more than the jackpot has left.";
  return null;
}
