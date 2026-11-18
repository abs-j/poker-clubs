// Wording for settle-up. Kept free of React and imports so it can be unit tested on its own.

type Line = { name: string; netCents: number };

const dollars = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/** What one player's line says: "Owes $15.00 to Ann", "Is owed $25.00 by Ann", "Holds the cash", or "Even". */
export function settleLineText(line: Line, bank: string | null): string {
  if (line.netCents === 0) return "Even";
  const isBank = !!bank && same(line.name, bank);
  if (line.netCents < 0) return `Owes ${dollars(line.netCents)}${bank && !isBank ? ` to ${bank}` : ""}`;
  return `Is owed ${dollars(line.netCents)}${bank && !isBank ? ` by ${bank}` : ""}`;
}

/** The Games card label for a night: nothing for a night with nothing to settle. */
export function settleBadge(state: "none" | "open" | "partial" | "settled", unsettled: number): string | null {
  if (state === "none") return null;
  if (state === "settled") return "Settled";
  return `${unsettled} to settle`;
}

export function settleTotalText(cents: number): string {
  return dollars(cents);
}

/** "Waiting on Ann $20.00, Bo $5.00 +2 more": who has not paid yet, capped so a long list stays short. */
export function waitingText(waiting: Array<{ name: string; cents: number }>, max = 3): string | null {
  if (waiting.length === 0) return null;
  const shown = waiting.slice(0, max).map((payer) => `${payer.name} ${dollars(payer.cents)}`);
  const more = waiting.length - shown.length;
  return `Waiting on ${shown.join(", ")}${more > 0 ? ` +${more} more` : ""}`;
}
