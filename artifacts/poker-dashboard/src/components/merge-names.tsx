import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AccountError, accountApi, type MergePreview } from "@/lib/account-api";
import { plural } from "@/lib/utils";
import { looksLikeJunk, suggestDuplicates, type PersonRow } from "@/lib/admin-people";

const field = "h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary";
const button =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-60 sm:w-auto";

function linesFor(preview: MergePreview): string[] {
  const lines: string[] = [];
  const quiet = preview.nights === 0 && preview.ledgerEntries === 0 && preview.tournaments === 0 && preview.jackpotPayouts === 0;
  if (quiet) lines.push(`Nothing is recorded under ${preview.merge} yet. Merging removes that name.`);
  if (preview.nights > 0) {
    const combined = preview.nightsCombined === 0 ? "" : ` ${plural(preview.nightsCombined, "night")} where both played will be added together.`;
    lines.push(`${plural(preview.nights, "recorded night")} will move onto ${preview.keep}.${combined}`);
  }
  if (preview.ledgerEntries > 0) lines.push(`${plural(preview.ledgerEntries, "ledger entry", "ledger entries")} will be renamed.`);
  if (preview.tournaments > 0) {
    const combined = preview.tournamentsCombined === 0 ? "" : ` ${plural(preview.tournamentsCombined, "result")} in a shared tournament will be added together.`;
    lines.push(`${plural(preview.tournaments, "tournament result")} will move.${combined}`);
  }
  if (preview.jackpotPayouts > 0) lines.push(`${plural(preview.jackpotPayouts, "jackpot payout")} will move.`);
  if (preview.hostNights > 0) lines.push(`Host of ${plural(preview.hostNights, "night")} will change to ${preview.keep}.`);
  if (preview.bankNights > 0) lines.push(`Bank of ${plural(preview.bankNights, "night")} will change to ${preview.keep}.`);
  if (preview.settlementsMoved > 0) {
    lines.push(`${plural(preview.settlementsMoved, "settle-up tick")} will move onto ${preview.keep}.`);
  }
  const ticksKept = preview.settlementsCombined - preview.settlementsCleared;
  if (ticksKept > 0) {
    lines.push(`Settle-up stays ticked on ${plural(ticksKept, "night")} where both names were already settled.`);
  }
  if (preview.settlementsCleared > 0) {
    lines.push(`${plural(preview.settlementsCleared, "settle-up tick")} on a night both names played will be cleared, because only one of them was settled.`);
  }
  if (preview.claim === "moves") lines.push(`The account linked to ${preview.merge} will use ${preview.keep} from now on.`);
  if (preview.picture === "moves") lines.push(`The profile picture on ${preview.merge} moves onto ${preview.keep}.`);
  if (preview.picture === "kept") lines.push(`${preview.keep} already has a profile picture, so that one stays.`);
  return lines;
}

