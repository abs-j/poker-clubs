import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import { AccountError, accountApi, type AiStatus } from "@/lib/account-api";
import { clubToday } from "@/lib/club-format";
import { parseNightNotes } from "@/lib/night-notes";
import { prepareNotesImage } from "@/lib/notes-image";
import { NightTable, useNightJackpot, type NightRow } from "@/components/night-table";
import { centsOf, remainingCents } from "@/lib/night-table";
import { plural } from "@/lib/utils";
import { firstGameFlags, type PersonRow } from "@/lib/admin-people";

const button =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary disabled:opacity-60";
const primary =
  "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60";
const field = "h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary";

type Props = { roster: string[]; ai: AiStatus | null; onSaved: () => void; onOpenSettings: () => void };

/**
 * Record a finished night from notes. Paste text or choose a photo, read it (with the club's AI reader when
 * it is set up, otherwise the plain reader), correct the rows, settle any gap and save. Admins only.
 */
export function RecordNight({ roster, ai, onSaved, onOpenSettings }: Props) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<NightRow[]>([]);
  const [bank, setBank] = useState("");
  const [date, setDate] = useState(clubToday());
  const [note, setNote] = useState("");
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const jackpot = useNightJackpot(rows);

  // How many games each name already has, so a first game under a near-match can be questioned.
  const loadPeople = useCallback(() => {
    Promise.all([accountApi.members(), accountApi.adminOverview()])
      .then(([roster, overview]) => {
        const played = new Map(overview.played.map((row) => [row.playerId, row.nights + row.tournaments]));
        setPeople(roster.members.map((m) => ({ playerId: m.playerId, name: m.name, role: m.role, played: played.get(m.playerId) ?? 0 })));
      })
      .catch(() => undefined);
  }, []);
  useEffect(loadPeople, [loadPeople, roster.length]);
  const flags = useMemo(
    () => firstGameFlags(rows.map((row) => row.name), people).filter((flag) => !dismissed.includes(flag.name.toLowerCase())),
    [rows, people, dismissed],
  );
  const useName = (from: string, to: string) =>
    setRows((current) => current.map((row) => (row.name.trim().toLowerCase() === from.toLowerCase() ? { ...row, name: to } : row)));
  const filled = rows.filter((row) => row.name.trim());
  const settled = remainingCents(rows, centsOf(jackpot.jackpot)) === 0;

  const reset = () => { setRows([]); jackpot.reset(); setDismissed([]); };

  const showRows = (lines: string) => {
    const read = parseNightNotes(lines, roster);
    reset();
    if (read.rows.length === 0) {
      setInfo("Couldn't find any players. Try one line per player, like: Ann in 20 out 30");
      return;
    }
    setRows(read.rows.map((row) => ({ ...row, adjustment: "" })));
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

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await accountApi.recordNight({
        date,
        notes: note,
        bank: bank.trim() || null,
        jackpot: jackpot.jackpot,
        players: filled.map((row) => ({ ...row, name: row.name.trim() })),
      });
      setText(""); setNote(""); setBank(""); reset();
      setInfo("Night recorded. It's on the leaderboard now.");
      loadPeople();
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
            <input type="file" accept="image/*" disabled={reading} onChange={(event) => void readPicture(event)} className="sr-only" aria-label="Choose a photo of the notes" data-testid="input-record-image" />
          </label>
        )}
      </div>
      {info && <p className="mt-2 text-xs text-muted-foreground" data-testid="status-record-info">{info}</p>}

      {rows.length > 0 && (
        <div className="mt-4 space-y-4" data-testid="table-record-rows">
          <datalist id="record-roster">{roster.map((name) => <option key={name} value={name} />)}</datalist>
          <NightTable rows={rows} onRows={setRows} jackpot={jackpot.jackpot} onJackpot={jackpot.setJackpot} suggestedJackpotCents={jackpot.suggested} datalistId="record-roster" testPrefix="record" />
          {flags.length > 0 && (
            <div role="status" data-testid="panel-record-name-flags" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-sm font-semibold">Check these names before saving</p>
              <ul className="mt-2 space-y-3">
                {flags.map((flag) => (
                  <li key={flag.name} className="text-xs leading-5" data-testid={`flag-record-name-${flag.name.toLowerCase()}`}>
                    <p>
                      <span className="font-semibold">{flag.name}</span> {flag.isNew ? "is new to the club" : "has no games yet"}, and looks like
                      {" "}{flag.matches.map((match) => `${match.name} (${plural(match.played, "game")})`).join(" or ")}. A misspelling becomes a separate person.
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {flag.matches.map((match) => (
                        <button key={match.playerId} type="button" className={button} data-testid={`button-record-use-${match.playerId}`} onClick={() => useName(flag.name, match.name)}>
                          Use {match.name}
                        </button>
                      ))}
                      <button type="button" className={button} onClick={() => setDismissed((value) => [...value, flag.name.toLowerCase()])}>
                        {flag.name} is a different person
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="block text-[11px] font-semibold text-muted-foreground">
            Bank (who holds the cash, optional)
            <input list="record-roster" value={bank} onChange={(event) => setBank(event.target.value)} maxLength={40} className={`${field} mt-1 w-full font-normal text-foreground`} data-testid="input-record-bank" />
          </label>

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
