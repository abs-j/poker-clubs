import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AccountError, accountApi, type GameTools } from "@/lib/account-api";
import type { DashboardSession as Session, TournamentEvent } from "@/lib/earnings-analytics";
import { RecordTournament } from "@/components/record-tournament";
import { formatDate } from "@/views/shared";

const button =
  "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const danger =
  "inline-flex h-9 items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 text-xs font-semibold text-destructive disabled:opacity-60";
const input = "h-9 min-w-0 rounded-lg border border-border bg-background px-2 text-sm outline-none focus:border-primary";

function describe(error: unknown): string {
  return error instanceof AccountError ? error.message : "Something went wrong. Try again.";
}

export function tournamentRecordId(id: string): number | null {
  const match = /^club-(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/** Reloads standings, settle-up and these buttons after a night changes. */
export function useRefreshGames() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries();
  };
}

function ActionError({ children }: { children: string }) {
  return <p role="alert" className="mt-2 text-xs text-destructive">{children}</p>;
}

/** Edit, reopen or delete on a cash-game card. Edit and delete are admin-only; reopen is the existing host-or-admin flow. */
export function CashGameActions({
  session,
  tools,
  onChanged,
  onReopened,
}: {
  session: Session;
  tools: GameTools | undefined;
  onChanged: () => void;
  onReopened: () => void;
}) {
  const night = tools?.nights.find((candidate) => candidate.sessionNumber === session.sessionNumber);
  const showReopen = Boolean(tools?.canReopen && tools.reopenSessionNumber === session.sessionNumber);
  const showEdit = Boolean(tools?.admin && night && night.source !== "live");
  const showDelete = Boolean(tools?.admin && night);
  const [mode, setMode] = useState<"idle" | "edit" | "confirm">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!showReopen && !showEdit && !showDelete) return null;

  const reopen = () => {
    setBusy(true);
    setError("");
    accountApi.reopenLiveSession()
      .then(() => {
        onReopened();
        onChanged();
      })
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    if (!night) return;
    setBusy(true);
    setError("");
    accountApi.deleteNight(night.id)
      .then(() => {
        setMode("idle");
        onChanged();
      })
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  const live = night?.source === "live";
  return (
    <div className="border-t border-border/70 px-4 py-3" data-testid={`game-actions-${session.sessionNumber}`}>
      {mode === "edit" && night && (
        <CashEditor
          session={session}
          nightId={night.id}
          onClose={() => { setMode("idle"); setError(""); }}
          onSaved={() => { setMode("idle"); onChanged(); }}
        />
      )}
      {mode === "confirm" && (
        <div role="group" aria-label="Confirm delete" data-testid={`confirm-delete-night-${session.sessionNumber}`}>
          <p className="text-xs text-muted-foreground" data-testid={`text-delete-night-irreversible-${session.sessionNumber}`}>
            Delete the night of {formatDate(session.date)}? This cannot be undone.
            {" "}Everyone&apos;s totals change, and any settle-up or jackpot from this night is removed.
            {live ? " The live ledger for this night is removed too." : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={danger} disabled={busy} onClick={remove} data-testid={`button-confirm-delete-night-${session.sessionNumber}`}>
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
            <button type="button" className={button} disabled={busy} onClick={() => { setMode("idle"); setError(""); }} data-testid={`button-cancel-delete-night-${session.sessionNumber}`}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          {showEdit && (
            <button type="button" className={button} onClick={() => { setMode("edit"); setError(""); }} data-testid={`button-edit-night-${session.sessionNumber}`}>
              Edit
            </button>
          )}
          {showReopen && (
            <button type="button" className={button} disabled={busy} onClick={reopen} data-testid={`button-reopen-night-${session.sessionNumber}`}>
              {busy ? "Reopening…" : "Reopen"}
            </button>
          )}
          {showDelete && (
            <button type="button" className={danger} onClick={() => { setMode("confirm"); setError(""); }} data-testid={`button-delete-night-${session.sessionNumber}`}>
              Delete
            </button>
          )}
        </div>
      )}
      {error && <ActionError>{error}</ActionError>}
    </div>
  );
}

function CashEditor({
  session,
  nightId,
  onClose,
  onSaved,
}: {
  session: Session;
  nightId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(session.date);
  const [rows, setRows] = useState(() => session.players.map((player) => ({
    name: player.player,
    buyIn: String(player.buyIn),
    cashOut: String(player.cashOut),
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = () => {
    setBusy(true);
    setError("");
    accountApi.updateNight(nightId, { date, players: rows })
      .then(() => onSaved())
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <div data-testid={`form-edit-night-${session.sessionNumber}`}>
      <p className="text-sm font-semibold">Edit this night</p>
      <label className="mt-2 block text-[11px] font-semibold text-muted-foreground">
        Date
        <input type="date" className={`${input} mt-1 w-full`} value={date} onChange={(event) => setDate(event.target.value)} data-testid={`input-edit-night-date-${session.sessionNumber}`} />
      </label>
      <div className="mt-2 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2">
            <input className={input} value={row.name} maxLength={40} aria-label={`Player ${index + 1}`} onChange={(event) => update(index, { name: event.target.value })} data-testid={`input-edit-night-name-${session.sessionNumber}-${index}`} />
            <input className={input} value={row.buyIn} inputMode="decimal" aria-label={`Buy-in ${index + 1}`} onChange={(event) => update(index, { buyIn: event.target.value })} data-testid={`input-edit-night-buyin-${session.sessionNumber}-${index}`} />
            <input className={input} value={row.cashOut} inputMode="decimal" aria-label={`Cash-out ${index + 1}`} onChange={(event) => update(index, { cashOut: event.target.value })} data-testid={`input-edit-night-cashout-${session.sessionNumber}-${index}`} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={button} onClick={() => setRows((current) => [...current, { name: "", buyIn: "", cashOut: "" }])} data-testid={`button-edit-night-add-${session.sessionNumber}`}>
          Add player
        </button>
        <button type="button" className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60" disabled={busy} onClick={save} data-testid={`button-save-night-${session.sessionNumber}`}>
          {busy ? "Saving…" : "Save night"}
        </button>
        <button type="button" className={button} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      {error && <ActionError>{error}</ActionError>}
    </div>
  );
}

/** Edit or delete on a tournament card. Both are admin-only. */
export function TournamentGameActions({
  event,
  tools,
  roster,
  onChanged,
}: {
  event: TournamentEvent;
  tools: GameTools | undefined;
  roster: string[];
  onChanged: () => void;
}) {
  const id = tournamentRecordId(event.id);
  const show = Boolean(tools?.admin && id !== null);
  const [mode, setMode] = useState<"idle" | "edit" | "confirm">("idle");
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof accountApi.getTournament>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!show || id === null) return null;

  const startEdit = () => {
    setBusy(true);
    setError("");
    accountApi.getTournament(id)
      .then((tournament) => { setDraft(tournament); setMode("edit"); })
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setBusy(true);
    setError("");
    accountApi.deleteTournament(id)
      .then(() => {
        setMode("idle");
        onChanged();
      })
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="border-t border-border/70 px-4 py-3" data-testid={`tournament-actions-${id}`}>
      {mode === "edit" && draft && (
        <RecordTournament
          plain
          roster={roster}
          initial={draft}
          onCancel={() => setMode("idle")}
          onDone={() => { setMode("idle"); onChanged(); }}
        />
      )}
      {mode === "confirm" && (
        <div role="group" aria-label="Confirm delete">
          <p className="text-xs text-muted-foreground" data-testid={`text-delete-tournament-irreversible-${id}`}>
            Delete {event.title}? This cannot be undone. Everyone&apos;s totals and points change.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={danger} disabled={busy} onClick={remove} data-testid={`button-confirm-delete-tournament-${id}`}>
              {busy ? "Deleting…" : "Delete permanently"}
            </button>
            <button type="button" className={button} disabled={busy} onClick={() => { setMode("idle"); setError(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={startEdit} data-testid={`button-edit-tournament-${id}`}>
            {busy ? "Loading…" : "Edit"}
          </button>
          <button type="button" className={danger} onClick={() => { setMode("confirm"); setError(""); }} data-testid={`button-delete-tournament-${id}`}>
            Delete
          </button>
        </div>
      )}
      {error && <ActionError>{error}</ActionError>}
    </div>
  );
}
