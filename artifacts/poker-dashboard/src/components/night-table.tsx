import { useState } from "react";
import { X } from "lucide-react";
import { centsOf, nightTotals, remainingCents, suggestedJackpotCents, type NightTableRow } from "@/lib/night-table";

export type NightRow = NightTableRow & { adjustmentNote?: string };

const field = "h-10 min-w-0 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-primary";
const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
const COLUMNS = "grid-cols-[minmax(0,1fr)_4.25rem_4.25rem_4.25rem_2.25rem]";

type Props = {
  rows: NightRow[];
  onRows: (rows: NightRow[]) => void;
  /** The jackpot figure shown in its row, as text. */
  jackpot: string;
  onJackpot: (value: string) => void;
  /** The surplus that the jackpot row fills in by itself. Shown as a hint when the figure was changed by hand. */
  suggestedJackpotCents: number;
  datalistId: string;
  /** "record" or "edit-night"; ids read like input-record-name-0 or input-edit-night-name-1-0. */
  testPrefix: string;
  /** Goes before the row number in row ids, e.g. "1-" for game 1. */
  testKey?: string;
};

/**
 * The night's table: one row per player (buy-in, cash-out and an adjustment that changes what they owe or are
 * owed, for example to cover a deficit), a jackpot row that fills in a surplus, and a bottom row with cash in,
 * cash out, adjustments and the net. The net reads zero when the night balances.
 */
export function NightTable({ rows, onRows, jackpot, onJackpot, suggestedJackpotCents, datalistId, testPrefix, testKey = "" }: Props) {
  const update = (index: number, patch: Partial<NightRow>) => onRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const totals = nightTotals(rows);
  const left = remainingCents(rows, centsOf(jackpot));
  const balanced = left === 0;
  return (
    <div className="space-y-2" data-testid={`${testPrefix}-table`}>
      <div className={`grid ${COLUMNS} gap-2 text-[11px] font-semibold text-muted-foreground`}>
        <span>Player</span><span>Buy-in</span><span>Cash-out</span><span>Adjust</span><span />
      </div>
      {rows.map((row, index) => (
        <div key={index} className="space-y-1">
          <div className={`grid ${COLUMNS} gap-2`}>
            <input list={datalistId} value={row.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="Player" maxLength={40} className={field} data-testid={`input-${testPrefix}-name-${testKey}${index}`} />
            <input value={row.buyIn} onChange={(event) => update(index, { buyIn: event.target.value })} inputMode="decimal" aria-label="Buy-in" className={field} data-testid={`input-${testPrefix}-buyin-${testKey}${index}`} />
            <input value={row.cashOut} onChange={(event) => update(index, { cashOut: event.target.value })} inputMode="decimal" aria-label="Cash-out" className={field} data-testid={`input-${testPrefix}-cashout-${testKey}${index}`} />
            <input value={row.adjustment ?? ""} onChange={(event) => update(index, { adjustment: event.target.value })} inputMode="decimal" placeholder="0" aria-label={`Adjustment for ${row.name || "player"}`} className={field} data-testid={`input-${testPrefix}-adjust-${testKey}${index}`} />
            <button type="button" onClick={() => onRows(rows.filter((_, i) => i !== index))} aria-label={`Remove ${row.name || "row"}`} className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background hover:bg-secondary" data-testid={`button-${testPrefix}-remove-${testKey}${index}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {centsOf(row.adjustment ?? "") !== 0 && (
            <input value={row.adjustmentNote ?? ""} onChange={(event) => update(index, { adjustmentNote: event.target.value })} maxLength={120} placeholder="Why (optional), e.g. covered the short stack" aria-label={`Reason for ${row.name || "player"}'s adjustment`} className={`${field} h-8 w-full text-xs`} data-testid={`input-${testPrefix}-adjust-note-${testKey}${index}`} />
          )}
        </div>
      ))}
      <button type="button" onClick={() => onRows([...rows, { name: "", buyIn: "", cashOut: "", adjustment: "" }])} className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary" data-testid={`button-${testPrefix}-add-${testKey ? testKey.replace(/-$/, "") : "row"}`}>
        Add a player
      </button>

      <div className={`grid ${COLUMNS} items-center gap-2 border-t border-border pt-2`} data-testid={`${testPrefix}-jackpot-row`}>
        <span className="text-sm font-semibold">Jackpot</span>
        <span className="col-span-2 text-[11px] text-muted-foreground">{suggestedJackpotCents > 0 ? `Surplus ${money(suggestedJackpotCents)} fills in` : "Only a surplus goes in"}</span>
        <input value={jackpot} onChange={(event) => onJackpot(event.target.value)} inputMode="decimal" aria-label="Jackpot" className={field} data-testid={`input-${testPrefix}-jackpot${testKey ? `-${testKey.replace(/-$/, "")}` : ""}`} />
        <span />
      </div>

      <div className="rounded-lg bg-secondary/60 px-3 py-2 text-xs" data-testid={`${testPrefix}-totals`}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <span>Cash in <b className="font-mono" data-testid={`${testPrefix}-total-in`}>{money(totals.inCents)}</b></span>
          <span>Cash out <b className="font-mono" data-testid={`${testPrefix}-total-out`}>{money(totals.outCents)}</b></span>
          <span>Adjustments <b className="font-mono" data-testid={`${testPrefix}-total-adjust`}>{money(totals.adjustmentCents)}</b></span>
          <span>Net <b className={`font-mono ${balanced ? "text-chart-1" : "text-destructive"}`} data-testid={`${testPrefix}-total-net`}>{money(left)}</b></span>
        </div>
        <p className={`mt-1 font-semibold ${balanced ? "text-chart-1" : "text-destructive"}`} role="status" data-testid={`${testPrefix}-balance`}>
          {balanced
            ? "Balanced"
            : left > 0
              ? `${money(left)} more is paid out than put in. Add negative adjustments to cover it.`
              : `${money(-left)} is unaccounted for. Put it in the jackpot or adjust players.`}
        </p>
      </div>
    </div>
  );
}

/**
 * The jackpot figure for a night's table: filled in from any surplus until it is typed over by hand.
 * `start` is a saved jackpot (editing), `reset` goes back to filling it in.
 */
export function useNightJackpot(rows: NightTableRow[], start: string | null = null) {
  const [typed, setTyped] = useState<string | null>(start);
  const suggested = suggestedJackpotCents(rows);
  const jackpot = typed ?? (suggested > 0 ? (suggested / 100).toFixed(2) : "");
  return { jackpot, typed, setJackpot: setTyped, reset: () => setTyped(null), suggested };
}
