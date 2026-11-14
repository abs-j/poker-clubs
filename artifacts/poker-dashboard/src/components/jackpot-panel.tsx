import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccountError, accountApi, type JackpotSummary } from "@/lib/account-api";
import { clubTimeZone } from "@/lib/club-format";
import { formatCurrency } from "@/views/shared";

export const JACKPOT_KEY = ["jackpot"];

const field = "h-10 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus:border-primary";
const small = "inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[11px] font-semibold hover:bg-secondary disabled:opacity-60";
const primary = "h-10 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60";

const when = (value: string) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: clubTimeZone(), day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
const describe = (error: unknown) => (error instanceof AccountError ? error.message : "Something went wrong. Try again.");

/** The club's bad beat jackpot: the pot, and (for admins) add money, pay out, and fix any past entry. */
export function JackpotPanel({ players, canPay, admin, showWhenEmpty = false }: { players: string[]; canPay: boolean; admin: boolean; showWhenEmpty?: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: JACKPOT_KEY, queryFn: () => accountApi.jackpot() });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [payName, setPayName] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");
  // The entry being edited: "payout:3" or "night:7", with the amount typed so far.
  const [editing, setEditing] = useState<{ key: string; amount: string } | null>(null);

  const jackpot = query.data;
  if (!jackpot) return null;
  const hasHistory = jackpot.payouts.length + jackpot.deposits.length + jackpot.nightEntries.length > 0;
  if (!showWhenEmpty && !admin && !hasHistory && jackpot.total <= 0) return null;

  const run = async (work: () => Promise<JackpotSummary>, done?: () => void) => {
    setBusy(true);
    setError("");
    try {
      queryClient.setQueryData(JACKPOT_KEY, await work());
      done?.();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const pay = (event: FormEvent) => {
    event.preventDefault();
    void run(() => accountApi.payJackpot({ name: payName, amount: payAmount }), () => setPayAmount(""));
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(() => accountApi.addJackpotDeposit({ amount: addAmount, note: addNote }), () => { setAddAmount(""); setAddNote(""); });
  };
  const saveEdit = () => {
    if (!editing) return;
    const [kind, id] = editing.key.split(":");
    void run(
      () => (kind === "payout" ? accountApi.updateJackpotPayout(Number(id), { amount: editing.amount }) : accountApi.setNightJackpot(Number(id), editing.amount)),
      () => setEditing(null),
    );
  };

  const amountEditor = (key: string, current: number) =>
    editing?.key === key ? (
      <span className="flex items-center gap-1">
        <input value={editing.amount} onChange={(event) => setEditing({ key, amount: event.target.value })} inputMode="decimal" aria-label="Amount" className={`${field} h-8 w-20 font-mono`} data-testid="input-jackpot-edit" />
        <button type="button" disabled={busy} onClick={saveEdit} className={small} data-testid="button-jackpot-edit-save">Save</button>
        <button type="button" onClick={() => setEditing(null)} className={small}>Cancel</button>
      </span>
    ) : (
      <button type="button" onClick={() => setEditing({ key, amount: current.toFixed(2) })} className={small} data-testid={`button-jackpot-edit-${key.replace(":", "-")}`}>Edit</button>
    );

  return (
    <section className="rounded-2xl border border-border bg-card p-5" data-testid="section-jackpot">
      <p className="section-label">Bad beat jackpot</p>
      <p className="mt-1 font-mono text-2xl font-semibold" data-testid="text-jackpot-total">{formatCurrency(jackpot.total)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Built from the surplus of {jackpot.nights} {jackpot.nights === 1 ? "night" : "nights"}{jackpot.deposits.length > 0 ? ` and ${jackpot.deposits.length} ${jackpot.deposits.length === 1 ? "deposit" : "deposits"}` : ""}.
        {jackpot.payouts.length > 0 ? ` ${jackpot.payouts.length} ${jackpot.payouts.length === 1 ? "payout" : "payouts"} so far.` : ""}
      </p>

      {admin && (
        <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2" data-testid="form-jackpot-add">
          <label className="w-24 text-[11px] font-semibold text-muted-foreground">
            Add money
            <input value={addAmount} onChange={(event) => setAddAmount(event.target.value)} inputMode="decimal" required placeholder="0.00" data-testid="input-jackpot-add-amount" className={`${field} mt-1 font-mono`} />
          </label>
          <label className="min-w-[8rem] flex-1 text-[11px] font-semibold text-muted-foreground">
            Note (optional)
            <input value={addNote} onChange={(event) => setAddNote(event.target.value)} maxLength={200} placeholder="Carried over from last season" className={`${field} mt-1`} data-testid="input-jackpot-add-note" />
          </label>
          <button type="submit" disabled={busy || !addAmount.trim()} className={primary} data-testid="button-jackpot-add">Add</button>
        </form>
      )}

      {canPay && jackpot.total > 0 && (
        <form onSubmit={pay} className="mt-4 flex flex-wrap items-end gap-2" data-testid="form-jackpot-payout">
          <label className="min-w-[8rem] flex-1 text-[11px] font-semibold text-muted-foreground">
            Pay out to
            <select value={payName} onChange={(event) => setPayName(event.target.value)} required data-testid="input-jackpot-player" className={`${field} mt-1`}>
              <option value="">Choose a player</option>
              {players.map((player) => <option key={player} value={player}>{player}</option>)}
            </select>
          </label>
          <label className="w-24 text-[11px] font-semibold text-muted-foreground">
            Amount
            <input value={payAmount} onChange={(event) => setPayAmount(event.target.value)} inputMode="decimal" required placeholder="0.00" data-testid="input-jackpot-amount" className={`${field} mt-1 font-mono`} />
          </label>
          <button type="button" onClick={() => setPayAmount(jackpot.total.toFixed(2))} className={small} data-testid="button-jackpot-pay-all">All</button>
          <button type="submit" disabled={busy || !payName || !payAmount.trim()} data-testid="button-jackpot-payout" className={primary}>
            {busy ? "Saving…" : "Record payout"}
          </button>
        </form>
      )}
      {error && <p role="alert" data-testid="status-jackpot-error" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {!canPay && !admin && jackpot.total > 0 && <p className="mt-3 text-xs text-muted-foreground">The host or an admin can pay this out to a player.</p>}

      {hasHistory && (
        <div className="mt-4">
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={small} data-testid="button-jackpot-history">{open ? "Hide history" : "Show history"}</button>
          {open && (
            <ul className="mt-3 divide-y divide-border/70 rounded-xl border border-border text-sm" data-testid="list-jackpot-history">
              {jackpot.payouts.map((payout) => (
                <li key={`p${payout.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid={`row-jackpot-payout-${payout.id}`}>
                  <span className="min-w-0"><span className="font-semibold">Paid to {payout.name}</span><span className="block text-[11px] text-muted-foreground">by {payout.by} · {when(payout.at)}</span></span>
                  <span className="flex items-center gap-2">
                    {editing?.key !== `payout:${payout.id}` && <span className="font-mono font-semibold">−{formatCurrency(payout.amount)}</span>}
                    {admin && amountEditor(`payout:${payout.id}`, payout.amount)}
                    {admin && editing?.key !== `payout:${payout.id}` && <button type="button" disabled={busy} onClick={() => void run(() => accountApi.deleteJackpotPayout(payout.id))} className={small} data-testid={`button-jackpot-delete-payout-${payout.id}`}>Delete</button>}
                  </span>
                </li>
              ))}
              {jackpot.deposits.map((deposit) => (
                <li key={`d${deposit.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid={`row-jackpot-deposit-${deposit.id}`}>
                  <span className="min-w-0"><span className="font-semibold">Added{deposit.note ? `: ${deposit.note}` : ""}</span><span className="block text-[11px] text-muted-foreground">by {deposit.by} · {when(deposit.at)}</span></span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-semibold">+{formatCurrency(deposit.amount)}</span>
                    {admin && <button type="button" disabled={busy} onClick={() => void run(() => accountApi.deleteJackpotDeposit(deposit.id))} className={small} data-testid={`button-jackpot-delete-deposit-${deposit.id}`}>Delete</button>}
                  </span>
                </li>
              ))}
              {jackpot.nightEntries.map((night, index) => (
                <li key={`n${night.id ?? index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-testid={`row-jackpot-night-${night.id ?? index}`}>
                  <span className="min-w-0"><span className="font-semibold">{night.number ? `Game #${night.number}` : "Night"} surplus</span><span className="block text-[11px] text-muted-foreground">{when(night.date)}</span></span>
                  <span className="flex items-center gap-2">
                    {(!night.id || editing?.key !== `night:${night.id}`) && <span className="font-mono font-semibold">+{formatCurrency(night.amount)}</span>}
                    {admin && night.id !== undefined && amountEditor(`night:${night.id}`, night.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
