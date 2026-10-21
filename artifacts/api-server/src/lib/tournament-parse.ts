// Parses the "Tournament Log" and "Tournament Results" tabs. Values arrive as the sheet
// displays them ("$10.00", "($20.00)", "-", "744%", "10,000", "TRUE"), so every reader here
// is forgiving. Columns are found by header name, so reordering them in the sheet is safe.
// No database or network access, so it can be unit tested.

export type TournamentResultRow = {
  player: string;
  entries: number;
  rebuys: number;
  topUp: boolean;
  freeEntry: boolean;
  /** Null when the finishing order was not recorded for this player. */
  finishPlace: number | null;
  knockouts: number;
  /** Who knocked this player out for the last time, when recorded. */
  eliminatedBy: string | null;
  invested: number;
  bountiesWon: number;
  mainPrize: number;
  totalReturn: number;
  netProfit: number;
  inTheMoney: boolean;
};

export type TournamentEvent = {
  id: string;
  date: string;
  title: string;
  status: string;
  format: string;
  startTime: string | null;
  venue: string | null;
  buyIn: number;
  topUp: number;
  bounty: number;
  bountyBasis: string | null;
  startingStack: number;
  topUpStack: number;
  /** Prize shares for 1st, 2nd and 3rd as percentages (50 means 50%). */
  shares: { first: number; second: number; third: number };
  players: number;
  entries: number;
  rebuys: number;
  topUps: number;
  freeEntries: number;
  knockouts: number;
  totalCollected: number;
  bountyPool: number;
  mainPrizePool: number;
  winner: string | null;
  runnerUp: string | null;
  thirdPlace: string | null;
  winnerPrize: number;
  topBountyHunter: string | null;
  mostKnockouts: number;
  notes: string | null;
  /** The sheet's own consistency check, e.g. "OK". Anything else is shown as a warning. */
  dataCheck: string | null;
  results: TournamentResultRow[];
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const headerKey = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** "$1,250.50" -> 1250.5, "($20.00)" -> -20, "-" or "" -> 0, "12%" -> 12. */
export function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/[−–—]/g, "-");
  if (!raw || raw === "-") return 0;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const digits = raw.replace(/[^0-9.]/g, "");
  if (!digits || digits === ".") return 0;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

export function parseInteger(value: unknown): number {
  return Math.round(parseNumber(value));
}

export function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return /^(true|yes|y|1)$/i.test(text(value));
}

const emptyToNull = (value: unknown): string | null => {
  const cleaned = text(value);
  return cleaned && cleaned !== "-" ? cleaned : null;
};

/** A "YYYY-MM-DD" date, or null. Accepts the ISO form the sheet shows. */
function parseDate(value: unknown): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

type Columns = Map<string, number>;

function readHeader(values: unknown[][], mustContain: string): { columns: Columns; start: number } | null {
  const index = values.findIndex((row) => row.some((cell) => headerKey(cell) === mustContain));
  if (index < 0) return null;
  const columns: Columns = new Map();
  values[index].forEach((cell, position) => {
    const key = headerKey(cell);
    if (key && !columns.has(key)) columns.set(key, position);
  });
  return { columns, start: index + 1 };
}

const cellReader = (columns: Columns, row: unknown[]) => (header: string): unknown => {
  const position = columns.get(header);
  return position === undefined ? undefined : row[position];
};

export function parseTournamentResults(values: unknown[][]): Map<string, TournamentResultRow[]> {
  const byTournament = new Map<string, TournamentResultRow[]>();
  const header = readHeader(values, "tournament id");
  if (!header) return byTournament;

  for (const row of values.slice(header.start)) {
    const get = cellReader(header.columns, row);
    const id = text(get("tournament id"));
    const player = text(get("player"));
    if (!id || !player) continue;

    const place = parseInteger(get("finish place"));
    const entries = Math.max(1, parseInteger(get("entries")) || 1 + parseInteger(get("rebuys")));
    const result: TournamentResultRow = {
      player,
      entries,
      rebuys: parseInteger(get("rebuys")),
      topUp: parseBool(get("top-up")),
      freeEntry: parseBool(get("free entry")),
      finishPlace: place > 0 ? place : null,
      knockouts: parseInteger(get("knockouts")),
      eliminatedBy: emptyToNull(get("eliminated by")),
      invested: round2(parseNumber(get("invested ($)"))),
      bountiesWon: round2(parseNumber(get("bounties won ($)"))),
      mainPrize: round2(parseNumber(get("main prize ($)"))),
      totalReturn: round2(parseNumber(get("total return ($)"))),
      netProfit: round2(parseNumber(get("net profit ($)"))),
      inTheMoney: parseBool(get("in the money")),
    };
    const list = byTournament.get(id) ?? [];
    // One row per player per tournament; a repeated name keeps the first row.
    if (!list.some((existing) => existing.player.toLocaleLowerCase() === player.toLocaleLowerCase())) {
      list.push(result);
      byTournament.set(id, list);
    }
  }
  return byTournament;
}

