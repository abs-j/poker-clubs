import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AccountError, accountApi } from "@/lib/account-api";
import { clubToday } from "@/lib/club-format";

const field = "h-11 min-w-0 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const button = "inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-60";

/**
 * Admin: every night is tracked for settle-up, including history from before it was. This marks everyone
 * settled on all nights before a date in one go, so nobody is asked to pay for old games. Asks first.
 */
export function SettleHistory() {
  const queryClient = useQueryClient();
  const [before, setBefore] = useState(clubToday());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const run = () => {
    setBusy(true);
    setError("");
    setMessage("");
    accountApi.settleHistory(before)
      .then((result) => {
        setMessage(result.nights === 0 ? "Nothing to settle before that date." : `Marked ${result.players} ${result.players === 1 ? "player" : "players"} settled across ${result.nights} ${result.nights === 1 ? "night" : "nights"}.`);
        setConfirming(false);
        void queryClient.invalidateQueries({ queryKey: ["settle-up"] });
        void queryClient.invalidateQueries({ queryKey: ["night-settlement"] });
      })
      .catch((caught) => setError(caught instanceof AccountError ? caught.message : "Something went wrong. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-3 rounded-xl border border-border p-3" data-testid="section-settle-history">
      <p className="text-sm font-semibold">Settle old nights</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Every night counts towards what people owe, including history from before settle-up existed. Mark everything before a date as settled so members aren&apos;t asked to pay for old games. Each night&apos;s history records who did it.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-semibold text-muted-foreground">
          Settle everything before
          <input type="date" value={before} max={clubToday()} onChange={(event) => { setBefore(event.target.value); setConfirming(false); }} className={`${field} mt-1 block font-normal text-foreground`} data-testid="input-settle-history-date" />
        </label>
        {!confirming ? (
          <button type="button" disabled={!before || busy} onClick={() => setConfirming(true)} className={`${button} border border-border bg-background`} data-testid="button-settle-history">
            Mark old nights settled
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={run} className={`${button} bg-primary text-primary-foreground`} data-testid="button-settle-history-confirm">
              {busy ? "Working…" : "Yes, mark them settled"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={`${button} border border-border bg-background`}>Cancel</button>
          </>
        )}
      </div>
      {confirming && <p className="mt-2 text-xs text-destructive" role="alert">This ticks every unsettled player on every night before {before}. You can untick a night one by one afterwards.</p>}
      {message && <p className="mt-2 text-xs font-semibold text-chart-1" role="status" data-testid="text-settle-history-done">{message}</p>}
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
