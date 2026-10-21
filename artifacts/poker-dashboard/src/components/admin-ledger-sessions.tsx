import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPokerLiveActivityHistoryQueryKey,
  type AdminLiveLedgerResetBackup,
  type AdminLiveLedgerSessionDeletion,
  type LiveActivityHistoryRecord,
} from "@workspace/api-client-react";
import { Check, Download, LoaderCircle, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { clubTimeZone, moneyFormatter } from "@/lib/club-format";

type ClosedSessionsResponse = {
  sessions: LiveActivityHistoryRecord[];
};

function errorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function formatSessionDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatClosedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: clubTimeZone(),
  }).format(date);
}

const currency = { format: (value: number) => moneyFormatter(2).format(value) };

export function AdminLedgerSessionsPanel() {
  const queryClient = useQueryClient();
  const [sessions, setSessions] = useState<LiveActivityHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [preparingKey, setPreparingKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedSession, setSelectedSession] = useState<LiveActivityHistoryRecord | null>(null);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [backupEnvironment, setBackupEnvironment] = useState<
    AdminLiveLedgerResetBackup["environment"] | null
  >(null);
  const [confirmation, setConfirmation] = useState("");

  const loadSessions = async () => {
    setLoading(true);
    setLoadingError("");
    try {
      const response = await fetch("/api/admin/live-ledger/sessions", {
        credentials: "include",
      });
      const payload = await response.json() as ClosedSessionsResponse | { error?: string };
      if (!response.ok) {
        throw new Error(errorMessage(payload, "Closed sessions could not be loaded."));
      }
      if (!("sessions" in payload) || !Array.isArray(payload.sessions)) {
        throw new Error("The closed-session response was incomplete.");
      }
      setSessions(payload.sessions);
    } catch (error) {
      setLoadingError(
        error instanceof Error ? error.message : "Closed sessions could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const prepareDeletion = async (session: LiveActivityHistoryRecord) => {
    setPreparingKey(session.sessionKey);
    setActionError("");
    setSuccess("");
    setSelectedSession(null);
    setBackupId(null);
    setBackupEnvironment(null);
    setConfirmation("");

    try {
      const response = await fetch("/api/admin/live-ledger/backup", {
        credentials: "include",
      });
      const payload = await response.json() as
        | AdminLiveLedgerResetBackup
        | { error?: string };
      if (!response.ok) {
        throw new Error(errorMessage(payload, "The backup could not be prepared."));
      }
      if (!("backupId" in payload) || !payload.backupId) {
        throw new Error("The backup response was incomplete.");
      }
      const backup = payload as AdminLiveLedgerResetBackup;
      if (!backup.sessions.some((item) => item.sessionKey === session.sessionKey)) {
        throw new Error("This session is no longer in the backup. Refresh the closed-session list.");
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `live-ledger-${backup.environment}-${backup.createdAt.slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);

      setSelectedSession(session);
      setBackupId(backup.backupId);
      setBackupEnvironment(backup.environment);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The backup could not be prepared.",
      );
    } finally {
      setPreparingKey(null);
    }
  };

  const deleteSession = async () => {
    if (!selectedSession || !backupId) return;
    const requiredPhrase = `DELETE ${selectedSession.sessionKey}`;
    if (confirmation !== requiredPhrase) return;

    setDeleting(true);
    setActionError("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/live-ledger/sessions/${encodeURIComponent(selectedSession.sessionKey)}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backupId, confirmation }),
        },
      );
      const payload = await response.json() as
        | AdminLiveLedgerSessionDeletion
        | { error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          setSelectedSession(null);
          setBackupId(null);
          setBackupEnvironment(null);
          setConfirmation("");
        }
        throw new Error(errorMessage(payload, "The session could not be deleted."));
      }
      if (!("sessionKey" in payload) || !payload.sessionKey) {
        throw new Error("The deletion response was incomplete.");
      }

      const result = payload as AdminLiveLedgerSessionDeletion;
      setSessions((current) =>
        current.filter((session) => session.sessionKey !== result.sessionKey),
      );
      setSuccess(
        `${formatSessionDate(result.sessionDate)} session deleted with ${result.deletedEvents} entries and ${result.deletedComments} comments` +
          (result.environment === "production"
            ? `; cleared ${result.clearedSheetRows} matching sheet rows.`
            : "."),
      );
      setSelectedSession(null);
      setBackupId(null);
      setBackupEnvironment(null);
      setConfirmation("");
      await queryClient.invalidateQueries({
        queryKey: getGetPokerLiveActivityHistoryQueryKey(),
      });
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The session could not be deleted.",
      );
    } finally {
      setDeleting(false);
    }
  };

  const requiredPhrase = selectedSession
    ? `DELETE ${selectedSession.sessionKey}`
    : "";
  const actionBusy = preparingKey !== null || deleting;

  return (
    <section
      data-testid="section-admin-live-ledger-sessions"
      className="mt-5 rounded-2xl border border-border bg-card p-5 soft-shadow sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <p className="section-label text-destructive">Admin-only permanent deletion</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">Delete old ledger sessions</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Only closed sessions are listed. Each deletion downloads a full backup first and requires the exact session key.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadSessions()}
          disabled={loading || actionBusy}
          data-testid="button-refresh-closed-ledger-sessions"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh sessions
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6">
        <p className="font-semibold">What deletion removes</p>
        <p className="mt-1 text-muted-foreground">
          The selected closed session, its entries, and their comment history. Production also clears matching rows from the shared Google Sheets Live Activity tab; development only changes its own database.
        </p>
      </div>

      {loadingError && (
        <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadingError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}
      {success && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm leading-6 text-emerald-800 dark:text-emerald-200">
          <Check className="mt-1 h-4 w-4 shrink-0" />
          <span>{success}</span>
        </p>
      )}

      <div className="mt-4 space-y-3">
        {loading && sessions.length === 0 ? (
          <p className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />Loading closed sessions…
          </p>
        ) : sessions.length === 0 ? (
          !loadingError && (
            <p className="rounded-xl border border-border bg-secondary/20 px-4 py-5 text-sm text-muted-foreground">
              No closed ledger sessions are available to delete.
            </p>
          )
        ) : (
          sessions.map((session) => (
            <div
              key={session.sessionKey}
              className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">{formatSessionDate(session.sessionDate)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Closed {formatClosedAt(session.endedAt)} · {session.entries.length} entries ·{" "}
                  <span className="text-emerald-700 dark:text-emerald-300">
                    Buy-ins {currency.format(session.totals.buyIns)}
                  </span>{" "}
                  ·{" "}
                  <span className="text-red-700 dark:text-red-300">
                    Cash-outs {currency.format(session.totals.cashOuts)}
                  </span>
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {session.sessionKey}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void prepareDeletion(session)}
                disabled={actionBusy}
                data-testid={`button-prepare-ledger-session-delete-${session.sessionKey}`}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {preparingKey === session.sessionKey
                  ? <LoaderCircle className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
                {preparingKey === session.sessionKey
                  ? "Preparing backup…"
                  : "Download backup & prepare"}
              </button>
            </div>
          ))
        )}
      </div>

      {selectedSession && backupId && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm font-semibold">
            Backup downloaded · {backupEnvironment}
            {backupEnvironment === "production"
              ? " · includes the shared sheet"
              : " · database only"}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            To permanently delete {formatSessionDate(selectedSession.sessionDate)} and its related data, type{" "}
            <span className="break-all font-mono font-semibold text-foreground">{requiredPhrase}</span>.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold">Session confirmation</span>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                maxLength={80}
                data-testid="input-confirm-ledger-session-delete"
                placeholder={requiredPhrase}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-destructive"
              />
            </label>
            <button
              type="button"
              onClick={() => void deleteSession()}
              disabled={actionBusy || confirmation !== requiredPhrase}
              data-testid="button-confirm-ledger-session-delete"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting
                ? <LoaderCircle className="h-4 w-4 animate-spin" />
                : <Trash2 className="h-4 w-4" />}
              {deleting ? "Deleting session…" : "Permanently delete session"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}