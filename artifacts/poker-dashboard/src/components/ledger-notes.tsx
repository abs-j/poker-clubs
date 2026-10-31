import { useState, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import type { LiveActivitySnapshot } from "@workspace/api-client-react";
import { AccountError, accountApi } from "@/lib/account-api";
import { parseNightNotes, type NoteRow } from "@/lib/night-notes";
import { prepareNotesImage } from "@/lib/notes-image";
import { plural } from "@/lib/utils";

const button =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const primary =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const field = "h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

const money = (value: string) => {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Fills the open night from notes ("Ann - $10 -> $48", one player per line), pasted or read from a screenshot.
 * The rows can be corrected before they are added, and they land in the ledger as entries logged by the host.
 */
export function LedgerNotes({ roster, onAdded }: { roster: string[]; onAdded: (snapshot: LiveActivitySnapshot) => void }) {
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);

  const filled = rows.filter((row) => row.name.trim());
  const gap = Math.round((filled.reduce((sum, row) => sum + money(row.cashOut), 0) - filled.reduce((sum, row) => sum + money(row.buyIn), 0)) * 100) / 100;
  const update = (index: number, patch: Partial<NoteRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const readNotes = (text = notes) => {
    setError("");
    const read = parseNightNotes(text, roster);
    if (read.rows.length === 0) {
      setRows([]);
      setSummary("Couldn't find any players. Use one line per player, like: Ann - $10 -> $48");
      return;
    }
    setRows(read.rows);
    const extras = [
      read.newNames.length > 0 ? `${read.newNames.join(", ")} ${read.newNames.length === 1 ? "isn't" : "aren't"} in the club yet and would be added as new. Rename in the table if it's someone listed.` : "",
      read.skipped.length > 0 ? `Skipped: ${read.skipped.slice(0, 3).join("; ")}.` : "",
    ].filter(Boolean);
    setSummary(`Found ${plural(read.rows.length, "player")}. Check the table, then add them to the ledger. ${extras.join(" ")}`.trim());
  };

  const readPicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setSummary("");
    try {
      const { text } = await accountApi.readNotesImage(await prepareNotesImage(file));
      setNotes(text);
      if (text.trim()) readNotes(text);
      else setSummary("Couldn't find any players in that picture. Try a clearer screenshot, or paste the text.");
    } catch (caught) {
      setSummary(caught instanceof AccountError ? caught.message : "Couldn't open that picture. Try another one, or paste the text.");
    } finally {
      setReading(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await accountApi.addNotesToLedger(filled);
      onAdded(next);
      setRows([]);
      setNotes("");
      setSummary(`Added ${plural(filled.length, "player")} to the ledger.`);
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="box-night-notes">
      <summary className="cursor-pointer text-sm font-semibold">Fill from notes</summary>
      <p className="mt-2 text-xs text-muted-foreground">Paste your notes or choose a screenshot. The entries are added to this night as the host.</p>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={6}
        placeholder={"Ann - $10 -> $48\nBo - $30 -> $5.10"}
        className="mt-3 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
        data-testid="input-night-notes"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={!notes.trim()} onClick={() => readNotes()} className={button} data-testid="button-night-notes-fill">
          Read the notes
        </button>
        <label className={`${button} cursor-pointer ${reading ? "opacity-60" : ""}`}>
          <FileUp className="h-4 w-4" />
          {reading ? "Reading the picture..." : "Or choose a screenshot"}
          <input type="file" accept="image/*" disabled={reading} onChange={(event) => void readPicture(event)} className="sr-only" data-testid="input-night-notes-image" />
        </label>
      </div>
      {summary && <p className="mt-2 text-xs text-muted-foreground" data-testid="status-night-notes">{summary}</p>}
      {rows.length > 0 && (
        <div className="mt-3" data-testid="table-night-notes">
          <datalist id="ledger-notes-roster">
            {roster.map((name) => <option key={name} value={name} />)}
          </datalist>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_5rem_5rem] gap-2">
                <input list="ledger-notes-roster" value={row.name} onChange={(event) => update(index, { name: event.target.value })} placeholder="Player" maxLength={40} aria-label="Player" className={field} data-testid={`input-notes-name-${index}`} />
                <input value={row.buyIn} onChange={(event) => update(index, { buyIn: event.target.value })} placeholder="Buy-in" inputMode="decimal" aria-label="Buy-in" className={field} data-testid={`input-notes-buyin-${index}`} />
                <input value={row.cashOut} onChange={(event) => update(index, { cashOut: event.target.value })} placeholder="Cash-out" inputMode="decimal" aria-label="Cash-out" className={field} data-testid={`input-notes-cashout-${index}`} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || filled.length === 0} onClick={() => void add()} className={primary} data-testid="button-notes-add">
              {busy ? "Adding..." : `Add ${plural(filled.length, "player")} to the ledger`}
            </button>
            <span className={`text-xs ${Math.abs(gap) > 0.5 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`} data-testid="text-notes-balance">
              {Math.abs(gap) > 0.5 ? `Out by $${Math.abs(gap).toFixed(2)}. You can still add it and choose how to balance when you close.` : "Balanced"}
            </span>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
    </details>
  );
}
