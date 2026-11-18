import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AccountError, accountApi, type GameTools, type NightEditData } from "@/lib/account-api";
import type { DashboardSession as Session, TournamentEvent } from "@/lib/earnings-analytics";
import { NightTable, useNightJackpot, type NightRow } from "@/components/night-table";
import { useSettleUp } from "@/components/settle-up";
import { centsOf, remainingCents } from "@/lib/night-table";
import { RecordTournament } from "@/components/record-tournament";
import { formatDate } from "@/views/shared";

const button =
  "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const danger =
  "inline-flex h-9 items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 text-xs font-semibold text-destructive disabled:opacity-60";
/** Quiet text buttons for the row of admin actions under a card, so they do not outweigh the result. */
const quiet =
  "inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-60";
const quietDanger =
  "inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60";
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

/** A night's note: shown to every member, and editable by admins. Renders nothing when there is no note and no edit rights. */
export function NightNote({ sessionNumber, tools }: { sessionNumber: number; tools: GameTools | undefined }) {
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: ["night-notes"], queryFn: () => accountApi.nightNotes() });
  const night = tools?.admin ? tools.nights.find((candidate) => candidate.sessionNumber === sessionNumber) : undefined;
  const note = notes.data?.notes[String(sessionNumber)] ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!note && !night) return null;

  const save = () => {
    if (!night) return;
    setBusy(true);
    setError("");
    accountApi.setNightNote(night.id, draft)
      .then(() => {
        setEditing(false);
        void queryClient.invalidateQueries({ queryKey: ["night-notes"] });
      })
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  if (editing) {
    return (
      <div className="border-t border-border/70 px-4 py-3" data-testid={`box-night-note-${sessionNumber}`}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={2000} aria-label="Note for this night" className="w-full rounded-lg border border-border bg-background p-2 text-sm outline-none focus:border-primary" data-testid={`input-night-note-${sessionNumber}`} />
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={save} className={button} data-testid={`button-night-note-save-${sessionNumber}`}>{busy ? "Saving…" : "Save note"}</button>
          <button type="button" onClick={() => setEditing(false)} className={button}>Cancel</button>
        </div>
        {error && <ActionError>{error}</ActionError>}
      </div>
    );
  }
  return (
    <div className="border-t border-border/70 px-4 py-3 text-sm" data-testid={`box-night-note-${sessionNumber}`}>
      {note && <p className="whitespace-pre-line border-l-2 border-primary/50 pl-3 text-sm italic leading-6 text-muted-foreground" data-testid={`text-night-note-${sessionNumber}`}>{note}</p>}
      {night && (
        <button type="button" onClick={() => { setDraft(note); setEditing(true); }} className={`${quiet} ${note ? "mt-1 -ml-2" : "-ml-2"}`} data-testid={`button-night-note-edit-${sessionNumber}`}>
          {note ? "Edit note" : "Add a note"}
        </button>
      )}
    </div>
  );
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
  // The bank, the host and admins may edit; the server decides and reports each night's canEdit.
  const tracked = useSettleUp().data?.nights.find((candidate) => candidate.sessionNumber === session.sessionNumber);
  const editNightId = tracked?.canEdit ? tracked.nightId : null;
  // Wait for the tools too, so Edit appears together with the note button and nothing shifts under a tap.
  const showEdit = editNightId !== null && tools !== undefined;
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
      {mode === "edit" && editNightId !== null && (
        <CashEditor
          session={session}
          nightId={editNightId}
          onClose={() => { setMode("idle"); setError(""); }}
          onSaved={() => { setMode("idle"); onChanged(); }}
        />
      )}
      {mode === "confirm" && (
        <div role="group" aria-label="Confirm delete" data-testid={`confirm-delete-night-${session.sessionNumber}`}>
          <p className="text-xs text-muted-foreground" data-testid={`text-delete-night-irreversible-${session.sessionNumber}`}>
            Delete the night of {formatDate(session.date)}? This cannot be undone.
            {" "}Everyone&apos;s totals change, and any settle-up or jackpot from this night is removed.
            {live ? " The table record for this night is removed too." : ""}
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
        <div className="-mx-2 flex flex-wrap items-center gap-1">
          {showEdit && (
            <button type="button" className={quiet} onClick={() => { setMode("edit"); setError(""); }} data-testid={`button-edit-night-${session.sessionNumber}`}>
              Edit
            </button>
          )}
          {showReopen && (
            <button type="button" className={quiet} disabled={busy} onClick={reopen} data-testid={`button-reopen-night-${session.sessionNumber}`}>
              {busy ? "Reopening…" : "Reopen"}
            </button>
          )}
          {showDelete && (
            <button type="button" className={`${quietDanger} ml-auto`} onClick={() => { setMode("confirm"); setError(""); }} data-testid={`button-delete-night-${session.sessionNumber}`}>
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
  const detail = useQuery({ queryKey: ["night-edit", nightId], queryFn: () => accountApi.nightEdit(nightId), staleTime: 0, gcTime: 0 });
  if (detail.isError) return <ActionError>Could not open this night. Try again.</ActionError>;
  if (!detail.data) return <div className="h-24 skeleton rounded-2xl" />;
  return <CashEditorForm session={session} nightId={nightId} data={detail.data} onClose={onClose} onSaved={onSaved} />;
}

const dollarText = (cents: number) => (cents === 0 ? "" : (cents / 100).toFixed(2));

function CashEditorForm({
  session,
  nightId,
  data,
  onClose,
  onSaved,
}: {
  session: Session;
  nightId: number;
  data: NightEditData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(data.date);
  const [note, setNote] = useState(data.notes ?? "");
  const [bank, setBank] = useState(data.bankName ?? "");
  const [rows, setRows] = useState<NightRow[]>(() =>
    data.players.map((player) => ({
      name: player.name,
      buyIn: (player.buyInCents / 100).toFixed(2),
      cashOut: (player.cashOutCents / 100).toFixed(2),
      adjustment: dollarText(player.adjustmentCents),
      adjustmentNote: player.adjustmentNote ?? "",
    })),
  );
  // Starts at the saved jackpot, if any; otherwise a surplus fills it in. Typing over it keeps the typed figure.
  const jackpot = useNightJackpot(rows, data.jackpotCents > 0 ? dollarText(data.jackpotCents) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const names = rows.map((row) => row.name).filter(Boolean);
  const balanced = remainingCents(rows, centsOf(jackpot.jackpot)) === 0;
  const prefix = `edit-night-${session.sessionNumber}`;
  const testKey = `${session.sessionNumber}-`;

  const save = () => {
    setBusy(true);
    setError("");
    accountApi.updateNight(nightId, {
      date,
      players: rows,
      jackpot: jackpot.jackpot || "0",
      notes: note,
      bank: bank.trim() || null,
    })
      .then(() => onSaved())
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <div data-testid={`form-edit-night-${session.sessionNumber}`}>
      <p className="text-sm font-semibold">Edit this night</p>
      {data.source === "live" && (
        <p className="mt-1 text-xs text-muted-foreground">This night came from the live ledger. Reopening it later rebuilds it from the ledger and drops these edits.</p>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
        <label className="block text-[11px] font-semibold text-muted-foreground">
          Date
          <input type="date" className={`${input} mt-1 w-full`} value={date} onChange={(event) => setDate(event.target.value)} data-testid={`input-edit-night-date-${session.sessionNumber}`} />
        </label>
        <label className="block text-[11px] font-semibold text-muted-foreground">
          Bank (who holds the cash)
          <input list={`${prefix}-roster`} className={`${input} mt-1 w-full font-normal text-foreground`} value={bank} maxLength={40} placeholder="No bank" onChange={(event) => setBank(event.target.value)} data-testid={`input-edit-night-bank-${session.sessionNumber}`} />
        </label>
      </div>
      <datalist id={`${prefix}-roster`}>{names.map((name) => <option key={name} value={name} />)}</datalist>
      <div className="mt-3">
        <NightTable rows={rows} onRows={setRows} jackpot={jackpot.jackpot} onJackpot={jackpot.setJackpot} suggestedJackpotCents={jackpot.suggested} datalistId={`${prefix}-roster`} testPrefix="edit-night" testKey={testKey} />
      </div>
      <label className="mt-2 block text-[11px] font-semibold text-muted-foreground">
        Note for this night
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm font-normal text-foreground outline-none focus:border-primary" data-testid={`input-edit-night-note-${session.sessionNumber}`} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60" disabled={busy || !balanced || rows.filter((row) => row.name.trim()).length < 2} onClick={save} data-testid={`button-save-night-${session.sessionNumber}`}>
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
        <div className="-mx-2 flex flex-wrap items-center gap-1">
          <button type="button" className={quiet} disabled={busy} onClick={startEdit} data-testid={`button-edit-tournament-${id}`}>
            {busy ? "Loading…" : "Edit"}
          </button>
          <button type="button" className={`${quietDanger} ml-auto`} onClick={() => { setMode("confirm"); setError(""); }} data-testid={`button-delete-tournament-${id}`}>
            Delete
          </button>
        </div>
      )}
      {error && <ActionError>{error}</ActionError>}
    </div>
  );
}
