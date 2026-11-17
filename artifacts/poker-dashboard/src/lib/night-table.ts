// Totals for the night table (record and edit): cash in, cash out, adjustments, net and the jackpot a surplus produces.
// Pure and free of React so it can be tested on its own.

export type NightTableRow = { name: string; buyIn: string; cashOut: string; adjustment?: string };

const toCents = (value: string | undefined) => {
  const n = Number(String(value ?? "").replace(/[$,\s]/g, "").replace(/[−–—]/g, "-"));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export type NightTotals = {
  inCents: number;
  outCents: number;
  adjustmentCents: number;
  /** Cash out minus cash in plus adjustments: what the players' nets add up to before the jackpot. */
  netCents: number;
};

/** Rows without a name are ignored, the way saving ignores them. */
export function nightTotals(rows: NightTableRow[]): NightTotals {
  const named = rows.filter((row) => row.name.trim());
  const inCents = named.reduce((sum, row) => sum + toCents(row.buyIn), 0);
  const outCents = named.reduce((sum, row) => sum + toCents(row.cashOut), 0);
  const adjustmentCents = named.reduce((sum, row) => sum + toCents(row.adjustment), 0);
  return { inCents, outCents, adjustmentCents, netCents: outCents - inCents + adjustmentCents };
}

/** The jackpot a surplus produces on its own: money left on the table after adjustments, never negative. */
export function suggestedJackpotCents(rows: NightTableRow[]): number {
  return Math.max(0, -nightTotals(rows).netCents);
}

/** What is still unaccounted for once the jackpot is counted: zero means the night balances. */
export function remainingCents(rows: NightTableRow[], jackpotCents: number): number {
  return nightTotals(rows).netCents + jackpotCents;
}

export const jackpotCentsOf = (value: string) => Math.max(0, toCents(value));
export const centsOf = toCents;
