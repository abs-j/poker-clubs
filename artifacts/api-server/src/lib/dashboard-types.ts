import type { TournamentEvent } from "./tournament-parse.ts";

// The shape of the dashboard payload (validated at the edge by the generated zod schema).

export type PlayerStanding = {
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
