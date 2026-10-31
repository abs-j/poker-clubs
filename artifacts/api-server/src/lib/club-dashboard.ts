// Builds the dashboard payload for a club that keeps its own results, instead of reading a
// Google Sheet. Pure functions with no database access, so the maths can be unit tested.
// The output matches what the sheet reader produces, so the website needs no special case.
import type { PokerDashboard } from "./dashboard-types";
import { aggregateTournaments, type TournamentEvent } from "./tournament-parse.ts";

export type NightInput = {
  /** "YYYY-MM-DD". */
  date: string;
  players: Array<{ name: string; buyIn: number; cashOut: number }>;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const playerKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Session = PokerDashboard["sessions"][number];

function summarise(nights: Session[]) {
  const nets = new Map<string, { name: string; net: number }>();
  const unique = new Set<string>();
  let positive = 0;
  let negative = 0;
  for (const night of nights) {
    for (const player of night.players) {
      const key = playerKey(player.player);
      unique.add(key);
      const entry = nets.get(key) ?? { name: player.player, net: 0 };
      entry.net = roundMoney(entry.net + player.net);
      nets.set(key, entry);
      if (player.net > 0) positive += 1;
      else negative += 1;
    }
  }
  const top = [...nets.values()].sort((left, right) => right.net - left.net)[0];
  const totalBuyIn = roundMoney(nights.reduce((sum, night) => sum + night.totalBuyIn, 0));
  return {
    sessionCount: nights.length,
    recordCount: nights.reduce((sum, night) => sum + night.playerCount, 0),
    totalBuyIn,
    totalCashOut: roundMoney(nights.reduce((sum, night) => sum + night.totalCashOut, 0)),
    totalNet: roundMoney(nights.reduce((sum, night) => sum + night.totalNet, 0)),
    avgPot: nights.length > 0 ? roundMoney(totalBuyIn / nights.length) : 0,
    uniquePlayers: unique.size,
    topWinner: top?.name ?? null,
    topWinnerProfit: roundMoney(top?.net ?? 0),
    positiveSessions: positive,
    negativeSessions: negative,
  };
}

export function buildClubDashboard(input: { title: string; nights: NightInput[]; tournaments?: TournamentEvent[] }): PokerDashboard {
  const tournaments = (input.tournaments ?? []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // Nights are numbered in date order; nights on the same date keep the order they were given.
  const ordered = input.nights
    .filter((night) => night.players.length > 0)
    .map((night, index) => ({ night, index }))
    .sort((left, right) => left.night.date.localeCompare(right.night.date) || left.index - right.index)
    .map(({ night }) => night);

  const sessions: Session[] = ordered.map((night, index) => {
    const players = night.players.map((player) => ({
      player: player.name,
      buyIn: roundMoney(player.buyIn),
      cashOut: roundMoney(player.cashOut),
      net: roundMoney(player.cashOut - player.buyIn),
      status: null,
    }));
    const winner = [...players].sort((a, b) => b.net - a.net)[0];
    const low = [...players].sort((a, b) => a.net - b.net)[0];
    const totalBuyIn = roundMoney(players.reduce((sum, p) => sum + p.buyIn, 0));
    const totalCashOut = roundMoney(players.reduce((sum, p) => sum + p.cashOut, 0));
    return {
      sessionNumber: index + 1,
      date: night.date,
      // A real calendar month, "2026-10", so the same month of different years is never merged.
      month: night.date.slice(0, 7),
      totalBuyIn,
      totalCashOut,
      totalNet: roundMoney(totalCashOut - totalBuyIn),
      playerCount: players.length,
      winner: winner?.player ?? null,
      winnerProfit: winner?.net ?? 0,
      lowPlayer: low?.player ?? null,
      lowProfit: low?.net ?? 0,
      players,
    };
  });

  // Standings: one row per person, matched on the lower-cased name.
  const people = new Map<string, { name: string; nets: number[]; buyIn: number; cashOut: number }>();
  for (const session of sessions) {
    for (const player of session.players) {
      const key = playerKey(player.player);
      const entry = people.get(key) ?? { name: player.player, nets: [], buyIn: 0, cashOut: 0 };
      entry.nets.push(player.net);
      entry.buyIn += player.buyIn;
      entry.cashOut += player.cashOut;
      people.set(key, entry);
    }
  }
  const leaderboard = [...people.values()]
    .map((entry) => {
      const games = entry.nets.length;
      const buyInTotal = roundMoney(entry.buyIn);
      const profitTotal = roundMoney(entry.cashOut - entry.buyIn);
      return {
        name: entry.name,
        isClubContributor: false,
        buyInTotal,
        cashOutTotal: roundMoney(entry.cashOut),
        profitTotal,
        gamesPlayed: games,
        profitPerSession: roundMoney(profitTotal / games),
        positiveSessionPct: roundMoney((entry.nets.filter((net) => net > 0).length / games) * 100),
        netPct: buyInTotal > 0 ? roundMoney((profitTotal / buyInTotal) * 100) : 0,
        buyInPerGame: roundMoney(buyInTotal / games),
        maxWin: Math.max(...entry.nets),
        maxLoss: Math.min(...entry.nets),
      };
    })
    .sort((left, right) => right.profitTotal - left.profitTotal || left.name.localeCompare(right.name))
    .map((standing, index) => ({ ...standing, rank: index + 1 }));

  const monthKeys = [...new Set(sessions.map((session) => session.month))].sort();
  const months = monthKeys.map((month) => {
    const inMonth = sessions.filter((session) => session.month === month);
    const year = Number(month.slice(0, 4));
    const index = Number(month.slice(5, 7)) - 1;
    const name = MONTH_NAMES[index].slice(0, 3);
    const lastDay = new Date(Date.UTC(year, index + 1, 0)).getUTCDate();
    return { month, label: `${name} ${year}`, range: `${name} 1 — ${name} ${lastDay}`, ...summarise(inMonth) };
  });

  // Running profit per person; everyone who has played by a night gets a point for it.
  const running = new Map<string, { name: string; total: number }>();
  const playerProfitHistory: PokerDashboard["playerProfitHistory"] = [];
  for (const session of sessions) {
    for (const player of session.players) {
      const key = playerKey(player.player);
      const entry = running.get(key) ?? { name: player.player, total: 0 };
      entry.total = roundMoney(entry.total + player.net);
      running.set(key, entry);
    }
    for (const entry of running.values()) {
      playerProfitHistory.push({
        sessionNumber: session.sessionNumber,
        player: entry.name,
        cumulativeProfit: entry.total,
        date: session.date,
        month: session.month,
      });
    }
  }

  const totalBuyIn = roundMoney(sessions.reduce((sum, session) => sum + session.totalBuyIn, 0));
  const totalCashOut = roundMoney(sessions.reduce((sum, session) => sum + session.totalCashOut, 0));
  const latest = sessions[sessions.length - 1];

  return {
    title: input.title,
    spreadsheetUrl: "",
    lastUpdated: new Date().toISOString(),
    isStale: false,
    totals: {
      balanceStatus: Math.abs(totalCashOut - totalBuyIn) < 0.01 ? "balanced" : "unbalanced",
      balanceDifference: roundMoney(totalCashOut - totalBuyIn),
      totalBuyIn,
      totalCashOut,
      totalSessions: sessions.length,
      activePlayers: leaderboard.length,
      latestSession: latest ? latest.sessionNumber : null,
      latestGameDate: latest?.date ?? null,
      totalRecords: sessions.reduce((sum, session) => sum + session.playerCount, 0),
      positiveSessions: leaderboard.filter((standing) => standing.profitTotal > 0).length,
      negativeSessions: leaderboard.filter((standing) => standing.profitTotal <= 0).length,
    },
    leaderboard,
    defaultPlayer: leaderboard[0]?.name ?? null,
    tournamentSnapshot:
      tournaments.length > 0
        ? aggregateTournaments(tournaments)
        : { available: false, eventDate: null, totalPlayers: 0, totalInvested: 0, totalReturned: 0, totalNetProfit: 0, players: [] },
    tournaments,
    months,
    // Seasons are calendar months now; the field stays (empty) so the payload shape is unchanged.
    quarters: [],
    sessions,
    playerProfitHistory,
  };
}