/** Admin tool: fold a duplicate or misspelled name into the one the club wants to keep. */
export function MergeNames({ people, mine, onMerged }: { people: PersonRow[]; mine: string; onMerged?: () => void }) {
  const queryClient = useQueryClient();
  const [keep, setKeep] = useState("");
  const [merge, setMerge] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState("");
  const roster = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const names = roster.map((person) => person.name);
  const gamesOf = new Map(roster.map((person) => [person.name, person.played]));
  const label = (name: string) => {
    const games = gamesOf.get(name) ?? 0;
    return `${name} (${games === 0 ? "no games" : `${games} ${games === 1 ? "game" : "games"}`})`;
  };
  const needle = find.trim().toLowerCase();
  const visible = (name: string) => !needle || name.toLowerCase().includes(needle) || name === keep || name === merge;
  const hints = suggestDuplicates(roster).slice(0, 6);
  const junk = roster.filter((person) => looksLikeJunk(person) && person.played === 0 && !person.role);

  const clearPreview = () => {
    setPreview(null);
    setDone("");
  };

  const runPreview = (event: FormEvent) => {
    event.preventDefault();
    if (!keep || !merge || keep === merge) return;
    setBusy(true);
    setError("");
    setDone("");
    void accountApi
      .previewMerge({ keep, merge })
      .then(setPreview)
      .catch((caught: unknown) => {
        setPreview(null);
        setError(caught instanceof AccountError ? caught.message : "Couldn't preview that merge.");
      })
      .finally(() => setBusy(false));
  };

  const runMerge = () => {
    if (!preview) return;
    setBusy(true);
    setError("");
    void accountApi
      .mergePlayers({ keep: preview.keep, merge: preview.merge })
      .then(async (result) => {
        if (mine === result.merge || mine === result.keep) {
          window.location.reload();
          return;
        }
        await queryClient.invalidateQueries();
        onMerged?.();
        setKeep(result.keep);
        setMerge("");
        setPreview(null);
        setDone(`${result.merge} is now part of ${result.keep}.`);
      })
      .catch((caught: unknown) => setError(caught instanceof AccountError ? caught.message : "Couldn't merge those names."))
      .finally(() => setBusy(false));
  };

  return (
    <div data-testid="section-merge-names" className="mt-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Merge two names</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        When the same person was recorded under two names, move all of the duplicate&apos;s history onto the name you keep.
      </p>
      {hints.length > 0 && (
        <div className="mt-3" data-testid="list-merge-suggestions">
          <p className="text-xs font-semibold">Possible duplicates</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {hints.map(({ keep: k, merge: m }) => (
              <button
                key={`${k.playerId}-${m.playerId}`}
                type="button"
                className="inline-flex min-h-[36px] items-center rounded-full border border-border bg-background px-3 text-xs font-semibold hover:bg-secondary"
                onClick={() => {
                  setKeep(k.name);
                  setMerge(m.name);
                  setFind("");
                  clearPreview();
                }}
              >
                Merge {m.name} into {k.name}?
              </button>
            ))}
          </div>
        </div>
      )}
      {junk.length > 0 && (
        <div className="mt-3" data-testid="list-merge-junk">
          <p className="text-xs font-semibold">No games, odd names</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{junk.map((person) => person.name).join(", ")}. Merge them into a real name, or leave them if they are bookkeeping rows.</p>
        </div>
      )}
      {roster.length < 2 ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="text-merge-need-names">
            Add another name before merging.
          </p>
        ) : (
          <form onSubmit={runPreview} className="mt-4 space-y-3">
            <input
              type="search"
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder="Find a name"
              aria-label="Find a name to merge"
              data-testid="input-merge-find"
              className={field}
            />
            <label className="block text-xs font-semibold">
              Keep this name
              <select
                className={`${field} mt-1.5`}
                value={keep}
                data-testid="select-merge-keep"
                onChange={(event) => {
                  setKeep(event.target.value);
                  clearPreview();
                }}
              >
                <option value="">Choose a name</option>
                {names.filter((name) => name !== merge && visible(name)).map((name) => (
                  <option key={name} value={name}>{label(name)}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold">
              Merge this name into it
              <select
                className={`${field} mt-1.5`}
                value={merge}
                data-testid="select-merge-into"
                onChange={(event) => {
                  setMerge(event.target.value);
                  clearPreview();
                }}
              >
                <option value="">Choose a name</option>
                {names.filter((name) => name !== keep && visible(name)).map((name) => (
                  <option key={name} value={name}>{label(name)}</option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy || !keep || !merge || keep === merge} className={`${button} bg-secondary`} data-testid="button-merge-preview">
              {busy && !preview ? "Checking…" : "Preview"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" data-testid="status-merge-error" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {done && (
          <p data-testid="status-merge-done" className="mt-3 rounded-lg border border-chart-1/30 bg-chart-1/10 px-3 py-2 text-xs">
            {done}
          </p>
        )}
        {preview && (
          <div data-testid="panel-merge-preview" className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold" data-testid="text-merge-irreversible">
              This cannot be undone.
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {preview.merge} will be removed. Everything recorded under that name moves onto {preview.keep}.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6" data-testid="list-merge-preview">
              {linesFor(preview).map((line) => <li key={line}>{line}</li>)}
            </ul>
            <button
              type="button"
              disabled={busy}
              onClick={runMerge}
              data-testid="button-merge-confirm"
              className={`${button} mt-4 bg-destructive text-destructive-foreground`}
            >
              {busy ? "Merging…" : "Merge names"}
            </button>
          </div>
        )}
    </div>
  );
}
