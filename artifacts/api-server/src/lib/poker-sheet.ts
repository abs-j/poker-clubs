import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  aggregateTournaments,
  parseTournamentLog,
  type TournamentEvent,
} from "./tournament-parse.ts";

const SPREADSHEET_ID = "10COQnx6Rd_KzLNsxwZCqd6GDnUXy4GBGYPhRas_msyw";
const SPREADSHEET_URL =
  "https://docs.google.com/spreadsheets/d/10COQnx6Rd_KzLNsxwZCqd6GDnUXy4GBGYPhRas_msyw/edit";
const CANONICAL_SESSION_LOG_TITLE = "Session Log";
const TOURNAMENT_SNAPSHOT_DATE = "2026-10-04";
const SOURCE_SHEETS = {
  playerTotals: {
    displayName: "Player Totals",
    aliases: ["Player Totals"],
    range: "A1:K1000",
  },
  cumulativeProfit: {
    displayName: "Cumulative Profit",
    aliases: ["Cumulative Profit"],
    range: "A1:BK100",
  },
  legends: {
    displayName: "Legends",
    aliases: ["Legends"],
    range: "A1:C100",
  },
  latestGameDate: {
    displayName: "Latest Game Date",
    aliases: ["Latest Game Date Helper", "Latest Game date"],
    range: "A1:B2",
  },
  sessionLog: {
    displayName: "Session Log",
    aliases: ["Session Log"],
    range: "A1:K2000",
  },
  tournamentSnapshot: {
    displayName: "Tournament",
    aliases: ["Tournament 5/10", "Tournament", "Tournament Snapshot"],
    range: "A1:N100",
  },
  tournamentLog: {
    displayName: "Tournament Log",
    aliases: ["Tournament Log"],
    range: "A1:AO300",
  },
  tournamentResults: {
    displayName: "Tournament Results",
    aliases: ["Tournament Results"],
    range: "A1:AB2000",
  },
} as const;

const MONTH_DEFINITIONS = [
  { month: "03", label: "March" },
  { month: "04", label: "April" },
  { month: "05", label: "May" },
  { month: "06", label: "June" },
  { month: "07", label: "July" },
  { month: "08", label: "August" },
  { month: "09", label: "September" },
  { month: "10", label: "October" },
  { month: "11", label: "November" },
  { month: "12", label: "December" },
] as const;

const QUARTER_DEFINITIONS = [
  { quarter: "Q1", label: "Q1", range: "Jan 1 — Mar 31", months: ["01", "02", "03"] },
  { quarter: "Q2", label: "Q2", range: "Apr 1 — Jun 30", months: ["04", "05", "06"] },
  { quarter: "Q3", label: "Q3", range: "Jul 1 — Sep 30", months: ["07", "08", "09"] },
  { quarter: "Q4", label: "Q4", range: "Oct 1 — Dec 31", months: ["10", "11", "12"] },
] as const;

type SourceSheetKey = keyof typeof SOURCE_SHEETS;
type ResolvedSourceSheets = Record<SourceSheetKey, string | null>;
const OPTIONAL_SOURCE_SHEETS = new Set<SourceSheetKey>([
  "tournamentSnapshot",
  "tournamentLog",
  "tournamentResults",
]);
// A problem in these tabs must never take the whole dashboard down.
const SOFT_FAIL_SOURCE_SHEETS = new Set<SourceSheetKey>(["tournamentLog", "tournamentResults"]);

type SpreadsheetMetadata = {
  sheets?: Array<{
    properties?: {
      title?: unknown;
    };
  }>;
};

export class PokerSheetSourceError extends Error {
  readonly sourceTab: string;

  constructor(sourceTab: string) {
    super(
      `Required source tab "${sourceTab}" is missing from the configured spreadsheet.`,
    );
    this.name = "PokerSheetSourceError";
    this.sourceTab = sourceTab;
  }
}

function normalizeSheetTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function makeSheetRange(sheetName: string, range: string): string {
  const escapedSheetName = sheetName.replace(/'/g, "''");
  return `'${escapedSheetName}'!${range}`;
}

type LiveSessionFinalizationEvent = {
  eventId: string;
  memberName: string;
  action: "buy_in" | "cash_out";
  amountCents: number;
};

export type LiveSessionFinalizationResult = {
  sourceTab: string;
  sourceRowStart: number;
  sourceRowEnd: number;
  totalBuyInCents: number;
  totalCashOutCents: number;
  balanceDifferenceCents: number;
  alreadyFinalized: boolean;
};

async function requestSheetJson(
  connectors: ReplitConnectors,
  path: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Record<string, unknown>> {
  const response = await connectors.proxy("google-sheet", path, init);
  if (!response.ok) {
    throw new Error(`Google Sheets returned ${response.status} while finalizing the session.`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function hasSheetCellValue(row: unknown[] | undefined): boolean {
  return Boolean(row?.some((value) => String(value ?? "").trim() !== ""));
}

export function findNextCanonicalWriteRange(
  rows: unknown[][],
  rowCount: number,
): { start: number; end: number } {
  for (let start = 2; start <= rows.length + 1; start += 1) {
    const blockIsEmpty = Array.from({ length: rowCount }, (_, offset) => {
      return !hasSheetCellValue(rows[start - 1 + offset]);
    }).every(Boolean);
    if (blockIsEmpty) {
      return { start, end: start + rowCount - 1 };
    }
  }

  const start = rows.length + 1;
  return { start, end: start + rowCount - 1 };
}

/**
 * Writes one aggregated row per player to the canonical Session Log.
 *
 * The J column is an application-owned idempotency marker. It is outside the
 * existing A:I parser/formulas, so derived monthly tabs continue to consume
 * the same source columns without being written directly.
 */
export async function finalizeLiveSessionToCanonicalLog(input: {
  sessionKey: string;
  sessionDate: string;
  events: LiveSessionFinalizationEvent[];
}): Promise<LiveSessionFinalizationResult> {
  const connectors = new ReplitConnectors();
  const range = encodeURIComponent(`'${CANONICAL_SESSION_LOG_TITLE}'!A1:K2000`);
  const existingPayload = (await requestSheetJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
    { method: "GET" },
  )) as { values?: unknown[][] };
  const existingRows = existingPayload.values ?? [];
  const markerRows = existingRows
    .map((row, index) => ({ row, rowNumber: index + 1 }))
    .filter(({ row }) => String(row[9] ?? "").trim() === input.sessionKey);

  const totalBuyInCents = input.events
    .filter((event) => event.action === "buy_in")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const totalCashOutCents = input.events
    .filter((event) => event.action === "cash_out")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const balanceDifferenceCents = totalCashOutCents - totalBuyInCents;

  if (markerRows.length > 0) {
    return {
      sourceTab: CANONICAL_SESSION_LOG_TITLE,
      sourceRowStart: Math.min(...markerRows.map((item) => item.rowNumber)),
      sourceRowEnd: Math.max(...markerRows.map((item) => item.rowNumber)),
      totalBuyInCents,
      totalCashOutCents,
      balanceDifferenceCents,
      alreadyFinalized: true,
    };
  }

  const byPlayer = new Map<
    string,
    { buyInCents: number; cashOutCents: number; eventIds: string[] }
  >();
  for (const event of input.events) {
    const current = byPlayer.get(event.memberName) ?? {
      buyInCents: 0,
      cashOutCents: 0,
      eventIds: [],
    };
    if (event.action === "buy_in") current.buyInCents += event.amountCents;
    else current.cashOutCents += event.amountCents;
    current.eventIds.push(event.eventId);
    byPlayer.set(event.memberName, current);
  }

  if (byPlayer.size === 0) {
    throw new Error("Add at least one live activity entry before ending the session.");
  }

  const [year, month, day] = input.sessionDate.split("-");
  const displayDate = `${day}/${month}/${year}`;
  const values = [...byPlayer.entries()].map(([player, totals], index) => [
      index === 0 ? displayDate : "",
      player,
      totals.buyInCents / 100,
      totals.cashOutCents / 100,
      (totals.cashOutCents - totals.buyInCents) / 100,
       "",
      "",
      player,
      "",
      input.sessionKey,
      totals.eventIds.join(","),
    ]);

  const updatedRange = findNextCanonicalWriteRange(existingRows, values.length);

  const formulaValues = values.map((row, index) => {
    const rowNumber = updatedRange.start + index;
    return [
      ...row.slice(0, 4),
      `=D${rowNumber}-C${rowNumber}`,
      row[5],
      row[6],
      `=PROPER(TRIM(B${rowNumber}))`,
      `=IF(ROUND(SUM($E$2:E${rowNumber}),2)=0,"Balanced","")`,
      row[9],
      row[10],
    ];
  });
  const updatedRangeName = encodeURIComponent(
    `'${CANONICAL_SESSION_LOG_TITLE}'!A${updatedRange.start}:K${updatedRange.end}`,
  );
  await requestSheetJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${updatedRangeName}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: formulaValues }),
    },
  );
  const verificationPayload = (await requestSheetJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${updatedRangeName}?valueRenderOption=FORMATTED_VALUE`,
    { method: "GET" },
  )) as { values?: unknown[][] };
  const verifiedValues = verificationPayload.values ?? [];
  const writeVerified =
    verifiedValues.length === formulaValues.length &&
    formulaValues.every((expected, index) => {
      const actual = verifiedValues[index] ?? [];
      return (
        String(actual[1] ?? "").trim() === String(expected[1] ?? "").trim() &&
        parseAmount(actual[2]) === parseAmount(expected[2]) &&
        parseAmount(actual[3]) === parseAmount(expected[3]) &&
        parseAmount(actual[4]) === parseAmount(expected[4]) &&
        String(actual[9] ?? "").trim() === String(expected[9] ?? "").trim() &&
        String(actual[10] ?? "").trim() === String(expected[10] ?? "").trim()
      );
    });
  if (!writeVerified) {
    throw new Error("Google Sheets did not verify the canonical session-log rows after writing.");
  }

  return {
    sourceTab: CANONICAL_SESSION_LOG_TITLE,
    sourceRowStart: updatedRange.start,
    sourceRowEnd: updatedRange.end,
    totalBuyInCents,
    totalCashOutCents,
    balanceDifferenceCents,
    alreadyFinalized: false,
  };
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;

  const normalized = value
    .replace(/[−–—]/g, "-")
    .replace(/[$,%\s,]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSessionDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseCsv(text: string): unknown[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && character === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (cell || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }

  return rows;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizePlayerKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const LEGEND_NAME_ALIASES = new Map([
  ["vivian", "vivan"],
  ["scoutt", "scout"],
]);

function normalizeLegendPlayerKey(value: string): string {
  const key = normalizePlayerKey(value);
  return LEGEND_NAME_ALIASES.get(key) ?? key;
}

function displayPlayerName(value: string): string {
  return normalizePlayerKey(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0].toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

type PlayerStanding = {
  rank: number;
  name: string;
  isClubContributor: boolean;
  buyInTotal: number;
  cashOutTotal: number;
  profitTotal: number;
  gamesPlayed: number;
  profitPerSession: number;
  positiveSessionPct: number;
  netPct: number;
  buyInPerGame: number;
  maxWin: number;
  maxLoss: number;
};

type SessionPlayer = {
  player: string;
  buyIn: number;
  cashOut: number;
  net: number;
  status: string | null;
};

type PokerSession = {
  sessionNumber: number;
  date: string;
  month: string;
  totalBuyIn: number;
  totalCashOut: number;
  totalNet: number;
  playerCount: number;
  winner: string | null;
  winnerProfit: number;
  lowPlayer: string | null;
  lowProfit: number;
  players: SessionPlayer[];
};

type MonthlySummary = {
  month: string;
  label: string;
  range: string;
  sessionCount: number;
  recordCount: number;
  totalBuyIn: number;
  totalCashOut: number;
  totalNet: number;
  avgPot: number;
  uniquePlayers: number;
  topWinner: string | null;
  topWinnerProfit: number;
  positiveSessions: number;
  negativeSessions: number;
};

type QuarterlySummary = {
  quarter: string;
  label: string;
  range: string;
  sessionCount: number;
  recordCount: number;
  totalBuyIn: number;
  totalCashOut: number;
  totalNet: number;
  avgPot: number;
  uniquePlayers: number;
  topWinner: string | null;
  topWinnerProfit: number;
  positiveSessions: number;
  negativeSessions: number;
};

export type PokerDashboard = {
  title: string;
  spreadsheetUrl: string;
  lastUpdated: string;
  isStale: boolean;
  totals: {
    balanceStatus: "balanced" | "unbalanced";
    balanceDifference: number;
    totalBuyIn: number;
    totalCashOut: number;
    totalSessions: number;
    activePlayers: number;
    latestSession: number | null;
    latestGameDate: string | null;
    totalRecords: number;
    positiveSessions: number;
    negativeSessions: number;
  };
  leaderboard: PlayerStanding[];
  defaultPlayer: string | null;
  tournamentSnapshot: TournamentSnapshot;
  tournaments: TournamentEvent[];
  months: MonthlySummary[];
  quarters: QuarterlySummary[];
  sessions: PokerSession[];
  playerProfitHistory: Array<{
    sessionNumber: number;
    player: string;
    cumulativeProfit: number;
    date: string | null;
    month: string | null;
  }>;
};

type TournamentSnapshot = {
  available: boolean;
  eventDate: string | null;
  totalPlayers: number;
  totalInvested: number;
  totalReturned: number;
  totalNetProfit: number;
  players: Array<{
    player: string;
    buyIn: number;
    returned: number;
    netProfit: number;
    tournaments?: number;
    profitableTournaments?: number;
    bestResult?: number;
    worstResult?: number;
  }>;
};

export type PublicPokerSummary = {
  title: string;
  latestGameDate: string | null;
  totalSessions: number;
  totalPlayers: number;
  totalGames: number;
  lastUpdated: string;
  isStale: boolean;
  months: Array<{
    month: string;
    label: string;
    range: string;
    sessionCount: number;
    gameCount: number;
  }>;
  monthlyGames: Array<{
    month: string;
    label: string;
    gameCount: number;
  }>;
};

const DASHBOARD_CACHE_TTL_MS = 30_000;
const DASHBOARD_MAX_STALE_MS = 10 * 60 * 1000;
let dashboardCache: { data: PokerDashboard; expiresAt: number } | null = null;
let dashboardInFlight: Promise<PokerDashboard> | null = null;

function buildPublicMonthlyGames(
  sessions: PokerSession[],
): PublicPokerSummary["monthlyGames"] {
  const now = new Date();
  const year = now.getFullYear();
  const monthCount = now.getMonth() + 1;
  const gameCounts = Array.from({ length: monthCount }, () => 0);

  for (const session of sessions) {
    const [sessionYear, sessionMonth] = session.date
      .split("-")
      .map((value) => Number(value));
    if (
      sessionYear !== year ||
      !Number.isInteger(sessionMonth) ||
      sessionMonth < 1 ||
      sessionMonth > monthCount
    ) {
      continue;
    }
    gameCounts[sessionMonth - 1] += session.playerCount;
  }

  return gameCounts
    .map((gameCount, index) => {
      const month = `${year}-${String(index + 1).padStart(2, "0")}`;
      const label = new Intl.DateTimeFormat("en-AU", {
        month: "short",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, index, 1)));
      return { month, label, gameCount };
    })
    .filter((item) => item.gameCount > 0);
}

function parsePlayerTotals(values: unknown[][]): {
  leaderboard: PlayerStanding[];
  totalBuyIn: number;
  totalCashOut: number;
} {
  const parsedPlayers = values.slice(1).map((row) => ({
    name: typeof row[0] === "string" ? row[0].trim() : "",
    isClubContributor: false,
    buyInTotal: parseAmount(row[1]),
    cashOutTotal: parseAmount(row[2]),
    profitTotal: parseAmount(row[3]),
    gamesPlayed: parseAmount(row[4]),
    profitPerSession: parseAmount(row[5]),
    positiveSessionPct: parseAmount(row[6]),
    netPct: parseAmount(row[7]),
    buyInPerGame: parseAmount(row[8]),
    maxWin: parseAmount(row[9]),
    maxLoss: parseAmount(row[10]),
  }));
  const grandTotal = parsedPlayers.find(
    (player) => normalizePlayerKey(player.name) === "grand total",
  );
  const leaderboard = parsedPlayers
    .filter((player) => {
      const key = normalizePlayerKey(player.name);
      return (
        player.name &&
        player.gamesPlayed > 0 &&
        key !== "grand total" &&
        key !== "adj" &&
        // The jackpot is a ledger line, not a person, so it never appears in standings.
        key !== "bad beat jackpot"
      );
    })
    .map((player, index) => ({ ...player, rank: index + 1 }));

  return {
    leaderboard,
    totalBuyIn: roundMoney(
      grandTotal?.buyInTotal ??
        leaderboard.reduce((total, player) => total + player.buyInTotal, 0),
    ),
    totalCashOut: roundMoney(
      grandTotal?.cashOutTotal ??
        leaderboard.reduce((total, player) => total + player.cashOutTotal, 0),
    ),
  };
}

function parseTournamentMoney(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  const normalized = value
    .replace(/[−–—]/g, "-")
    .replace(/[$,%\s,]/g, "");
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTournamentSnapshot(values: unknown[][]): TournamentSnapshot {
  const unavailable: TournamentSnapshot = {
    available: false,
    eventDate: null,
    totalPlayers: 0,
    totalInvested: 0,
    totalReturned: 0,
    totalNetProfit: 0,
    players: [],
  };
  const headerIndex = values.findIndex(
    (row) => normalizePlayerKey(String(row[1] ?? "")) === "player name",
  );
  if (headerIndex < 0) return unavailable;

  const seenPlayers = new Set<string>();
  const players: TournamentSnapshot["players"] = [];
  let totalInvested = 0;
  let totalReturned = 0;
  let totalNetProfit = 0;

  for (const row of values.slice(headerIndex + 1)) {
    const player = typeof row[1] === "string" ? row[1].trim() : "";
    if (!player) break;

    const key = normalizePlayerKey(player);
    if (key === "total") break;
    if (seenPlayers.has(key)) {
      throw new Error(`Tournament snapshot contains duplicate player "${player}".`);
    }
    seenPlayers.add(key);

    // Tournament sheet columns: B player, G invested, K returned, L Net Profit.
    const invested = parseTournamentMoney(row[6]);
    const returned = parseTournamentMoney(row[10]);
    const netProfit = parseTournamentMoney(row[11]);
    if (invested === null || returned === null || netProfit === null) {
      throw new Error(`Tournament snapshot contains invalid financial values for "${player}".`);
    }

    players.push({
      player,
      buyIn: roundMoney(invested),
      returned: roundMoney(returned),
      netProfit: roundMoney(netProfit),
    });
    totalInvested += invested;
    totalReturned += returned;
    totalNetProfit += netProfit;
  }

  if (players.length === 0) return unavailable;

  return {
    available: true,
    eventDate: TOURNAMENT_SNAPSHOT_DATE,
    totalPlayers: players.length,
    totalInvested: roundMoney(totalInvested),
    totalReturned: roundMoney(totalReturned),
    totalNetProfit: roundMoney(totalNetProfit),
    players,
  };
}

function parseLegendNames(values: unknown[][]): Set<string> {
  return new Set(
    values
      .map((row) => (typeof row[1] === "string" ? row[1].trim() : ""))
      .filter(Boolean)
      .map(normalizeLegendPlayerKey),
  );
}

function parseLatestGameDate(values: unknown[][]): string | null {
  const rawDate = values.find(
    (row) => typeof row[1] === "string" && row[1].trim(),
  )?.[1];
  return typeof rawDate === "string"
    ? normalizeSessionDate(rawDate) ?? rawDate.trim()
    : null;
}

function parseSessionLogRows(
  values: unknown[][],
  fixedMonth: string,
): {
  month: string;
  sessions: Array<Omit<PokerSession, "sessionNumber">>;
  recordCount: number;
  totalBuyIn: number;
  totalCashOut: number;
  totalNet: number;
  playerNets: Record<string, number>;
  uniquePlayers: string[];
} {
  const sessions: Array<Omit<PokerSession, "sessionNumber">> = [];
  let recordCount = 0;
  let totalBuyIn = 0;
  let totalCashOut = 0;
  let totalNet = 0;
  const playerNets: Record<string, number> = {};
  const uniquePlayers = new Set<string>();
  let currentDate = "";
  let currentPlayers: SessionPlayer[] = [];

  const flushSession = () => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(currentDate) ||
      currentPlayers.length === 0
    ) {
      currentPlayers = [];
      return;
    }

    const totalBuyIn = roundMoney(
      currentPlayers.reduce((sum, player) => sum + player.buyIn, 0),
    );
    const totalCashOut = roundMoney(
      currentPlayers.reduce((sum, player) => sum + player.cashOut, 0),
    );
    const totalNet = roundMoney(
      currentPlayers.reduce((sum, player) => sum + player.net, 0),
    );
    const winner = [...currentPlayers].sort((a, b) => b.net - a.net)[0];
    const low = [...currentPlayers].sort((a, b) => a.net - b.net)[0];

    sessions.push({
      date: currentDate,
      month: fixedMonth,
      totalBuyIn,
      totalCashOut,
      totalNet,
      playerCount: currentPlayers.length,
      winner: winner?.player ?? null,
      winnerProfit: winner?.net ?? 0,
      lowPlayer: low?.player ?? null,
      lowProfit: low?.net ?? 0,
      players: currentPlayers,
    });
    currentPlayers = [];
  };

  for (const row of values.slice(1)) {
    const rawDate = typeof row[0] === "string" ? row[0].trim() : "";
    const dateMarker = normalizeSessionDate(rawDate) ?? rawDate;
    if (dateMarker && dateMarker !== currentDate) {
      flushSession();
      currentDate = dateMarker;
    }

    const rawPlayer = typeof row[1] === "string" ? row[1].trim() : "";
    const helperName = typeof row[7] === "string" ? row[7].trim() : "";
    const player = displayPlayerName(helperName || rawPlayer);
    if (!player) continue;

    const hasValues = [row[2], row[3], row[4]].some(
      (value) => value !== undefined && value !== null && String(value).trim() !== "",
    );
    if (!hasValues) continue;

    const buyIn = roundMoney(parseAmount(row[2]));
    const cashOut = roundMoney(parseAmount(row[3]));
    const net = roundMoney(parseAmount(row[4]));
    currentPlayers.push({
      player,
      buyIn,
      cashOut,
      net,
      status:
        typeof row[5] === "string" && row[5].trim()
          ? row[5].trim()
          : null,
    });
    totalBuyIn += buyIn;
    totalCashOut += cashOut;
    totalNet += net;
    playerNets[player] = roundMoney((playerNets[player] ?? 0) + net);
    uniquePlayers.add(normalizePlayerKey(player));
    recordCount += 1;
  }

  flushSession();
  return {
    month: fixedMonth,
    sessions,
    recordCount,
    totalBuyIn: roundMoney(totalBuyIn),
    totalCashOut: roundMoney(totalCashOut),
    totalNet: roundMoney(totalNet),
    playerNets,
    uniquePlayers: [...uniquePlayers],
  };
}

export function isPlayedSession(session: { players: Array<{ player: string }> }): boolean {
  return session.players.some((player) => normalizePlayerKey(player.player) !== "bad beat jackpot");
}

function parseCanonicalSessionLogRows(values: unknown[][]) {
  const rowsByMonth = new Map<string, unknown[][]>();
  let currentMonth = "";

  for (const row of values.slice(1)) {
    const rawDate = typeof row[0] === "string" ? row[0].trim() : "";
    const normalizedDate = normalizeSessionDate(rawDate);
    if (normalizedDate) currentMonth = normalizedDate.slice(5, 7);
    if (!currentMonth) continue;
    const rows = rowsByMonth.get(currentMonth) ?? [];
    rows.push(row);
    rowsByMonth.set(currentMonth, rows);
  }

  return MONTH_DEFINITIONS.map(({ month }) =>
    parseSessionLogRows(
      [values[0] ?? [], ...(rowsByMonth.get(month) ?? [])],
      month,
    ),
  );
}

function buildMonthlySummaries(
  sessions: PokerSession[],
  aggregates: Array<{
    month: string;
    recordCount: number;
    totalBuyIn: number;
    totalCashOut: number;
    totalNet: number;
    playerNets: Record<string, number>;
    uniquePlayers: string[];
  }>,
): MonthlySummary[] {
  const currentYear = new Date().getFullYear();

  return MONTH_DEFINITIONS.map(({ month, label }) => {
    const monthSessions = sessions.filter((session) => session.month === month);
    const aggregate = aggregates.find((item) => item.month === month);
    const playerNet = new Map<string, number>();
    for (const session of monthSessions) {
      for (const player of session.players) {
        playerNet.set(
          player.player,
          roundMoney((playerNet.get(player.player) ?? 0) + player.net),
        );
      }
    }
    const topWinner = [...playerNet.entries()].sort((a, b) => b[1] - a[1])[0];
    const aggregateTopWinner = aggregate
      ? Object.entries(aggregate.playerNets).sort(
          ([, left], [, right]) => right - left,
        )[0]
      : undefined;

    return {
      month,
      label,
      range: `${label} 1 — ${label} ${new Date(
        Date.UTC(currentYear, Number(month), 0),
      ).getUTCDate()}`,
      sessionCount: monthSessions.length,
      recordCount:
        aggregate?.recordCount ??
        monthSessions.reduce((sum, session) => sum + session.playerCount, 0),
      totalBuyIn:
        aggregate?.totalBuyIn ??
        roundMoney(
          monthSessions.reduce((sum, session) => sum + session.totalBuyIn, 0),
        ),
      totalCashOut:
        aggregate?.totalCashOut ??
        roundMoney(
          monthSessions.reduce(
            (sum, session) => sum + session.totalCashOut,
            0,
          ),
        ),
      totalNet:
        aggregate?.totalNet ??
        roundMoney(
          monthSessions.reduce((sum, session) => sum + session.totalNet, 0),
        ),
      avgPot:
        monthSessions.length > 0
          ? roundMoney(
              (aggregate?.totalBuyIn ??
                monthSessions.reduce(
                  (sum, session) => sum + session.totalBuyIn,
                  0,
                )) / monthSessions.length,
            )
          : 0,
      uniquePlayers:
        aggregate?.uniquePlayers.length ??
        new Set(
          monthSessions.flatMap((session) =>
            session.players.map((player) => normalizePlayerKey(player.player)),
          ),
        ).size,
      topWinner: aggregateTopWinner?.[0] ?? topWinner?.[0] ?? null,
      topWinnerProfit: roundMoney(
        aggregateTopWinner?.[1] ?? topWinner?.[1] ?? 0,
      ),
      positiveSessions: monthSessions
        .flatMap((session) => session.players)
        .filter((player) => player.net > 0).length,
      negativeSessions: monthSessions
        .flatMap((session) => session.players)
        .filter((player) => player.net <= 0).length,
    };
  }).filter((summary) => summary.sessionCount > 0);
}

function buildQuarterlySummaries(sessions: PokerSession[]): QuarterlySummary[] {
  return QUARTER_DEFINITIONS.map(({ quarter, label, range, months }) => {
    const quarterSessions = sessions.filter((session) =>
      months.some((month) => month === session.month),
    );
    const playerNet = new Map<string, number>();
    const uniquePlayers = new Set<string>();

    for (const session of quarterSessions) {
      for (const player of session.players) {
        playerNet.set(
          player.player,
          roundMoney((playerNet.get(player.player) ?? 0) + player.net),
        );
        uniquePlayers.add(normalizePlayerKey(player.player));
      }
    }

    const topWinner = [...playerNet.entries()].sort((left, right) => right[1] - left[1])[0];
    const totalBuyIn = roundMoney(
      quarterSessions.reduce((sum, session) => sum + session.totalBuyIn, 0),
    );

    return {
      quarter,
      label,
      range,
      sessionCount: quarterSessions.length,
      recordCount: quarterSessions.reduce(
        (sum, session) => sum + session.playerCount,
        0,
      ),
      totalBuyIn,
      totalCashOut: roundMoney(
        quarterSessions.reduce((sum, session) => sum + session.totalCashOut, 0),
      ),
      totalNet: roundMoney(
        quarterSessions.reduce((sum, session) => sum + session.totalNet, 0),
      ),
      avgPot: quarterSessions.length ? roundMoney(totalBuyIn / quarterSessions.length) : 0,
      uniquePlayers: uniquePlayers.size,
      topWinner: topWinner?.[0] ?? null,
      topWinnerProfit: roundMoney(topWinner?.[1] ?? 0),
      positiveSessions: quarterSessions
        .flatMap((session) => session.players)
        .filter((player) => player.net > 0).length,
      negativeSessions: quarterSessions
        .flatMap((session) => session.players)
        .filter((player) => player.net <= 0).length,
    };
  }).filter((summary) => summary.sessionCount > 0);
}

function parsePlayerProfitHistory(
  values: unknown[][],
  leaderboard: PlayerStanding[],
  sessions: PokerSession[],
) {
  const headers = values[0] ?? [];
  const displayNames = new Map(
    leaderboard.map((player) => [normalizePlayerKey(player.name), player.name]),
  );
  const sessionsByNumber = new Map(
    sessions.map((session) => [session.sessionNumber, session]),
  );

  return values
    .slice(1)
    .flatMap((row) => {
      const sessionNumber = Number(row[0]);
      if (!Number.isInteger(sessionNumber) || sessionNumber < 1) return [];

      return headers
        .slice(1)
        .map((header, columnIndex) => {
          const rawPlayer = typeof header === "string" ? header.trim() : "";
          const value = row[columnIndex + 1];
          if (
            !rawPlayer ||
            normalizePlayerKey(rawPlayer) === "adj" ||
            value === undefined ||
            value === ""
          ) {
            return null;
          }

          const session = sessionsByNumber.get(sessionNumber);
          return {
            sessionNumber,
            player:
              displayNames.get(normalizePlayerKey(rawPlayer)) ??
              displayPlayerName(rawPlayer),
            cumulativeProfit: roundMoney(parseAmount(value)),
            date: session?.date ?? null,
            month: session?.month ?? null,
          };
        })
        .filter(
          (
            point,
          ): point is {
            sessionNumber: number;
            player: string;
            cumulativeProfit: number;
            date: string | null;
            month: string | null;
          } => point !== null,
        );
    })
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
}

async function loadPokerDashboard(): Promise<PokerDashboard> {
  const connectors = new ReplitConnectors();
  const resolveSourceSheets =
    async (): Promise<ResolvedSourceSheets | null> => {
      // Local development: read the sheet's public export instead of the Replit connector.
      if (process.env.POKER_SHEET_PUBLIC_ONLY === "true") return null;

      const response = await connectors.proxy(
        "google-sheet",
        `/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(title))`,
        { method: "GET" },
      );

      if (
        !response.ok &&
        (response.status === 401 ||
          response.status === 403 ||
          response.status === 429)
      ) {
        console.warn(
          `Google Sheets connector returned ${response.status} while resolving source tabs; using the public read-only sheet export.`,
        );
        return null;
      }

      if (!response.ok) {
        throw new Error(
          `Google Sheets metadata request returned ${response.status} for spreadsheet ${SPREADSHEET_ID}`,
        );
      }

      const payload = (await response.json()) as SpreadsheetMetadata;
      const availableTitles = (payload.sheets ?? [])
        .map((sheet) => sheet.properties?.title)
        .filter((title): title is string => typeof title === "string");
      const resolved = {} as ResolvedSourceSheets;

      for (const [key, source] of Object.entries(SOURCE_SHEETS) as Array<
        [SourceSheetKey, (typeof SOURCE_SHEETS)[SourceSheetKey]]
      >) {
        const matchingTitle = availableTitles.find((title) =>
          source.aliases.some(
            (alias) =>
              normalizeSheetTitle(alias) === normalizeSheetTitle(title),
          ),
        );

        if (!matchingTitle && !OPTIONAL_SOURCE_SHEETS.has(key)) {
          throw new PokerSheetSourceError(source.displayName);
        }

        resolved[key] = matchingTitle ?? null;
      }

      return resolved;
    };

  const fetchPublicValues = async (
    sourceKey: SourceSheetKey,
  ): Promise<unknown[][]> => {
    const source = SOURCE_SHEETS[sourceKey];
    let lastMissingStatus: number | null = null;

    for (const sheetName of source.aliases) {
      const sheetRange = makeSheetRange(sheetName, source.range);
      const url = new URL(
        `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`,
      );
      url.searchParams.set("tqx", "out:csv");
      url.searchParams.set("sheet", sheetName);

      const response = await fetch(url);
      if (response.ok) {
        return parseCsv(await response.text());
      }

      if (response.status === 400 || response.status === 404) {
        lastMissingStatus = response.status;
        continue;
      }

      throw new Error(
        `Google Sheets public export returned ${response.status} for ${sheetRange}`,
      );
    }

    if (lastMissingStatus !== null && OPTIONAL_SOURCE_SHEETS.has(sourceKey)) {
      return [];
    }

    if (lastMissingStatus !== null) {
      throw new PokerSheetSourceError(source.displayName);
    }

    throw new Error(
      `Google Sheets public export could not load ${source.displayName}`,
    );
  };

  const resolvedSourceSheets = await resolveSourceSheets();

  const fetchValues = async (
    sourceKey: SourceSheetKey,
  ): Promise<unknown[][]> => {
    if (!resolvedSourceSheets) {
      return fetchPublicValues(sourceKey);
    }

    const source = SOURCE_SHEETS[sourceKey];
    const sourceTitle = resolvedSourceSheets[sourceKey];
    if (!sourceTitle) {
      if (OPTIONAL_SOURCE_SHEETS.has(sourceKey)) {
        return fetchPublicValues(sourceKey);
      }
      throw new PokerSheetSourceError(source.displayName);
    }
    const sheetRange = makeSheetRange(sourceTitle, source.range);
    const range = encodeURIComponent(sheetRange);
    const response = await connectors.proxy(
      "google-sheet",
      `/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
      { method: "GET" },
    );

    if (
      !response.ok &&
      (response.status === 401 ||
        response.status === 403 ||
        response.status === 429)
    ) {
      console.warn(
        `Google Sheets connector returned ${response.status} for ${sheetRange}; using the public read-only sheet export.`,
      );
      return fetchPublicValues(sourceKey);
    }

    if (!response.ok) {
      throw new Error(
        `Google Sheets returned ${response.status} for ${sheetRange}`,
      );
    }

    const payload = (await response.json()) as { values?: unknown[][] };
    return payload.values ?? [];
  };

  const sourceKeys: SourceSheetKey[] = [
    "playerTotals",
    "cumulativeProfit",
    "legends",
    "latestGameDate",
    "sessionLog",
    "tournamentSnapshot",
    "tournamentLog",
    "tournamentResults",
  ];
  const fetchedValues: unknown[][][] = [];
  for (let index = 0; index < sourceKeys.length; index += 4) {
    const batch = sourceKeys.slice(index, index + 4);
    fetchedValues.push(
      ...(await Promise.all(
        batch.map((key) =>
          SOFT_FAIL_SOURCE_SHEETS.has(key)
            ? fetchValues(key).catch((error: unknown) => {
                console.warn(`Could not read the ${SOURCE_SHEETS[key].displayName} tab.`, error);
                return [] as unknown[][];
              })
            : fetchValues(key),
        ),
      )),
    );
  }
  const [
    playerTotalsValues,
    cumulativeProfitValues,
    legendsValues,
    latestGameDateValues,
    sessionLogValues,
    tournamentSnapshotValues,
    tournamentLogValues,
    tournamentResultsValues,
  ] = fetchedValues;
  const parsedTotals = parsePlayerTotals(playerTotalsValues);
  const legendNames = parseLegendNames(legendsValues);
  const leaderboard = parsedTotals.leaderboard.map((player) => ({
    ...player,
    isClubContributor: legendNames.has(normalizeLegendPlayerKey(player.name)),
  }));
  const parsedMonthLogs = parseCanonicalSessionLogRows(sessionLogValues);
  // A log entry that only holds the Bad Beat Jackpot line (e.g. its payout to a tournament
  // entry) is money moving, not a game that anyone played, so it is not counted as a session.
  const rawSessions = parsedMonthLogs
    .flatMap((log) => log.sessions)
    .filter((session) => isPlayedSession(session));
  const totalRecordCount = parsedMonthLogs.reduce(
    (sum, log) => sum + log.recordCount,
    0,
  );
  const sessions: PokerSession[] = rawSessions.map((session, index) => ({
    ...session,
    sessionNumber: index + 1,
  }));
  const months = buildMonthlySummaries(sessions, parsedMonthLogs);
  const quarters = buildQuarterlySummaries(sessions);
  const playerProfitHistory = parsePlayerProfitHistory(
    cumulativeProfitValues,
    leaderboard,
    sessions,
  );
  // The Tournament Log / Results tabs are the source of truth when they have data; the old
  // single-event snapshot tab is only a fallback so nothing breaks if they are empty.
  let tournaments: TournamentEvent[] = [];
  try {
    tournaments = parseTournamentLog(tournamentLogValues ?? [], tournamentResultsValues ?? []);
  } catch (error) {
    console.warn("Could not parse the tournament tabs; falling back to the snapshot tab.", error);
  }
  const tournamentSnapshot: TournamentSnapshot =
    tournaments.length > 0
      ? aggregateTournaments(tournaments)
      : parseTournamentSnapshot(tournamentSnapshotValues);
  const totalBuyIn = parsedTotals.totalBuyIn;
  const totalCashOut = parsedTotals.totalCashOut;
  const latestGameDate =
    sessions[sessions.length - 1]?.date ?? parseLatestGameDate(latestGameDateValues);
  const latestSession = sessions.length > 0 ? sessions.length : null;

  return {
    title: "Monash Poker Society",
    spreadsheetUrl: SPREADSHEET_URL,
    lastUpdated: new Date().toISOString(),
    isStale: false,
    totals: {
      balanceStatus:
        Math.abs(totalCashOut - totalBuyIn) < 0.01 ? "balanced" : "unbalanced",
      balanceDifference: roundMoney(totalCashOut - totalBuyIn),
      totalBuyIn: roundMoney(totalBuyIn),
      totalCashOut: roundMoney(totalCashOut),
      totalSessions: latestSession ?? 0,
      activePlayers: leaderboard.length,
      latestSession,
      latestGameDate,
      totalRecords: totalRecordCount,
      positiveSessions: leaderboard.filter((player) => player.profitTotal > 0)
        .length,
      negativeSessions: leaderboard.filter((player) => player.profitTotal <= 0)
        .length,
    },
    leaderboard,
    defaultPlayer: leaderboard[0]?.name ?? null,
    tournamentSnapshot,
    tournaments,
    months,
    quarters,
    sessions,
    playerProfitHistory,
  };
}