export function parseTournamentLog(logValues: unknown[][], resultValues: unknown[][]): TournamentEvent[] {
  const header = readHeader(logValues, "tournament id");
  if (!header) return [];
  const resultsById = parseTournamentResults(resultValues);

  const events: TournamentEvent[] = [];
  for (const row of logValues.slice(header.start)) {
    const get = cellReader(header.columns, row);
    const id = text(get("tournament id"));
    const date = parseDate(get("date"));
    if (!id || !date) continue;
    const status = text(get("status")) || "Completed";
    if (!/^completed$/i.test(status)) continue;

    const results = (resultsById.get(id) ?? []).slice().sort((a, b) => {
      if (a.finishPlace !== null && b.finishPlace !== null) return a.finishPlace - b.finishPlace;
      if (a.finishPlace !== null) return -1;
      if (b.finishPlace !== null) return 1;
      return b.netProfit - a.netProfit || a.player.localeCompare(b.player);
    });
    if (results.length === 0) continue;

    events.push({
      id,
      date,
      title: text(get("title")) || "Tournament",
      status,
      format: text(get("format")),
      startTime: emptyToNull(get("start time")),
      venue: emptyToNull(get("venue")),
      buyIn: round2(parseNumber(get("buy-in ($)"))),
      topUp: round2(parseNumber(get("top-up ($)"))),
      bounty: round2(parseNumber(get("bounty amount ($)"))),
      bountyBasis: emptyToNull(get("bounty basis")),
      startingStack: parseInteger(get("starting stack")),
      topUpStack: parseInteger(get("top-up stack")),
      shares: {
        first: parseNumber(get("1st place share")),
        second: parseNumber(get("2nd place share")),
        third: parseNumber(get("3rd place share")),
      },
      players: parseInteger(get("players")) || results.length,
      entries: parseInteger(get("entries")) || results.reduce((sum, r) => sum + r.entries, 0),
      rebuys: parseInteger(get("rebuys")),
      topUps: parseInteger(get("top-ups")),
      freeEntries: parseInteger(get("free entries")),
      knockouts: parseInteger(get("total knockouts")),
      totalCollected: round2(parseNumber(get("total collected ($)"))),
      bountyPool: round2(parseNumber(get("bounty pool ($)"))),
      mainPrizePool: round2(parseNumber(get("main prize pool ($)"))),
      winner: emptyToNull(get("winner")),
      runnerUp: emptyToNull(get("runner-up")),
      thirdPlace: emptyToNull(get("3rd place")),
      winnerPrize: round2(parseNumber(get("winner prize ($)"))),
      topBountyHunter: emptyToNull(get("top bounty hunter")),
      mostKnockouts: parseInteger(get("most knockouts")),
      notes: emptyToNull(get("notes")),
      dataCheck: emptyToNull(get("data check")),
      results,
    });
  }
  // Newest first.
  return events.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export type TournamentSnapshotPlayerAggregate = {
  player: string;
  buyIn: number;
  returned: number;
  netProfit: number;
  /** How many tournaments the player entered. */
  tournaments: number;
  /** In how many of those the net result was positive. */
  profitableTournaments: number;
  bestResult: number;
  worstResult: number;
};

export type TournamentSnapshotAggregate = {
  available: boolean;
  eventDate: string | null;
  totalPlayers: number;
  totalInvested: number;
  totalReturned: number;
  totalNetProfit: number;
  players: TournamentSnapshotPlayerAggregate[];
};

/** All tournaments rolled up per player, in the shape the leaderboard code already uses. */
export function aggregateTournaments(events: TournamentEvent[]): TournamentSnapshotAggregate {
  const players = new Map<string, TournamentSnapshotPlayerAggregate>();
  let totalInvested = 0;
  let totalReturned = 0;
  for (const event of events) {
    for (const result of event.results) {
      const key = result.player.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      const entry = players.get(key) ?? {
        player: result.player,
        buyIn: 0,
        returned: 0,
        netProfit: 0,
        tournaments: 0,
        profitableTournaments: 0,
        bestResult: Number.NEGATIVE_INFINITY,
        worstResult: Number.POSITIVE_INFINITY,
      };
      entry.buyIn = round2(entry.buyIn + result.invested);
      entry.returned = round2(entry.returned + result.totalReturn);
      entry.netProfit = round2(entry.netProfit + result.netProfit);
      entry.tournaments += 1;
      if (result.netProfit > 0) entry.profitableTournaments += 1;
      entry.bestResult = Math.max(entry.bestResult, result.netProfit);
      entry.worstResult = Math.min(entry.worstResult, result.netProfit);
      players.set(key, entry);
      totalInvested += result.invested;
      totalReturned += result.totalReturn;
    }
  }
  const list = [...players.values()].sort((a, b) => b.netProfit - a.netProfit || a.player.localeCompare(b.player));
  return {
    available: list.length > 0,
    eventDate: events[0]?.date ?? null,
    totalPlayers: list.length,
    totalInvested: round2(totalInvested),
    totalReturned: round2(totalReturned),
    totalNetProfit: round2(totalReturned - totalInvested),
    players: list,
  };
}
