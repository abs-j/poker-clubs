// Small pure helpers for the Record tab's paste flow, kept apart so they can be tested without a browser.
export type RecordRow = { name: string; buyIn: string; cashOut: string };

const cents = (value: string) => {
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** How far buy-ins and cash-outs are apart. "over": money left in (buy-ins higher). "under": cash-outs higher. Blank-name rows are ignored. */
export function balanceGap(rows: RecordRow[]): { direction: "balanced" | "over" | "under"; cents: number } {
  const diff = rows.filter((row) => row.name.trim()).reduce((sum, row) => sum + cents(row.buyIn) - cents(row.cashOut), 0);
  return diff === 0 ? { direction: "balanced", cents: 0 } : { direction: diff > 0 ? "over" : "under", cents: Math.abs(diff) };
}

/** Shares a shortfall evenly across the rows, never taking more than a row cashed out. Returns cents per row, in order. */
export function shareShortfall(rows: Array<{ name: string; cashOutCents: number }>, total: number): number[] {
  const taken = rows.map(() => 0);
  let left = total;
  let open = rows.map((row, index) => ({ index, room: row.name.trim() ? row.cashOutCents : 0 })).filter((row) => row.room > 0);
  while (left > 0 && open.length > 0) {
    const each = Math.floor(left / open.length);
    const extra = left - each * open.length;
    let progressed = 0;
    open = open.filter((row, position) => {
      const take = Math.min(row.room - taken[row.index], each + (position < extra ? 1 : 0));
      taken[row.index] += take;
      progressed += take;
      return row.room - taken[row.index] > 0;
    });
    left -= progressed;
    if (progressed === 0) break;
  }
  return taken;
}
