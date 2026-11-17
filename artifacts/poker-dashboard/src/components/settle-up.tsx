import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check } from "lucide-react";
import { accountApi, type NightSettlement, type SettleUpSummary } from "@/lib/account-api";
import { settleBadge, settleLineText, settleTotalText } from "@/lib/settle-up";
import { formatDate } from "@/views/shared";

export const SETTLE_UP_KEY = ["settle-up"];
const nightKey = (nightId: number) => ["night-settlement", nightId];

/** How settled each night is, plus what the viewer owes. Shared by the Home card and the Games cards. */
export function useSettleUp() {
  return useQuery<SettleUpSummary>({
    queryKey: SETTLE_UP_KEY,
    queryFn: () => accountApi.settleUp(),
    staleTime: 30_000,
  });
}

/** Refreshes settle-up everywhere after a night closes, reopens or is ticked. */
export function useRefreshSettleUp() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: SETTLE_UP_KEY });
    void queryClient.invalidateQueries({ queryKey: ["night-settlement"] });
  };
}

/** A small label on a Games night card: "Settled" or how many people are still to settle. */
export function SettleBadge({ sessionNumber }: { sessionNumber: number }) {
  const summary = useSettleUp().data;
  const night = summary?.nights.find((candidate) => candidate.sessionNumber === sessionNumber);
  // Your own result on this night, when you still owe it.
  const owe = summary?.mine.owe.find((entry) => entry.sessionNumber === sessionNumber);
  if (owe) {
    return (
      <span data-testid={`badge-owe-${sessionNumber}`} className="shrink-0 rounded-md bg-destructive/10 px-1.5 py-1 text-[11px] font-semibold text-destructive">
        You owe {settleTotalText(owe.cents)}{owe.bank ? ` to ${owe.bank}` : ""}
      </span>
    );
  }
  const label = night ? settleBadge(night.state, night.unsettled) : null;
  if (!night || !label) return null;
  const done = night.state === "settled";
  return (
    <span
      data-testid={`badge-settle-${sessionNumber}`}
      className={`shrink-0 rounded-md px-1.5 py-1 text-[11px] font-semibold ${done ? "bg-chart-1/10 text-chart-1" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}
    >
      {label}
    </span>
  );
}

/** Who owes and is owed for one night, with a Settled tick the host, the bank or an admin can use. */
export function SettleList({ nightId, testId = "section-settle-list", names = [] }: { nightId: number; testId?: string; names?: string[] }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshSettleUp();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const query = useQuery<NightSettlement>({
    queryKey: nightKey(nightId),
    queryFn: () => accountApi.nightSettlement(nightId),
    staleTime: 10_000,
  });
  const settlement = query.data;
  if (!settlement) {
    return query.isError ? null : <div className="h-24 skeleton rounded-2xl" />;
  }

  const change = (request: { name: string; settled: boolean } | { all: true; settled: boolean }) => {
    setBusy(true);
    setError("");
    accountApi.setSettled(nightId, request)
      .then((next) => {
        queryClient.setQueryData(nightKey(nightId), next);
        void queryClient.invalidateQueries({ queryKey: SETTLE_UP_KEY });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save that."))
      .finally(() => setBusy(false));
  };
  const changeBank = (name: string | null) => {
    setBusy(true);
    setError("");
    accountApi.setNightBank(nightId, name)
      .then((next) => {
        queryClient.setQueryData(nightKey(nightId), next);
        void queryClient.invalidateQueries({ queryKey: SETTLE_UP_KEY });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save that."))
      .finally(() => setBusy(false));
  };
  const owing = settlement.lines.filter((line) => line.netCents !== 0);
  if (owing.length === 0) return null;
  const waiting = owing.filter((line) => !line.settled).length;

  return (
    <section data-testid={testId} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="section-label">Settle up</p>
          <h2 className="mt-1 text-base font-semibold">{waiting === 0 ? "Everyone has settled" : `${waiting} still to settle`}</h2>
          <p className="mt-1 text-xs text-muted-foreground" data-testid="text-settle-bank">
            {settlement.bankName ? `Bank: ${settlement.bankName}` : "No bank chosen"}
            {settlement.canSettle ? "" : ` · ${settlement.hostName}${settlement.bankName ? " or the bank" : ""} ticks people off`}
          </p>
        </div>
        {settlement.canSettle && waiting > 0 && (
          <button type="button" disabled={busy} onClick={() => change({ all: true, settled: true })} data-testid="button-settle-all" className="h-9 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-60">
            Mark all settled
          </button>
        )}
      </div>
      {settlement.flagged && (
        <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid="text-settle-flagged">
          The amounts changed after people were ticked settled. Check the ticks below.
        </p>
      )}
      {settlement.canSettle && (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          Bank
          <select
            value={settlement.bankName ?? ""}
            disabled={busy}
            onChange={(event) => changeBank(event.target.value || null)}
            aria-label="Bank"
            data-testid="select-settle-bank"
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value="">No bank</option>
            {[...new Set([...(settlement.bankName ? [settlement.bankName] : []), ...names])].map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}
      <ul className="mt-3 divide-y divide-border/60" data-testid="list-settle-lines">
        {owing.map((line) => (
          <li key={line.playerId} data-testid={`row-settle-${line.playerId}`} className="flex items-center gap-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{line.name}</p>
              <p className={`text-xs ${line.netCents < 0 ? "text-destructive" : "text-chart-1"}`}>
                {settleLineText(line, settlement.bankName)}
                {line.settled && line.settledAt ? ` · settled ${new Date(line.settledAt).toLocaleDateString()} by ${line.settledBy ?? "?"}` : ""}
              </p>
            </div>
            {settlement.canSettle ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={line.settled}
                aria-label={`${line.name} settled`}
                disabled={busy}
                onClick={() => change({ name: line.name, settled: !line.settled })}
                data-testid={`checkbox-settled-${line.playerId}`}
                className={`inline-flex h-9 min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:opacity-60 ${line.settled ? "border-chart-1/40 bg-chart-1/10 text-chart-1" : "border-border bg-background"}`}
              >
                {line.settled && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                {line.settled ? "Settled" : "Settle"}
              </button>
            ) : (
              <span className={`text-xs font-semibold ${line.settled ? "text-chart-1" : "text-muted-foreground"}`}>{line.settled ? "Settled" : "Not yet"}</span>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {settlement.log.length > 0 && (
        <details className="mt-3 text-xs" data-testid="details-night-log">
          <summary className="cursor-pointer font-semibold text-muted-foreground">History ({settlement.log.length})</summary>
          <ul className="mt-2 space-y-1">
            {settlement.log.map((entry, index) => (
              <li key={index} className="text-muted-foreground">
                <span className="font-mono">{new Date(entry.at).toLocaleString()}</span> · {entry.by}: {entry.summary}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** The settle list for a Games night. Every recorded night is tracked, so it shows whenever someone owes. */
export function SettleForSession({ sessionNumber, names = [] }: { sessionNumber: number; names?: string[] }) {
  const night = useSettleUp().data?.nights.find((candidate) => candidate.sessionNumber === sessionNumber);
  if (!night || night.state === "none") return null;
  return <div className="mt-3"><SettleList nightId={night.nightId} testId={`section-settle-${sessionNumber}`} names={names} /></div>;
}

/** Home: the nights you still owe or are owed on. Hidden when there is nothing to settle. */
export function SettleUpCard({ onOpenSession }: { onOpenSession: (sessionNumber: number) => void }) {
  const mine = useSettleUp().data?.mine;
  if (!mine || (mine.owe.length === 0 && mine.owed.length === 0)) return null;
  const rows = [
    ...mine.owe.map((entry) => ({ ...entry, owes: true })),
    ...mine.owed.map((entry) => ({ ...entry, owes: false })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.nightId - a.nightId);
  return (
    <section data-testid="card-settle-up" className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.06] p-4 sm:p-5">
      <p className="section-label">Settle up</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {mine.oweCents > 0 && <p className="text-base font-semibold" data-testid="text-settle-owe">You owe <span className="font-mono text-destructive">{settleTotalText(mine.oweCents)}</span></p>}
        {mine.owedCents > 0 && <p className="text-base font-semibold" data-testid="text-settle-owed">You are owed <span className="font-mono text-chart-1">{settleTotalText(mine.owedCents)}</span></p>}
      </div>
      <ul className="mt-3 divide-y divide-border/60">
        {rows.map((row) => (
          <li key={`${row.nightId}-${row.owes ? "owe" : "owed"}`}>
            <button
              type="button"
              disabled={row.sessionNumber === null}
              onClick={() => row.sessionNumber !== null && onOpenSession(row.sessionNumber)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm disabled:cursor-default"
            >
              <span className="min-w-0 truncate">
                {formatDate(row.date)}
                <span className="text-muted-foreground">{row.bank ? ` · bank ${row.bank}` : ""}</span>
              </span>
              <span className={`shrink-0 font-mono text-sm font-semibold ${row.owes ? "text-destructive" : "text-chart-1"}`}>
                {row.owes ? "−" : "+"}{settleTotalText(row.cents)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
