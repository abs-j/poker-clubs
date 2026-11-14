import { useMemo, useState, type FormEvent } from "react";
import { Plus, UserPlus } from "lucide-react";
import type { LivePlayerSummary } from "@workspace/api-client-react";
import { livePlayerNetProfit } from "@/lib/live-player-summary";
import { formatCurrency, signedCurrency } from "@/views/shared";

const PRESETS = [10, 20, 50];
const chip = "h-11 min-w-[3.5rem] rounded-full border border-border bg-background px-4 font-mono text-sm font-semibold transition-colors hover:border-primary/50 hover:bg-secondary active:scale-95 disabled:opacity-50";
const field = "h-11 min-w-0 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";

export type TableAction = "buy_in" | "cash_out";

type Props = {
  summaries: LivePlayerSummary[];
  roster: string[];
  disabled: boolean;
  /** Logs one entry for one player. Resolves when saved. */
  onRecord: (name: string, action: TableAction, amount: number) => void;
};

/**
 * The recorder's table: one card per player with one-tap buy-ins and a cash-out, plus a way to seat a new
 * player. Only the host (or an admin) sees this; everyone else gets the read-only board.
 */
export function TableRecorder({ summaries, roster, disabled, onRecord }: Props) {
  const [open, setOpen] = useState<{ name: string; mode: "buy_in" | "cash_out" } | null>(null);
  const [amount, setAmount] = useState("");
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const seated = useMemo(() => new Set(summaries.map((row) => row.playerName.trim().toLowerCase())), [summaries]);
  const unseated = roster.filter((name) => !seated.has(name.trim().toLowerCase()));
  const inPlay = Math.round(summaries.reduce((sum, row) => sum + row.buyIns - row.cashOuts, 0) * 100) / 100;

  const submitOpen = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!open || !Number.isFinite(value) || value <= 0) return;
    onRecord(open.name, open.mode, Math.round(value * 100) / 100);
    setOpen(null);
    setAmount("");
  };
  const seat = (value: number) => {
    const name = newName.trim().replace(/\s+/g, " ");
    if (!name || !Number.isFinite(value) || value <= 0) return;
    onRecord(name, "buy_in", value);
    setNewName("");
    setNewAmount("");
  };

  return (
    <section className="soft-shadow rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="section-table-recorder">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-label text-primary">You're recording</p>
          <h2 className="mt-1 text-base font-semibold sm:text-lg">The table</h2>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">In play</p>
          <p className="font-mono text-lg font-semibold" data-testid="text-table-in-play">{formatCurrency(inPlay)}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-3" data-testid="list-table-seats">
        {summaries.length === 0 && <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No one is seated yet. Add the first player below.</li>}
        {summaries.map((row) => {
          const out = row.cashOuts > 0;
          const net = livePlayerNetProfit(row);
          const key = row.playerName.toLowerCase();
          const here = open?.name === row.playerName;
          return (
            <li key={row.playerName} data-testid={`seat-${key}`} className="rounded-xl border border-border/80 bg-background/60 p-3">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">{row.playerName.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.playerName}</p>
                  <p className="font-mono text-xs text-muted-foreground">in {formatCurrency(row.buyIns)}{out ? ` · out ${formatCurrency(row.cashOuts)}` : " · playing"}</p>
                </div>
                {out && <span className={`font-mono text-sm font-semibold ${net >= 0 ? "text-chart-1" : "text-destructive"}`}>{signedCurrency(net)}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {PRESETS.map((value) => (
                  <button key={value} type="button" disabled={disabled} onClick={() => onRecord(row.playerName, "buy_in", value)} className={chip} data-testid={`button-seat-buyin-${key}-${value}`} aria-label={`Add a ${formatCurrency(value)} buy-in for ${row.playerName}`}>+${value}</button>
                ))}
                <button type="button" disabled={disabled} onClick={() => { setOpen({ name: row.playerName, mode: "buy_in" }); setAmount(""); }} className={chip} data-testid={`button-seat-more-${key}`}>Other</button>
                <button type="button" disabled={disabled} onClick={() => { setOpen({ name: row.playerName, mode: "cash_out" }); setAmount(""); }} className="ml-auto h-11 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid={`button-seat-cashout-${key}`}>Cash out</button>
              </div>
              {here && open && (
                <form onSubmit={submitOpen} className="mt-3 flex items-center gap-2" data-testid={`form-seat-${key}`}>
                  <span className="text-xs font-semibold text-muted-foreground">{open.mode === "cash_out" ? "Cash-out $" : "Buy-in $"}</span>
                  <input autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" aria-label={open.mode === "cash_out" ? "Cash-out amount" : "Buy-in amount"} className={`${field} w-28 font-mono`} data-testid={`input-seat-amount-${key}`} />
                  <button type="submit" disabled={disabled || !amount.trim()} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid={`button-seat-save-${key}`}>Save</button>
                  <button type="button" onClick={() => setOpen(null)} className="h-11 rounded-xl border border-border px-3 text-sm font-semibold">Cancel</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 rounded-xl border border-dashed border-border p-3" data-testid="box-table-add-player">
        <p className="flex items-center gap-1.5 text-xs font-semibold"><UserPlus className="h-4 w-4" aria-hidden="true" />Add a player</p>
        <input list="table-roster" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} autoComplete="off" placeholder="Name (pick from the club or type a new one)" aria-label="Player name" className={`${field} mt-2 w-full`} data-testid="input-table-new-name" />
        <datalist id="table-roster">{unseated.map((name) => <option key={name} value={name} />)}</datalist>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Buy in for</span>
          {PRESETS.map((value) => (
            <button key={value} type="button" disabled={disabled || !newName.trim()} onClick={() => seat(value)} className={chip} data-testid={`button-table-seat-${value}`}>${value}</button>
          ))}
          <input value={newAmount} onChange={(event) => setNewAmount(event.target.value)} inputMode="decimal" placeholder="Other" aria-label="Other buy-in amount" className={`${field} h-11 w-24 font-mono`} data-testid="input-table-new-amount" />
          <button type="button" disabled={disabled || !newName.trim() || !newAmount.trim()} onClick={() => seat(Number(newAmount))} className="inline-flex h-11 items-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-table-seat-other"><Plus className="h-4 w-4" aria-hidden="true" />Add</button>
        </div>
      </div>
    </section>
  );
}
