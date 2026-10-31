import { useState } from "react";
import { Plus } from "lucide-react";
import { AccountError, accountApi } from "@/lib/account-api";
import { formatCurrency } from "@/views/shared";

const button =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const primary =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const input = "h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

const today = () => new Date().toISOString().slice(0, 10);

type TRow = { name: string; entries: string; knockouts: string; payout: string };
const emptyTournamentRows = (): TRow[] => Array.from({ length: 4 }, () => ({ name: "", entries: "1", knockouts: "0", payout: "" }));

function describe(error: unknown): string {
  return error instanceof AccountError ? error.message : "Something went wrong. Try again.";
}

/** A tournament: list the players in the order they finished; the place is their position. */
export function RecordTournament({
  roster,
  onDone,
  onCancel,
}: {
  roster: string[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState("");
  const [buyIn, setBuyIn] = useState("");
  const [bounty, setBounty] = useState("");
  const [shares, setShares] = useState({ first: 50, second: 30, third: 20 });
  const [ownPayouts, setOwnPayouts] = useState(false);
  const [rows, setRows] = useState<TRow[]>(emptyTournamentRows);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filled = rows.filter((row) => row.name.trim());
  const update = (index: number, patch: Partial<TRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const shareTotal = shares.first + shares.second + shares.third;

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await accountApi.recordTournament({
        date,
        title: title.trim(),
        buyIn,
        bounty,
        shares,
        players: filled.map((row, index) => ({
          name: row.name,
          finishPlace: index + 1,
          entries: Number(row.entries) || 1,
          knockouts: Number(row.knockouts) || 0,
          ...(ownPayouts ? { payout: row.payout } : {}),
        })),
      });
      setMessage(
        `Tournament recorded. ${formatCurrency(result.totalCollected)} collected, ${formatCurrency(result.mainPrizePool)} in the prize pool.` +
          (result.dataCheck === "OK" ? "" : ` Heads up: ${result.dataCheck}.`),
      );
      setRows(emptyTournamentRows());
      setTitle("");
      onDone();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const grid = ownPayouts ? "grid-cols-[1.6rem_1fr_3rem_3rem_4.5rem]" : "grid-cols-[1.6rem_1fr_3.2rem_3.2rem]";

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="section-record-tournament">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Record a tournament</p>
          <p className="text-xs text-muted-foreground">List the players in the order they finished. Prizes are worked out from the shares, or enter them yourself.</p>
        </div>
        {onCancel && (
          <button type="button" className={button} onClick={onCancel} data-testid="button-tournament-cancel">
            Cancel
          </button>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 block text-[11px] font-semibold text-muted-foreground">
          Title
          <input className={`${input} mt-1 w-full`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday Freezeout" maxLength={80} data-testid="input-tournament-title" />
        </label>
        <label className="block text-[11px] font-semibold text-muted-foreground">
          Date
          <input type="date" className={`${input} mt-1 w-full`} value={date} max={today()} onChange={(e) => setDate(e.target.value)} data-testid="input-tournament-date" />
        </label>
        <label className="block text-[11px] font-semibold text-muted-foreground">
          Buy-in
          <input className={`${input} mt-1 w-full`} value={buyIn} onChange={(e) => setBuyIn(e.target.value)} placeholder="20" inputMode="decimal" data-testid="input-tournament-buyin" />
        </label>
        <label className="block text-[11px] font-semibold text-muted-foreground">
          Bounty per knockout (optional)
          <input className={`${input} mt-1 w-full`} value={bounty} onChange={(e) => setBounty(e.target.value)} placeholder="0" inputMode="decimal" data-testid="input-tournament-bounty" />
        </label>
      </div>

      {!ownPayouts && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="row-tournament-shares">
          Prize split
          {(["first", "second", "third"] as const).map((key, index) => (
            <label key={key} className="flex items-center gap-1">
              {["1st", "2nd", "3rd"][index]}
              <input
                type="number"
                min={0}
                max={100}
                value={shares[key]}
                onChange={(e) => setShares({ ...shares, [key]: Number(e.target.value) })}
                className={`${input} w-16`}
              />
              %
            </label>
          ))}
          {shareTotal !== 100 && <span className="text-amber-700 dark:text-amber-300">adds to {shareTotal}%</span>}
        </div>
      )}
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={ownPayouts} onChange={(e) => setOwnPayouts(e.target.checked)} data-testid="checkbox-own-payouts" />
        I&apos;ll enter each payout myself
      </label>

      <datalist id="club-roster-tournament">
        {roster.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="mt-3 space-y-2">
        <div className={`grid ${grid} gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}>
          <span>#</span>
          <span>Player</span>
          <span>Entries</span>
          <span>KOs</span>
          {ownPayouts && <span>Payout</span>}
        </div>
        {rows.map((row, index) => (
          <div key={index} className={`grid ${grid} items-center gap-2`}>
            <span className="text-xs font-semibold text-muted-foreground">{row.name.trim() ? filled.indexOf(row) + 1 : ""}</span>
            <input list="club-roster-tournament" className={input} value={row.name} onChange={(e) => update(index, { name: e.target.value })} placeholder="Player" maxLength={40} data-testid={`input-tournament-name-${index}`} />
            <input className={input} value={row.entries} onChange={(e) => update(index, { entries: e.target.value })} inputMode="numeric" data-testid={`input-tournament-entries-${index}`} />
            <input className={input} value={row.knockouts} onChange={(e) => update(index, { knockouts: e.target.value })} inputMode="numeric" data-testid={`input-tournament-kos-${index}`} />
            {ownPayouts && <input className={input} value={row.payout} onChange={(e) => update(index, { payout: e.target.value })} inputMode="decimal" placeholder="0" data-testid={`input-tournament-payout-${index}`} />}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={() => setRows((current) => [...current, ...emptyTournamentRows().slice(0, 2)])}>
          <Plus className="h-4 w-4" />
          More players
        </button>
        <button type="button" disabled={busy || filled.length < 2 || shareTotal > 100} onClick={() => void save()} className={primary} data-testid="button-tournament-save">
          Save tournament
        </button>
      </div>
      {error && <p role="alert" data-testid="status-tournament-error" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {message && (
        <p data-testid="status-tournament-saved" className="mt-3 text-xs font-semibold">
          {message} <button type="button" className="underline" onClick={() => window.location.reload()}>See it on the site</button>
        </p>
      )}
    </section>
  );
}