function refreshDashboard(forceRefresh: boolean): Promise<PokerDashboard> {
  const loadPromise = loadPokerDashboard()
    .then((data) => {
      dashboardCache = {
        data,
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
      };
      return data;
    })
    .catch((error) => {
      if (!forceRefresh && dashboardCache) {
        console.warn(
          "Using the last successful poker dashboard snapshot after a refresh failure.",
          error,
        );
        return { ...dashboardCache.data, isStale: true };
      }
      throw error;
    });

  dashboardInFlight = loadPromise;
  const clear = () => {
    if (dashboardInFlight === loadPromise) {
      dashboardInFlight = null;
    }
  };
  loadPromise.then(clear, clear);
  return loadPromise;
}

// Stale-while-revalidate: once the cache is older than its TTL, callers still get
// the last snapshot immediately while a single background refresh runs. Only a cold
// start, a forced refresh, or a snapshot older than the max stale age waits on Sheets.
export async function fetchPokerDashboard(
  options: { forceRefresh?: boolean } = {},
): Promise<PokerDashboard> {
  const now = Date.now();
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh && dashboardCache) {
    if (dashboardCache.expiresAt > now) return dashboardCache.data;

    if (now - dashboardCache.expiresAt < DASHBOARD_MAX_STALE_MS) {
      if (!dashboardInFlight) {
        void refreshDashboard(false).catch((error) => {
          console.warn("Background poker dashboard refresh failed.", error);
        });
      }
      return dashboardCache.data;
    }
  }

  if (dashboardInFlight) return dashboardInFlight;
  return refreshDashboard(forceRefresh);
}

