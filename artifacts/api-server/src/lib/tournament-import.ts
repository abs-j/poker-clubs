// Reads a club's past tournaments out of its "Tournament Log" and "Tournament Results" tabs
// (pasted or uploaded CSV) and turns each into the same input the record-a-tournament form
// sends. What the sheet recorded is kept: places, entries, knockouts and what was paid. Each
// tournament is then rebuilt the way the app works it out and compared with the sheet's own
// totals, so a difference is reported instead of silently imported.
// No database or network access, so it can be unit tested.
import { parseDelimited } from "./import-parse.ts";
import { buildTournamentEvent, validateTournament, type TournamentInput } from "./tournament-native.ts";
import { parseBool, parseTournamentLog } from "./tournament-parse.ts";

export type TournamentImportResult = {
  tournaments: TournamentInput[];
  warnings: string[];
  error?: string;
};

const MAX_WARNINGS = 25;
const headerKey = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");

/** Whether each tournament lets its winner keep their own bounty, by tournament id. */
function winnerKeepsBountyById(logRows: string[][]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const headerIndex = logRows.findIndex((row) => row.some((cell) => headerKey(cell) === "tournament id"));
  if (headerIndex < 0) return out;
  const header = logRows[headerIndex].map(headerKey);
  const idColumn = header.indexOf("tournament id");
  const keepsColumn = header.indexOf("winner keeps own bounty");
  if (keepsColumn < 0) return out;
  for (const row of logRows.slice(headerIndex + 1)) {
    const id = (row[idColumn] ?? "").trim();
    if (id) out.set(id, parseBool(row[keepsColumn]));
  }
  return out;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.015;

export function parseTournamentImport(logText: string, resultsText: string): TournamentImportResult {
  const empty = (error: string): TournamentImportResult => ({ tournaments: [], warnings: [], error });
  if (!logText.trim() || !resultsText.trim()) return empty("Paste or choose both the Tournament Log and the Tournament Results.");

  const logRows = parseDelimited(logText);
  const resultRows = parseDelimited(resultsText);
  const events = parseTournamentLog(logRows, resultRows);
  if (events.length === 0) {
    return empty("No completed tournaments could be read. The Log needs a Tournament ID, Date and Status column, and the Results the same Tournament ID.");
  }
  const keeps = winnerKeepsBountyById(logRows);

  const warnings: string[] = [];
  const warn = (message: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(message);
    else if (warnings.length === MAX_WARNINGS) warnings.push("…and more.");
  };

  const tournaments: TournamentInput[] = [];
  for (const event of events) {
    const label = `${event.date} ${event.title}`;
    if (event.dataCheck && !/ok/i.test(event.dataCheck)) warn(`${label}: the sheet's own data check says "${event.dataCheck}".`);

    // Prize shares are stored as whole percentages; the actual payouts below are what count.
    const first = Math.round(event.shares.first);
    const second = Math.round(event.shares.second);
    const third = Math.max(0, Math.min(Math.round(event.shares.third), 100 - first - second));

    const checked = validateTournament(
      {
        date: event.date,
        title: event.title,
        venue: event.venue,
        notes: event.notes,
        buyIn: event.buyIn,
        topUp: event.topUp,
        bounty: event.bounty,
        startingStack: event.startingStack,
        winnerKeepsBounty: keeps.get(event.id) ?? false,
        shares: { first, second, third },
        players: event.results.map((result) => ({
          name: result.player,
          finishPlace: result.finishPlace,
          entries: result.entries,
          topUp: result.topUp,
          freeEntry: result.freeEntry,
          knockouts: result.knockouts,
          payout: result.mainPrize > 0 ? result.mainPrize : null,
        })),
      },
      event.id,
    );
    if ("error" in checked) {
      warn(`${label}: skipped. ${checked.error}`);
      continue;
    }

    const rebuilt = buildTournamentEvent(checked.value);
    const gaps: string[] = [];
    if (!close(rebuilt.totalCollected, event.totalCollected)) gaps.push(`collected $${rebuilt.totalCollected} vs $${event.totalCollected}`);
    if (!close(rebuilt.bountyPool, event.bountyPool)) gaps.push(`bounty pool $${rebuilt.bountyPool} vs $${event.bountyPool}`);
    if (!close(rebuilt.mainPrizePool, event.mainPrizePool)) gaps.push(`main prize pool $${rebuilt.mainPrizePool} vs $${event.mainPrizePool}`);
    const sheetByPlayer = new Map(event.results.map((result) => [result.player.toLowerCase(), result]));
    const off = rebuilt.results.filter((result) => {
      const original = sheetByPlayer.get(result.player.toLowerCase());
      return original && !close(result.netProfit, original.netProfit);
    });
    if (off.length > 0) gaps.push(`profit differs for ${off.slice(0, 4).map((result) => result.player).join(", ")}${off.length > 4 ? "…" : ""}`);
    if (gaps.length > 0) warn(`${label}: the app works this out differently from the sheet (${gaps.join("; ")}). Imported as recorded.`);

    tournaments.push(checked.value);
  }

  if (tournaments.length === 0) return { tournaments, warnings, error: "None of those tournaments could be imported." };
  return { tournaments, warnings };
}
