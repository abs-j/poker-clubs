import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { FileUp, Link2, Plus, Trash2 } from "lucide-react";
import {
  AccountError,
  accountApi,
  type ImportPreview,
  type ImportSource,
  type NightRow,
  type TournamentImportPreview,
  type TournamentRow,
} from "@/lib/account-api";
import { parseNightNotes } from "@/lib/night-notes";
import { plural } from "@/lib/utils";
import { prepareNotesImage } from "@/lib/notes-image";
import { formatCurrency, formatDate } from "@/views/shared";

const button =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const primary =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const input = "h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string) => {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const sourceLabel = { live: "Live ledger", import: "Imported", manual: "Entered by hand" } as const;

function describe(error: unknown): string {
  return error instanceof AccountError ? error.message : "Something went wrong. Try again.";
}

/** Bringing past results in, recording a night by hand, and tidying what has been recorded. */
export function ClubDataPanel({ roster }: { roster: string[] }) {
  const [nights, setNights] = useState<NightRow[]>([]);
  const [tournaments, setTournaments] = useState<TournamentRow[]>([]);
  const loadNights = useCallback(() => {
    void accountApi.nights().then((result) => setNights(result.sessions)).catch(() => undefined);
    void accountApi.tournaments().then((result) => setTournaments(result.tournaments)).catch(() => undefined);
  }, []);
  useEffect(loadNights, [loadNights]);

  return (
    <div className="soft-shadow mt-4 rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="panel-club-data">
      <p className="section-label text-primary">Results</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">Club history</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Nights you close in the live ledger are recorded automatically. Bring in older results here, or enter a night by hand.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Your results are yours:{" "}
        <a href="/api/clubs/current/export.csv" download className="font-semibold text-primary underline" data-testid="link-export-csv">
          download them as a CSV
        </a>{" "}
        any time (cash nights; it can be imported back). Tournaments aren&apos;t in the file yet.
      </p>
      <ImportSection onDone={loadNights} />
      <ImportTournaments onDone={loadNights} />
      <RecordNight roster={roster} onDone={loadNights} />
      <RecordTournament roster={roster} onDone={loadNights} />
      <NightList nights={nights} tournaments={tournaments} onChanged={loadNights} />
    </div>
  );
}

