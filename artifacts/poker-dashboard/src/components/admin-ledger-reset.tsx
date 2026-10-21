import { useState } from "react";
import type {
  AdminLiveLedgerReset,
  AdminLiveLedgerResetBackup,
} from "@workspace/api-client-react";
import { Check, Download, LoaderCircle, ShieldAlert, Trash2 } from "lucide-react";

const resetPhrase = "RESET LIVE LEDGER";

type BackupSummary = Pick<
  AdminLiveLedgerResetBackup,
  "environment" | "includesSharedSheet" | "counts" | "createdAt"
>;

export function AdminLedgerResetPanel() {
  const [backupId, setBackupId] = useState<string | null>(null);
  const [backupSummary, setBackupSummary] = useState<BackupSummary | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [resetResult, setResetResult] = useState<AdminLiveLedgerReset | null>(null);
  const [busy, setBusy] = useState<"backup" | "reset" | null>(null);
  const [error, setError] = useState("");

  const downloadBackup = async () => {
    setBusy("backup");
    setError("");
    setResetResult(null);

    try {
      const response = await fetch("/api/admin/live-ledger/backup", {
        credentials: "include",
      });
      const payload = await response.json() as
        | AdminLiveLedgerResetBackup
        | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error ?? "The backup could not be prepared." : "The backup could not be prepared.");
      }
      if (!("backupId" in payload) || !payload.backupId) {
        throw new Error("The backup response was incomplete.");
      }

      const backup = payload as AdminLiveLedgerResetBackup;
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

      setBackupId(backup.backupId);
      setBackupSummary({
        environment: backup.environment,
        includesSharedSheet: backup.includesSharedSheet,
        counts: backup.counts,
        createdAt: backup.createdAt,
      });
      setConfirmation("");
    } catch (downloadError) {
      setBackupId(null);
      setBackupSummary(null);
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "The backup could not be downloaded.",
      );
    } finally {
      setBusy(null);
    }
  };

  const resetLedger = async () => {
    if (!backupId || confirmation !== resetPhrase) return;
    setBusy("reset");
    setError("");

    try {
      const response = await fetch("/api/admin/live-ledger/reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupId, confirmation }),
      });
      const payload = await response.json() as
        | AdminLiveLedgerReset
        | { error?: string };
      if (!response.ok) {
        if (response.status === 409) {
          setBackupId(null);
          setBackupSummary(null);
          setConfirmation("");
        }
        throw new Error("error" in payload ? payload.error ?? "The ledger could not be reset." : "The ledger could not be reset.");
      }
      if (!("freshSessionKey" in payload)) {
        throw new Error("The reset response was incomplete.");
      }

      setResetResult(payload as AdminLiveLedgerReset);
      setBackupId(null);
      setBackupSummary(null);
      setConfirmation("");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "The ledger could not be reset.",
      );
    } finally {
      setBusy(null);
    }
  };

  const productionScope = backupSummary?.environment === "production";

  return (
    <section
      data-testid="section-admin-live-ledger-reset"
      className="mt-5 rounded-2xl border border-destructive/30 bg-card p-5 soft-shadow sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div>
          <p className="section-label text-destructive">Destructive admin tool</p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Reset live ledger</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Removes live sessions, entries, and comment history from the environment serving this page, then opens a fresh session. It does not change the season log, visits, or member access.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6">
        <p className="font-semibold">What will be cleared</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>The live-ledger database attached to this environment.</li>
          <li>
            {backupSummary
              ? productionScope
                ? "The shared Google Sheets Live Activity tab, except its header row."
                : "No Google Sheet rows. Development is isolated from the shared sheet."
              : "Production also clears the shared Google Sheets Live Activity tab; development leaves that shared tab untouched."}
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Download the backup first. The final action requires typing <span className="font-mono font-semibold text-foreground">{resetPhrase}</span>.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void downloadBackup()}
          disabled={busy !== null}
          data-testid="button-download-ledger-reset-backup"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "backup" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {busy === "backup" ? "Preparing backup…" : "Download backup JSON"}
        </button>
        {backupSummary && (
          <span className="text-xs text-muted-foreground">
            Backup ready · {backupSummary.environment} · {backupSummary.counts.sessions} sessions · {backupSummary.counts.events} entries · {backupSummary.counts.comments} comments
            {backupSummary.includesSharedSheet ? ` · ${backupSummary.counts.sheetRows} sheet rows` : ""}
          </span>
        )}
      </div>

      {backupId && (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold">Type the confirmation phrase</span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              data-testid="input-confirm-live-ledger-reset"
              placeholder={resetPhrase}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-destructive"
            />
          </label>
          <button
            type="button"
            onClick={() => void resetLedger()}
            disabled={busy !== null || confirmation !== resetPhrase}
            data-testid="button-confirm-live-ledger-reset"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "reset" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {busy === "reset" ? "Resetting ledger…" : "Clear ledger and start fresh"}
          </button>
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="status-live-ledger-reset-error"
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {resetResult && (
        <p
          role="status"
          data-testid="status-live-ledger-reset-success"
          className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm leading-6 text-emerald-800 dark:text-emerald-200"
        >
          <Check className="mt-1 h-4 w-4 shrink-0" />
          <span>
            {resetResult.environment} ledger reset. Removed {resetResult.deletedSessions} sessions, {resetResult.deletedEvents} entries, and {resetResult.deletedComments} comments
            {resetResult.environment === "production" ? `; cleared ${resetResult.clearedSheetRows} sheet rows` : ""}. A fresh session is open for {resetResult.freshSessionDate}.
          </span>
        </p>
      )}
    </section>
  );
}