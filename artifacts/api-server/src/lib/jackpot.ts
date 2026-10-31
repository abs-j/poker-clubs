// How much of the bad beat jackpot is still unpaid. Pure, so the rules can be tested without a database.
import { parseMoney } from "./import-parse.ts";

/** Surplus recorded on nights, minus what has already been paid out, in cents. */
export function remainingJackpotCents(contributedCents: number, paidCents: number): number {
  return contributedCents - paidCents;
}

/**
 * Turns a form amount into whole cents that fit in the pot still held.
 * `raw` is dollars: a number, or text such as "4" or "4.50".
 */
export function payoutCents(raw: unknown, remainingCents: number): { cents: number } | { error: string } {
  const dollars = typeof raw === "number"
    ? (Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null)
    : typeof raw === "string"
      ? parseMoney(raw)
      : null;
  if (dollars === null) return { error: "Enter an amount like 4 or 4.50." };
  const cents = Math.round(dollars * 100);
  if (cents <= 0) return { error: "Enter an amount greater than zero." };
  if (remainingCents <= 0) return { error: "The jackpot is empty." };
  if (cents > remainingCents) return { error: "That is more than the jackpot holds." };
  return { cents };
}