/** Past tournaments from the "Tournament Log" and "Tournament Results" tabs, saved as CSV files or pasted. */
function ImportTournaments({ onDone }: { onDone: () => void }) {
  const [log, setLog] = useState({ text: "", name: "" });
  const [results, setResults] = useState({ text: "", name: "" });
  const [preview, setPreview] = useState<TournamentImportPreview | null>(null);
  const [done, setDone] = useState<{ imported: number; duplicates: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = log.text.trim().length > 0 && results.text.trim().length > 0;
  const tabs = { logText: log.text, resultsText: results.text };
  const reset = () => {
    setPreview(null);
    setDone(null);
    setError("");
  };

  // Both tabs can be chosen together and in any order: the Results tab is the one with a Player column.
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    if (files.some((file) => file.size > 1_500_000)) {
      setError("That file is too large. Split it into smaller files.");
      return;
    }
    void Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() }))).then((read) => {
      reset();
      for (const file of read) {
        const header = file.text.split(/\r?\n/).find((line) => /tournament id/i.test(line)) ?? "";
        if (/(^|,)\s*"?player"?\s*(,|$)/i.test(header)) setResults(file);
        else if (header) setLog(file);
        else setError(`${file.name} doesn't look like a tournament log or tournament results export.`);
      }
    });
  };

  const check = async () => {
    setBusy(true);
    reset();
    try {
      setPreview(await accountApi.previewTournamentImport(tabs));
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setDone(await accountApi.importTournaments(tabs));
      setPreview(null);
      onDone();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const fresh = preview?.preview.filter((row) => !row.alreadyRecorded).length ?? 0;
  return (
    <section className="mt-6" data-testid="section-import-tournaments">
      <p className="text-sm font-semibold">Import past tournaments</p>
      <p className="text-xs text-muted-foreground">
        Coming from a spreadsheet? Export your tournament log and tournament results sheets as CSV (File, Download, Comma-separated values) and choose both.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className={`${button} cursor-pointer`}>
          <FileUp className="h-4 w-4" />
          Choose both CSV files
          <input type="file" multiple accept=".csv,text/csv,text/plain" onChange={choose} className="sr-only" data-testid="input-tournament-files" />
        </label>
        <button type="button" disabled={busy || !ready} onClick={() => void check()} className={primary} data-testid="button-tournament-check">
          Check
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="status-tournament-files">
        {log.name ? `Log: ${log.name}` : "Log: not chosen yet"} · {results.name ? `Results: ${results.name}` : "Results: not chosen yet"}
      </p>
      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-tournament-error">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div className="mt-3 rounded-xl border border-border p-3 text-sm" data-testid="box-tournament-preview">
          <ul className="space-y-1 text-xs">
            {preview.preview.map((row) => (
              <li key={`${row.date}-${row.title}`}>
                <span className="font-semibold">{row.date}</span> {row.title}: {plural(row.players, "player")}, {formatCurrency(row.totalCollected)} collected
                {row.winner ? `, won by ${row.winner} (${formatCurrency(row.winnerPrize)})` : ""}
                {row.alreadyRecorded ? " (already recorded, will be skipped)" : ""}
              </li>
            ))}
          </ul>
          {preview.warnings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground" data-testid="list-tournament-warnings">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" disabled={busy || fresh === 0} onClick={() => void run()} className={`${primary} mt-3`} data-testid="button-tournament-run">
            {fresh === 0 ? "Nothing new to import" : `Import ${fresh} tournament${fresh === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}
      {done ? (
        <p className="mt-3 rounded-xl border border-border bg-secondary/40 p-3 text-xs" data-testid="box-tournament-done">
          Imported {done.imported} tournament{done.imported === 1 ? "" : "s"}
          {done.duplicates > 0 ? `; ${done.duplicates} already recorded ${done.duplicates === 1 ? "was" : "were"} skipped` : ""}. Reload to see them on the dashboard.
        </p>
      ) : null}
    </section>
  );
}

function ImportSection({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"paste" | "sheet">("paste");
  const [text, setText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [dateOrder, setDateOrder] = useState<"dmy" | "mdy">("dmy");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ preview: ImportPreview; warnings: string[]; rowsRead: number } | null>(null);
  const [result, setResult] = useState<{ batchId: string; imported: number; playersAdded: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const source = useMemo<ImportSource>(
    () => (mode === "sheet" ? { sheetUrl: sheetUrl.trim(), dateOrder } : { text, dateOrder }),
    [mode, sheetUrl, text, dateOrder],
  );
  const ready = mode === "sheet" ? sheetUrl.trim().length > 0 : text.trim().length > 0;
  const reset = () => {
    setPreview(null);
    setResult(null);
    setError("");
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setError("That file is too large. Split it into smaller files.");
      return;
    }
    void file.text().then((content) => {
      setText(content);
      setFileName(file.name);
      reset();
    });
  };

  const check = async () => {
    setBusy(true);
    reset();
    try {
      setPreview(await accountApi.previewImport(source));
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await accountApi.importHistory(source));
      setPreview(null);
      onDone();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6" data-testid="section-import">
      <p className="text-sm font-semibold">Import past results</p>
      <p className="text-xs text-muted-foreground">
        A spreadsheet with Date, Player, Buy-in and Cash-out columns. The date can be on the first row of each night only.
      </p>
      <div role="tablist" className="mt-3 grid max-w-xs grid-cols-2 rounded-xl bg-secondary/60 p-1 text-xs font-semibold">
        {(["paste", "sheet"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => {
              setMode(value);
              reset();
            }}
            data-testid={`tab-import-${value}`}
            className={`h-8 rounded-lg ${mode === value ? "bg-background shadow-sm" : "text-muted-foreground"}`}
          >
            {value === "paste" ? "Paste or file" : "Google Sheet"}
          </button>
        ))}
      </div>

      {mode === "paste" ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              reset();
            }}
            rows={6}
            placeholder={"Date\tPlayer\tBuy-in\tCash-out\n13/03/2026\tSam\t$20\t$35"}
            data-testid="input-import-text"
            className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus:border-primary"
          />
          <label className={`${button} cursor-pointer`}>
            <FileUp className="h-4 w-4" />
            {fileName || "Choose a CSV file"}
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={onFile} className="sr-only" data-testid="input-import-file" />
          </label>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={sheetUrl}
              onChange={(event) => {
                setSheetUrl(event.target.value);
                reset();
              }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              data-testid="input-import-sheet"
              className={`${input} flex-1`}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Share the sheet as &ldquo;Anyone with the link can view&rdquo;. The link&apos;s tab (gid) is the one imported.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Dates are
          <select
            value={dateOrder}
            onChange={(event) => {
              setDateOrder(event.target.value as "dmy" | "mdy");
              reset();
            }}
            className="h-10 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
            data-testid="select-date-order"
          >
            <option value="dmy">day / month / year</option>
            <option value="mdy">month / day / year</option>
          </select>
        </label>
        <button type="button" disabled={busy || !ready} onClick={() => void check()} className={primary} data-testid="button-import-check">
          {busy && !preview ? "Reading…" : "Check it"}
        </button>
      </div>

      {error && (
        <p role="alert" data-testid="status-import-error" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-3 rounded-xl border border-border p-3 text-sm" data-testid="box-import-preview">
          <p className="font-semibold">
            {preview.preview.nights} night{preview.preview.nights === 1 ? "" : "s"} ready
            {preview.preview.firstDate && preview.preview.lastDate ? ` · ${formatDate(preview.preview.firstDate)} to ${formatDate(preview.preview.lastDate)}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {plural(preview.preview.players, "player")}
            {preview.preview.newPlayers.length > 0 ? `, ${preview.preview.newPlayers.length} new to the roster` : ""}
            {preview.preview.duplicates > 0 ? ` · ${preview.preview.duplicates} already recorded, skipped` : ""}
          </p>
          {preview.preview.newPlayers.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold">New names</summary>
              <p className="mt-1 text-muted-foreground">{preview.preview.newPlayers.join(", ")}</p>
            </details>
          )}
          {preview.warnings.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-semibold text-amber-700 dark:text-amber-300">
                {preview.warnings.length} thing{preview.warnings.length === 1 ? "" : "s"} to look at
              </summary>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <button
            type="button"
            disabled={busy || preview.preview.nights === 0}
            onClick={() => void run()}
            className={`${primary} mt-3`}
            data-testid="button-import-run"
          >
            {preview.preview.nights === 0 ? "Nothing new to import" : `Import ${preview.preview.nights} night${preview.preview.nights === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm" data-testid="box-import-done">
          <p className="font-semibold">
            Imported {result.imported} night{result.imported === 1 ? "" : "s"}
            {result.playersAdded > 0 ? ` and ${result.playersAdded} new players` : ""}.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => window.location.reload()} data-testid="button-import-reload">
              See the leaderboard
            </button>
            {result.imported > 0 && (
              <button
                type="button"
                className={button}
                onClick={() => void accountApi.undoImport(result.batchId).then(() => { setResult(null); onDone(); }).catch((e) => setError(describe(e)))}
              >
                Undo this import
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

type Row = { name: string; buyIn: string; cashOut: string };
const emptyRows = (): Row[] => Array.from({ length: 4 }, () => ({ name: "", buyIn: "", cashOut: "" }));

function RecordNight({ roster, onDone }: { roster: string[]; onDone: () => void }) {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<Row[]>(emptyRows);
  const [notes, setNotes] = useState("");
  const [noteSummary, setNoteSummary] = useState("");
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filled = rows.filter((row) => row.name.trim());
  const buy = filled.reduce((sum, row) => sum + money(row.buyIn), 0);
  const cash = filled.reduce((sum, row) => sum + money(row.cashOut), 0);
  const gap = Math.round((cash - buy) * 100) / 100;

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  // Fills the table from pasted notes such as "Ann - $10 -> $48", one player per line.
  const fillFromNotes = (text = notes) => {
    const read = parseNightNotes(text, roster);
    if (read.rows.length === 0) {
      setNoteSummary("Couldn't find any players. Use one line per player, like: Ann - $10 -> $48");
      return;
    }
    setRows([...read.rows, ...emptyRows().slice(0, 2)]);
    const extras = [
      read.newNames.length > 0 ? `${read.newNames.join(", ")} ${read.newNames.length === 1 ? "isn't" : "aren't"} in the club yet and would be added as new. Rename in the table if it's someone listed.` : "",
      read.skipped.length > 0 ? `Skipped: ${read.skipped.slice(0, 3).join("; ")}.` : "",
    ].filter(Boolean);
    setNoteSummary(`Filled in ${plural(read.rows.length, "player")}. Check the table, then save. ${extras.join(" ")}`.trim());
  };

  // A screenshot or photo of the notes is read into text, shown in the box, and used to fill the table.
  const readPicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setNoteSummary("");
    try {
      const { text } = await accountApi.readNotesImage(await prepareNotesImage(file));
      setNotes(text);
      if (text.trim()) fillFromNotes(text);
      else setNoteSummary("Couldn't find any players in that picture. Try a clearer screenshot, or paste the text.");
    } catch (caught) {
      setNoteSummary(caught instanceof AccountError ? caught.message : "Couldn't open that picture. Try another one, or paste the text.");
    } finally {
      setReading(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await accountApi.recordNight({ date, players: filled });
      setMessage(result.balanced ? "Night recorded." : `Night recorded, but it is out by $${Math.abs(result.difference).toFixed(2)}.`);
      setRows(emptyRows());
      onDone();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 border-t border-border/70 pt-6" data-testid="section-record-night">
      <p className="text-sm font-semibold">Record a night</p>
      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor="night-date">Date</label>
        <input id="night-date" type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} className={input} data-testid="input-night-date" />
      </div>
      <details className="mt-3 rounded-xl border border-border p-3" data-testid="box-night-notes">
        <summary className="cursor-pointer text-xs font-semibold">Paste from your notes</summary>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={6}
          placeholder={"Ann - $10 -> $48\nBo - $30 -> $5.10"}
          className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary"
          data-testid="input-night-notes"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={!notes.trim()} onClick={() => fillFromNotes()} className={button} data-testid="button-night-notes-fill">
            Fill the table
          </button>
          <label className={`${button} cursor-pointer ${reading ? "opacity-60" : ""}`}>
            <FileUp className="h-4 w-4" />
            {reading ? "Reading the picture..." : "Or choose a screenshot"}
            <input type="file" accept="image/*" disabled={reading} onChange={(event) => void readPicture(event)} className="sr-only" data-testid="input-night-notes-image" />
          </label>
        </div>
      </details>
      {noteSummary && <p className="mt-2 text-xs text-muted-foreground" data-testid="status-night-notes">{noteSummary}</p>}
      <datalist id="club-roster">
        {roster.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-2">
            <input
              list="club-roster"
              value={row.name}
              onChange={(event) => update(index, { name: event.target.value })}
              placeholder="Player"
              maxLength={40}
              className={input}
              data-testid={`input-night-name-${index}`}
            />
            <input value={row.buyIn} onChange={(event) => update(index, { buyIn: event.target.value })} placeholder="Buy-in" inputMode="decimal" className={input} data-testid={`input-night-buyin-${index}`} />
            <input value={row.cashOut} onChange={(event) => update(index, { cashOut: event.target.value })} placeholder="Cash-out" inputMode="decimal" className={input} data-testid={`input-night-cashout-${index}`} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={() => setRows((current) => [...current, ...emptyRows().slice(0, 2)])}>
          <Plus className="h-4 w-4" />
          More players
        </button>
        <button type="button" disabled={busy || filled.length < 2} onClick={() => void save()} className={primary} data-testid="button-night-save">
          Save night
        </button>
        {filled.length > 0 && (
          <span className={`text-xs ${Math.abs(gap) > 0.5 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`} data-testid="text-night-balance">
            {Math.abs(gap) > 0.5 ? `Out by $${Math.abs(gap).toFixed(2)}` : "Balanced"}
          </span>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {message && <p data-testid="status-night-saved" className="mt-3 text-xs font-semibold">{message} <button type="button" className="underline" onClick={() => window.location.reload()}>See the leaderboard</button></p>}
    </section>
  );
}

function NightList({ nights, tournaments, onChanged }: { nights: NightRow[]; tournaments: TournamentRow[]; onChanged: () => void }) {
  const [error, setError] = useState("");
  if (nights.length === 0 && tournaments.length === 0) return null;
  return (
    <section className="mt-8 border-t border-border/70 pt-6" data-testid="section-night-list">
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {nights.length > 0 && <p className="text-sm font-semibold">Recorded nights ({nights.length})</p>}
      <ul className={`mt-2 max-h-80 divide-y divide-border/70 overflow-y-auto rounded-xl border border-border ${nights.length === 0 ? "hidden" : ""}`}>
        {nights.map((night) => (
          <li key={night.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-semibold">{night.date}</p>
              <p className="text-[11px] text-muted-foreground">
                {plural(night.players, "player")} · ${night.totalBuyIn.toFixed(2)} in · {sourceLabel[night.source]}
              </p>
            </div>
            {night.source !== "live" && (
              <button
                type="button"
                aria-label={`Delete the night of ${night.date}`}
                className={button}
                onClick={() => {
                  if (window.confirm(`Delete the night of ${night.date}? This changes everyone's totals.`)) {
                    setError("");
                    void accountApi.deleteNight(night.id).then(onChanged).catch((e) => setError(describe(e)));
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {tournaments.length > 0 && (
        <>
          <p className="mt-6 text-sm font-semibold">Recorded tournaments ({tournaments.length})</p>
          <ul className="mt-2 divide-y divide-border/70 rounded-xl border border-border" data-testid="list-tournaments">
            {tournaments.map((tournament) => (
              <li key={tournament.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{tournament.title}</p>
                  <p className="text-[11px] text-muted-foreground">{tournament.date} · {plural(tournament.players, "player")} · {plural(tournament.entries, "entry", "entries")}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${tournament.title}`}
                  className={button}
                  onClick={() => {
                    if (window.confirm(`Delete "${tournament.title}"? This changes everyone's totals and points.`)) {
                      setError("");
                      void accountApi.deleteTournament(tournament.id).then(onChanged).catch((e) => setError(describe(e)));
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

type TRow = { name: string; entries: string; knockouts: string; payout: string };
const emptyTournamentRows = (): TRow[] => Array.from({ length: 4 }, () => ({ name: "", entries: "1", knockouts: "0", payout: "" }));

/** A tournament: list the players in the order they finished; the place is their position. */
function RecordTournament({ roster, onDone }: { roster: string[]; onDone: () => void }) {
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
    <section className="mt-8 border-t border-border/70 pt-6" data-testid="section-record-tournament">
      <p className="text-sm font-semibold">Record a tournament</p>
      <p className="text-xs text-muted-foreground">List the players in the order they finished. Prizes are worked out from the shares, or enter them yourself.</p>
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