/**
 * What a club with no recorded history sees: every section is present and empty, so the
 * dashboard renders its "nothing here yet" states instead of another club's numbers.
 */
export function emptyPokerDashboard(title: string): PokerDashboard {
  return {
    title,
    spreadsheetUrl: "",
    lastUpdated: new Date().toISOString(),
    isStale: false,
    totals: {
      balanceStatus: "balanced",
      balanceDifference: 0,
      totalBuyIn: 0,
      totalCashOut: 0,
      totalSessions: 0,
      activePlayers: 0,
      latestSession: null,
      latestGameDate: null,
      totalRecords: 0,
      positiveSessions: 0,
      negativeSessions: 0,
    },
    leaderboard: [],
    defaultPlayer: null,
    tournamentSnapshot: parseTournamentSnapshot([]),
    tournaments: [],
    months: buildMonthlySummaries([], []),
    quarters: buildQuarterlySummaries([]),
    sessions: [],
    playerProfitHistory: [],
  };
}

export async function fetchPublicPokerSummary(
  options: { forceRefresh?: boolean } = {},
): Promise<PublicPokerSummary> {
  const dashboard = await fetchPokerDashboard(options);

  return {
    title: dashboard.title,
    latestGameDate: dashboard.totals.latestGameDate,
    totalSessions: dashboard.totals.totalSessions,
    totalPlayers: dashboard.totals.activePlayers,
    totalGames: dashboard.totals.totalRecords,
    lastUpdated: dashboard.lastUpdated,
    isStale: dashboard.isStale,
    months: dashboard.months.map((month) => ({
      month: month.month,
      label: month.label,
      range: month.range,
      sessionCount: month.sessionCount,
      gameCount: month.recordCount,
    })),
    monthlyGames: buildPublicMonthlyGames(dashboard.sessions),
  };
}
