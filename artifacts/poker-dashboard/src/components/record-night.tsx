import { useMemo, useState, type ChangeEvent } from "react";
import { FileUp, X } from "lucide-react";
import { AccountError, accountApi, type AiStatus, type RecordBalanceChoice } from "@/lib/account-api";
import { clubToday } from "@/lib/club-format";
import { parseNightNotes, type NoteRow } from "@/lib/night-notes";
import { prepareNotesImage } from "@/lib/notes-image";
import { balanceGap, shareShortfall } from "@/lib/record-night";
import { plural } from "@/lib/utils";

const button =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const primary =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const field = "h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const money = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

type Props = { roster: string[]; ai: AiStatus | null; onSaved: () => void; onOpenSettings: () => void };

/**
 * Record a finished night from notes. Paste text or choose a photo, read it (with the club's AI reader when
 * it is set up, otherwise the plain reader), correct the rows, settle any gap and save. Admins only.
 */
export function RecordNight({ roster, ai, onSaved, onOpenSettings }: Props) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [date, setDate] = useState(clubToday());
  const [note, setNote] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  // How to settle a gap: "jackpot" for a surplus, or per-player amounts to take off for a shortfall.
  const [takeOff, setTakeOff] = useState<Record<number, string>>({});

  const gap = useMemo(() => balanceGap(rows), [rows]);
  const filled = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.name.trim());
  const takenCents = Object.entries(takeOff).reduce((sum, [index, value]) => (rows[Number(index)]?.name.trim() ? sum + (Math.round(Number(value) * 100) || 0) : sum), 0);
  const remaining = gap.direction === "under" ? gap.cents - takenCents : gap.cents;
  const settled = gap.direction === "balanced" || (gap.direction === "over" ? true : remaining === 0);

  const update = (index: number, patch: Partial<NoteRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const reset = () => { setRows([]); setTakeOff({}); };

  const showRows = (lines: string) => {
    const read = parseNightNotes(lines, roster);
    reset();
    if (read.rows.length === 0) {
      setInfo("Couldn't find any players. Try one line per player, like: Ann in 20 out 30");
      return;
    }
    setRows(read.rows);
    const extras = [
      read.newNames.length > 0 ? `${read.newNames.join(", ")} ${read.newNames.length === 1 ? "isn't" : "aren't"} in the club yet and will be added as new.` : "",
      read.skipped.length > 0 ? `Skipped: ${read.skipped.slice(0, 3).join("; ")}.` : "",
    ].filter(Boolean);
    setInfo(`Found ${plural(read.rows.length, "player")}. Check the table below. ${extras.join(" ")}`.trim());
  };

  const readText = async () => {
    setError("");
    if (!ai?.enabled) return showRows(text);
    setReading(true);
    try {
      showRows((await accountApi.parseNotesAi({ text })).text);
    } catch (caught) {
      // The AI reader being down never blocks recording: fall back to the plain reader.
      setError(caught instanceof AccountError ? `${caught.message} Using the plain reader instead.` : "The AI reader failed. Using the plain reader instead.");
      showRows(text);
    } finally {
      setReading(false);
    }
  };

  const readPicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setError("");
    try {
      showRows((await accountApi.parseNotesAi({ image: await prepareNotesImage(file), text })).text);
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Couldn't open that picture. Try another one, or paste the text.");
    } finally {
      setReading(false);
    }
  };

  const shareEvenly = () => {
    const shares = shareShortfall(rows.map((row) => ({ name: row.name, cashOutCents: Math.round(Number(row.cashOut) * 100) || 0 })), gap.cents);
    setTakeOff(Object.fromEntries(shares.map((cents, index) => [index, cents > 0 ? (cents / 100).toFixed(2) : ""])));
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      let resolution: RecordBalanceChoice | null = null;
      if (gap.direction === "over") resolution = { mode: "jackpot" };
      if (gap.direction === "under") {
        resolution = {
          mode: "custom",
          deductions: filled.flatMap(({ row, index }) => {
            const cents = Math.round(Number(takeOff[index]) * 100) || 0;
            return cents > 0 ? [{ name: row.name.trim(), cents }] : [];
          }),
        };
      }
      await accountApi.recordNight({ date, notes: note, players: filled.map(({ row }) => ({ ...row, name: row.name.trim() })), resolution });
      setText(""); setNote(""); reset();
      setInfo("Night recorded. It's on the leaderboard now.");
      onSaved();
    } catch (caught) {
      setError(caught instanceof AccountError ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5" data-testid="section-record-night">
      <h2 className="text-base font-semibold">Paste your notes</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Write it however you do in your notes app, like "abhay in 20, out 30, +10", one player per line.
        {ai?.enabled ? " The club's AI reader tidies it up." : ""}
      </p>
      {ai && !ai.enabled && (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="text-record-ai-off">
          AI reader is off, so photos and messy notes won't work.{" "}
          <button type="button" onClick={onOpenSettings} className="font-semibold text-primary hover:underline" data-testid="button-record-ai-setup">Turn it on in club settings →</button>
        </p>
      )}
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} placeholder={"abhay in 20, out 30, +10\nann 10 -> 48\nbo in 30 out 5.10"} className="mt-3 w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-primary" data-testid="input-record-text" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={!text.trim() || reading} onClick={() => void readText()} className={primary} data-testid="button-record-read">
          {reading ? "Reading..." : ai?.enabled ? "Read with AI" : "Read the notes"}
        </button>
        {ai?.enabled && (
          <label className={`${button} cursor-pointer ${reading ? "opacity-60" : ""}`}>
            <FileUp className="h-4 w-4" />
            Or choose a photo
            <input type="file" accept="image/*" disabled={reading} onChange={(event) => void readPicture(event)} className="sr-only" data-testid="input-record-image" />
          </label>
        )}
      </div>
      {info && <p className="mt-2 text-xs text-muted-foreground" data-testid="status-record-info">{info}</p>}

      {rows.length > 0 && (
        <div className="mt-4 space-y-4" data-testid="table-record-rows">
          <datalist id="record-roster">{roster.map((name) => <option key={name} value={name} />)}</datalist>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_4.5rem_4.5rem_2.5rem] gap-2 text-[11px] font-semibold text-muted-foreground"><span>Player</span><span>Buy-in</span><span>Cash-out</span><span /></div>
            {rows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_4.5rem_4.5rem_2.5rem] gap-2">
                <input list="record-roster" value={row.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="Player" maxLength={40} className={field} data-testid={`input-record-name-${index}`} />
                <input value={row.buyIn} onChange={(event) => update(index, { buyIn: event.target.value })} inputMode="decimal" aria-label="Buy-in" className={field} data-testid={`input-record-buyin-${index}`} />
                <input value={row.cashOut} onChange={(event) => update(index, { cashOut: event.target.value })} inputMode="decimal" aria-label="Cash-out" className={field} data-testid={`input-record-cashout-${index}`} />
                <button type="button" onClick={() => { setRows((current) => current.filter((_, i) => i !== index)); setTakeOff({}); }} aria-label={`Remove ${row.name || "row"}`} className={`${button} px-0`} data-testid={`button-record-remove-${index}`}><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setRows((current) => [...current, { name: "", buyIn: "", cashOut: "" }])} className={button} data-testid="button-record-add-row">Add a player</button>
          </div>

          {gap.direction === "over" && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid="text-record-over">
              Buy-ins are {money(gap.cents)} more than cash-outs. That {money(gap.cents)} goes into the bad beat jackpot when you save. To change that, fix an amount above.
            </p>
          )}
          {gap.direction === "under" && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid="box-record-under">
              <p>Cash-outs are {money(gap.cents)} more than buy-ins. Take amounts off any players until it matches, or fix an amount above.</p>
              <div className="mt-2 space-y-2">
                {filled.map(({ row, index }) => (
                  <label key={index} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-semibold">{row.name} <span className="font-normal text-muted-foreground">cashed out ${row.cashOut || "0"}</span></span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">take off $</span>
                      <input value={takeOff[index] ?? ""} onChange={(event) => setTakeOff((current) => ({ ...current, [index]: event.target.value }))} inputMode="decimal" aria-label={`Take off ${row.name}`} className={`${field} h-9 w-20`} data-testid={`input-record-takeoff-${index}`} />
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={shareEvenly} className={button} data-testid="button-record-share">Share evenly</button>
                <button type="button" onClick={() => setTakeOff({})} className={button}>Clear</button>
                <span className={remaining === 0 ? "font-semibold text-emerald-700 dark:text-emerald-300" : "font-semibold"} data-testid="text-record-remaining">
                  {remaining === 0 ? "Balanced" : remaining > 0 ? `${money(remaining)} still to take off` : `${money(remaining)} too much taken off`}
                </span>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <label className="text-[11px] font-semibold text-muted-foreground">
              Date
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${field} mt-1 w-full font-normal text-foreground`} data-testid="input-record-date" />
            </label>
            <label className="text-[11px] font-semibold text-muted-foreground">
              Note for this night (optional)
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={2} placeholder="Who paid cash, a big hand, house rules that night" className="mt-1 w-full rounded-lg border border-border bg-background p-3 text-sm font-normal text-foreground outline-none focus:border-primary" data-testid="input-record-note" />
            </label>
          </div>
          <button type="button" disabled={busy || !settled || filled.length < 2 || !date} onClick={() => void save()} className={primary} data-testid="button-record-save">
            {busy ? "Saving..." : `Save night (${plural(filled.length, "player")})`}
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="status-record-error">{error}</p>}
    </section>
  );
}
