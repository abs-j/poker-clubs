// Badges, form dots, the season award and the "club buzz" lines, all worked out from the
// game results the site already has. No React in here so it can be unit tested.

import type { Career } from "./career.ts";
import {
  buildPlayerTotals,
  isRealPlayer,
  normalizeName,
  sortSessions,
  type ChartSession,
} from "./club-charts.ts";
import type { PointsRow } from "./points.ts";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** One player's net for every game they sat in, oldest first. Names are matched loosely. */
function perPlayerResults(sessions: ChartSession[]) {
  const ordered = sortSessions(sessions);
  const results = new Map<string, Array<{ session: ChartSession; net: number }>>();
  const display = new Map<string, string>();
  for (const session of ordered) {
    const nets = new Map<string, number>();
    for (const record of session.players) {
      if (!isRealPlayer(record.player)) continue;
      const key = normalizeName(record.player);
      display.set(key, display.get(key) ?? record.player.trim());
      nets.set(key, round2((nets.get(key) ?? 0) + record.net));
    }
    for (const [key, net] of nets) {
      const list = results.get(key) ?? [];
      list.push({ session, net });
      results.set(key, list);
    }
  }
  return { ordered, results, display };
}

// ---------------------------------------------------------------- form dots

export type FormDot = { result: "win" | "loss" | "even"; net: number; date: string; sessionNumber: number };

/** The player's last few games, oldest first, for the little coloured dots. */
export function buildFormDots(sessions: ChartSession[], playerName: string, count = 5): FormDot[] {
  const { results } = perPlayerResults(sessions);
  const list = results.get(normalizeName(playerName)) ?? [];
  return list.slice(-count).map(({ session, net }) => ({
    result: net > 0 ? "win" : net < 0 ? "loss" : "even",
    net,
    date: session.date,
    sessionNumber: session.sessionNumber,
  }));
}

// ------------------------------------------------------------------- badges

export type BadgeId =
  | "heater"
  | "giant-killer"
  | "comeback"
  | "iron-player"
  | "big-night"
  | "first-win"
  | "veteran"
  | "perfect-month"
  | "tournament-win";

export type Badge = {
  id: BadgeId;
  label: string;
  /** One plain sentence saying why the player has it. */
  reason: string;
};

export const BADGE_META: Record<BadgeId, { label: string; blurb: string }> = {
  heater: { label: "On a heater", blurb: "Won three or more games in a row and still going." },
  "giant-killer": { label: "Giant killer", blurb: "Won one of the last three games while the all-time leader lost money." },
  comeback: { label: "Comeback", blurb: "The biggest turnaround from a losing game to a winning one." },
  "iron-player": { label: "Iron player", blurb: "Has sat in the most games." },
  "big-night": { label: "Big night", blurb: "Holds the biggest single-game win on record." },
  "first-win": { label: "First win", blurb: "Finish a game in profit." },
  veteran: { label: "Veteran", blurb: "Play ten games." },
  "perfect-month": { label: "Perfect month", blurb: "Win every game you play in a calendar month (at least two)." },
  "tournament-win": { label: "Tournament winner", blurb: "Finish a tournament with the biggest result." },
};

/** Shown in this order on the trophy shelf. */
export const BADGE_ORDER: BadgeId[] = [
  "first-win",
  "veteran",
  "perfect-month",
  "tournament-win",
  "heater",
  "comeback",
  "giant-killer",
  "iron-player",
  "big-night",
];

export const VETERAN_GAMES = 10;
const MIN_PERFECT_MONTH_GAMES = 2;

const MIN_HEATER = 3;
const MIN_IRON_GAMES = 3;
/** Giant killer only counts the latest few club games so it stays a recent, rare badge. */
const GIANT_KILLER_WINDOW = 3;

/** Badges keyed by normalised player name. Players with none are left out. */
export function buildBadges(sessions: ChartSession[], careers?: Map<string, Career>): Map<string, Badge[]> {
  const { ordered, results } = perPlayerResults(sessions);
  const badges = new Map<string, Badge[]>();
  const give = (key: string, badge: Badge) => {
    const list = badges.get(key) ?? [];
    list.push(badge);
    badges.set(key, list);
  };

  // On a heater: the current run of winning games.
  for (const [key, list] of results) {
    let run = 0;
    for (let i = list.length - 1; i >= 0 && list[i].net > 0; i--) run += 1;
    if (run >= MIN_HEATER) {
      give(key, { id: "heater", label: BADGE_META.heater.label, reason: `${run} wins in a row` });
    }
  }

  // Giant killer: won a game while the leader going in was at the table and finished behind.
  const killers = new Map<string, number>();
  const before: ChartSession[] = [];
  const recentFrom = Math.max(0, ordered.length - GIANT_KILLER_WINDOW);
  for (const [position, session] of ordered.entries()) {
    const totals = buildPlayerTotals(before);
    const leader = totals[0];
    if (leader && before.length >= 2 && position >= recentFrom) {
      const leaderKey = normalizeName(leader.name);
      const real = session.players.filter((record) => isRealPlayer(record.player));
      const leaderRecord = real.find((record) => normalizeName(record.player) === leaderKey);
      if (leaderRecord) {
        const best = real.reduce((top, record) => (record.net > top.net ? record : top), real[0]);
        const bestKey = normalizeName(best.player);
        if (best.net > 0 && bestKey !== leaderKey && leaderRecord.net < 0) {
          killers.set(bestKey, (killers.get(bestKey) ?? 0) + 1);
        }
      }
    }
    before.push(session);
  }
  for (const [key, count] of killers) {
    give(key, {
      id: "giant-killer",
      label: BADGE_META["giant-killer"].label,
      reason: count === 1 ? "Won a recent game while the leader lost" : `Won ${count} recent games while the leader lost`,
    });
  }

  // Comeback: the largest jump from a losing game straight to a winning one (one player holds it).
  let comeback: { key: string; swing: number } | null = null;
  for (const [key, list] of results) {
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1].net < 0 && list[i].net > 0) {
        const swing = round2(list[i].net - list[i - 1].net);
        if (!comeback || swing > comeback.swing) comeback = { key, swing };
      }
    }
  }
  if (comeback) {
    give(comeback.key, {
      id: "comeback",
      label: BADGE_META.comeback.label,
      reason: `A ${money(comeback.swing)} swing in one game`,
    });
  }

  // Iron player: most games (ties share it).
  const mostGames = Math.max(0, ...[...results.values()].map((list) => list.length));
  if (mostGames >= MIN_IRON_GAMES) {
    for (const [key, list] of results) {
      if (list.length === mostGames) {
        give(key, { id: "iron-player", label: BADGE_META["iron-player"].label, reason: `${mostGames} games played` });
      }
    }
  }

  // Big night: the single biggest win on record.
  let big: { key: string; net: number } | null = null;
  for (const [key, list] of results) {
    for (const { net } of list) if (net > 0 && (!big || net > big.net)) big = { key, net };
  }
  if (big) {
    give(big.key, { id: "big-night", label: BADGE_META["big-night"].label, reason: `${money(big.net)} in one game` });
  }

  // Badges that, once earned, are kept: first win, ten games, a perfect month, a tournament win.
  for (const [key, list] of results) {
    const firstWin = list.find((entry) => entry.net > 0);
    if (firstWin) {
      give(key, { id: "first-win", label: BADGE_META["first-win"].label, reason: `In profit on ${prettyDate(firstWin.session.date)}` });
    }

    if (list.length >= VETERAN_GAMES) {
      give(key, { id: "veteran", label: BADGE_META.veteran.label, reason: `${list.length} games played` });
    }

    const byMonth = new Map<string, number[]>();
    for (const entry of list) {
      const month = entry.session.date.slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), entry.net]);
    }
    const perfect = [...byMonth.entries()]
      .filter(([, nets]) => nets.length >= MIN_PERFECT_MONTH_GAMES && nets.every((net) => net > 0))
      .sort((a, b) => b[1].length - a[1].length || b[0].localeCompare(a[0]))[0];
    if (perfect) {
      give(key, {
        id: "perfect-month",
        label: BADGE_META["perfect-month"].label,
        reason: `Won all ${perfect[1].length} games in ${monthName(perfect[0])}`,
      });
    }
  }

  for (const session of ordered) {
    if (session.eventType !== "tournament") continue;
    const real = session.players.filter((record) => isRealPlayer(record.player));
    if (!real.length) continue;
    // The recorded winner is who finished first, which is not always who made the most
    // profit once bounties are counted. Fall back to the biggest result when it is missing.
    const recorded = session.winner ? real.find((record) => normalizeName(record.player) === normalizeName(session.winner!)) : undefined;
    const winners = recorded
      ? [recorded]
      : (() => {
          const top = Math.max(...real.map((record) => record.net));
          return top > 0 ? real.filter((record) => record.net === top) : [];
        })();
    for (const record of winners) {
      give(normalizeName(record.player), {
        id: "tournament-win",
        label: BADGE_META["tournament-win"].label,
        reason: `Won the tournament on ${prettyDate(session.date)}`,
      });
    }
  }

  if (careers && careers.size) applyCareerBadges(badges, careers);
  return badges;
}

const CAREER_BADGES: BadgeId[] = ["first-win", "veteran", "heater", "comeback", "iron-player", "big-night"];

/**
 * The session log only has dated nights since the season started, so badges that depend on a
 * member's whole record are worked out from their career totals and game-by-game history.
 */
function applyCareerBadges(badges: Map<string, Badge[]>, careers: Map<string, Career>) {
  for (const [key, list] of badges) {
    const kept = list.filter((badge) => !CAREER_BADGES.includes(badge.id));
    if (kept.length) badges.set(key, kept);
    else badges.delete(key);
  }
  const give = (key: string, badge: Badge) => badges.set(key, [...(badges.get(key) ?? []), badge]);

  let comeback: { key: string; swing: number } | null = null;
  let mostGames = 0;
  let bestWin: { key: string; net: number } | null = null;
  for (const [key, career] of careers) {
    if (career.bestGame > 0) {
      give(key, { id: "first-win", label: BADGE_META["first-win"].label, reason: "Has finished a game in profit" });
      if (!bestWin || career.bestGame > bestWin.net) bestWin = { key, net: career.bestGame };
    }
    if (career.games >= VETERAN_GAMES) {
      give(key, { id: "veteran", label: BADGE_META.veteran.label, reason: `${career.games} games played` });
    }
    if (career.currentStreak >= MIN_HEATER) {
      give(key, { id: "heater", label: BADGE_META.heater.label, reason: `${career.currentStreak} wins in a row` });
    }
    for (let i = 1; i < career.results.length; i++) {
      if (career.results[i - 1] < 0 && career.results[i] > 0) {
        const swing = round2(career.results[i] - career.results[i - 1]);
        if (!comeback || swing > comeback.swing) comeback = { key, swing };
      }
    }
    mostGames = Math.max(mostGames, career.games);
  }
  if (comeback) {
    give(comeback.key, { id: "comeback", label: BADGE_META.comeback.label, reason: `A ${money(comeback.swing)} swing in one game` });
  }
  if (mostGames >= MIN_IRON_GAMES) {
    for (const [key, career] of careers) {
      if (career.games === mostGames) {
        give(key, { id: "iron-player", label: BADGE_META["iron-player"].label, reason: `${mostGames} games played` });
      }
    }
  }
  if (bestWin) {
    give(bestWin.key, { id: "big-night", label: BADGE_META["big-night"].label, reason: `${money(bestWin.net)} in one game` });
  }
}

/** "2026-10-02" -> "2 Oct 2026"; anything unparseable is returned as is. */
function prettyDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1].slice(0, 3)} ${match[1]}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function monthName(yearMonth: string) {
  const [year, month] = yearMonth.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

function money(value: number) {
  return `$${Math.abs(value).toFixed(value % 1 === 0 ? 0 : 2)}`;
}

export function badgesFor(map: Map<string, Badge[]>, playerName: string): Badge[] {
  return map.get(normalizeName(playerName)) ?? [];
}

// ------------------------------------------------------------ season award

export type SeasonStanding = { name: string; net: number; games: number; wins: number };

export type Season = {
  /** e.g. "Oct 2026" */
  label: string;
  /** Calendar month, e.g. "2026-10" */
  key: string;
  from: string;
  to: string;
  games: number;
  standings: SeasonStanding[];
  /** The leader. Null when nobody has played in the month. */
  leader: SeasonStanding | null;
  mostWins: SeasonStanding | null;
  mostGames: SeasonStanding | null;
  /** Gap to second place, for "leads by $x" lines. */
  lead: number | null;
  /** True once the month has ended (the latest game is in a later month). */
  closed: boolean;
};

export function monthKey(date: string) {
  return date.slice(0, 7);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabelOf = (key: string) => `${SHORT_MONTHS[Number(key.slice(5, 7)) - 1] ?? key.slice(5)} ${key.slice(0, 4)}`;

/**
 * The season is the calendar month of the latest game, so "Player of the Season" always
 * has someone to show. `month` picks a different one.
 */
export function buildSeason(sessions: ChartSession[], month?: string): Season | null {
  const ordered = sortSessions(sessions);
  if (!ordered.length) return null;
  const key = month ?? monthKey(ordered[ordered.length - 1].date);
  const inMonth = ordered.filter((session) => monthKey(session.date) === key);
  if (!inMonth.length) return null;

  const wins = new Map<string, number>();
  for (const session of inMonth) {
    const real = session.players.filter((record) => isRealPlayer(record.player));
    if (!real.length) continue;
    const top = Math.max(...real.map((record) => record.net));
    if (top <= 0) continue;
    for (const record of real) {
      if (record.net === top) {
        const k = normalizeName(record.player);
        wins.set(k, (wins.get(k) ?? 0) + 1);
      }
    }
  }

  const standings = buildPlayerTotals(inMonth).map((row) => ({
    name: row.name,
    net: row.net,
    games: row.games,
    wins: wins.get(normalizeName(row.name)) ?? 0,
  }));
  const best = (pick: (row: SeasonStanding) => number) => {
    const top = Math.max(...standings.map(pick));
    if (top <= 0) return null;
    return standings.find((row) => pick(row) === top) ?? null;
  };
  const latestKey = monthKey(ordered[ordered.length - 1].date);
  return {
    label: monthLabelOf(key),
    key,
    from: inMonth[0].date,
    to: inMonth[inMonth.length - 1].date,
    games: inMonth.length,
    standings,
    leader: standings[0] ?? null,
    mostWins: best((row) => row.wins),
    mostGames: best((row) => row.games),
    lead: standings.length > 1 ? round2(standings[0].net - standings[1].net) : null,
    closed: key < latestKey,
  };
}

// ------------------------------------------------------------- club buzz

export type BuzzItem = { id: string; text: string; tone: "up" | "info" };

/** The monthly points picture the buzz can talk about. */
export type BuzzPoints = {
  /** The month the standings belong to, e.g. "Nov 2026". */
  seasonLabel: string;
  /** Standings for that month now. */
  now: PointsRow[];
  /** The same month before its latest scored night. Empty when that night was the first. */
  before: PointsRow[];
  /** Date of the latest scored night in that month. */
  latestNightDate: string | null;
  /** Who won the month that just ended, if it had a clear winner. */
  champion?: { label: string; name: string } | null;
};

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The leader only when nobody shares the top spot. */
function strictLeader<T extends { name: string }>(rows: T[], value: (row: T) => number): T | null {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  return value(rows[0]) > value(rows[1]) ? rows[0] : null;
}

/** Places held by competition ranking: equal results share a place. */
function podiumKeys<T extends { name: string }>(rows: T[], value: (row: T) => number, places = 3): Map<string, number> {
  const out = new Map<string, number>();
  rows.forEach((row) => {
    const rank = 1 + rows.filter((other) => value(other) > value(row)).length;
    if (rank <= places) out.set(normalizeName(row.name), rank);
  });
  return out;
}

/**
 * A handful of plain lines about what changed lately, most important first: a new leader, someone
 * stepping onto a podium, the month's champion, then the latest game and streaks. It only celebrates;
 * it never calls anyone out for losing.
 */
export function buildBuzz(sessions: ChartSession[], limit = 5, points: BuzzPoints | null = null): BuzzItem[] {
  const ordered = sortSessions(sessions);
  if (!ordered.length) return [];
  const latest = ordered[ordered.length - 1];
  const { results, display } = perPlayerResults(ordered);
  const found: Array<BuzzItem & { weight: number }> = [];
  const add = (weight: number, item: BuzzItem) => found.push({ ...item, weight });

  // Money standings before and after the latest game.
  const now = buildPlayerTotals(ordered);
  const before = ordered.length > 1 ? buildPlayerTotals(ordered.slice(0, -1)) : [];
  const leaderNow = strictLeader(now, (row) => row.net);
  const leaderBefore = strictLeader(before, (row) => row.net);
  const newMoneyLeader =
    before.length > 0 && leaderNow && (!leaderBefore || normalizeName(leaderBefore.name) !== normalizeName(leaderNow.name))
      ? leaderNow
      : null;
  if (newMoneyLeader) {
    add(100, {
      id: "money-leader",
      tone: "up",
      text: `${newMoneyLeader.name} took the lead on the money leaderboard${leaderBefore ? `, passing ${leaderBefore.name}` : ""}.`,
    });
  }

  // Points standings, only when the latest game was a scored night so the news is current.
  const pointsFresh = Boolean(points && points.now.length && points.latestNightDate === latest.date);
  let newPointsLeader: string | null = null;
  if (points && pointsFresh) {
    const pointsNow = strictLeader(points.now, (row) => row.points);
    const pointsBefore = strictLeader(points.before, (row) => row.points);
    if (pointsNow && points.before.length === 0) {
      newPointsLeader = pointsNow.name;
      add(60, { id: "points-open", tone: "up", text: `${pointsNow.name} leads ${points.seasonLabel} points after the first scored night.` });
    } else if (pointsNow && (!pointsBefore || pointsBefore.key !== pointsNow.key)) {
      newPointsLeader = pointsNow.name;
      add(95, {
        id: "points-leader",
        tone: "up",
        text: `${pointsNow.name} took the lead in ${points.seasonLabel} points${pointsBefore ? `, passing ${pointsBefore.name}` : ""}.`,
      });
    }
  }

  // Someone stepping onto a podium (one line per board, never repeating a new leader).
  if (before.length >= 3) {
    const had = podiumKeys(before, (row) => row.net);
    const nowPlaces = podiumKeys(now, (row) => row.net);
    const entrant = now.find((row) => {
      const key = normalizeName(row.name);
      return nowPlaces.has(key) && !had.has(key) && key !== normalizeName(newMoneyLeader?.name ?? "");
    });
    if (entrant) {
      add(80, { id: "money-podium", tone: "up", text: `${entrant.name} moved onto the money podium, in ${ordinalLabel(nowPlaces.get(normalizeName(entrant.name)) ?? 3)}.` });
    }
  }
  if (points && pointsFresh && points.before.length >= 3) {
    const had = new Set(points.before.filter((row) => row.rank <= 3).map((row) => row.key));
    const entrant = points.now.find((row) => row.rank <= 3 && !had.has(row.key) && row.name !== newPointsLeader);
    if (entrant) {
      add(78, { id: "points-podium", tone: "up", text: `${entrant.name} moved onto the ${points.seasonLabel} points podium, in ${ordinalLabel(entrant.rank)}.` });
    }
  }

  // A month that just ended.
  if (points?.champion) {
    add(90, { id: "month-champion", tone: "up", text: `${points.champion.label} points champion: ${points.champion.name}.` });
  }

  // The latest game, naming everyone who shared the top result.
  const real = latest.players.filter((record) => isRealPlayer(record.player));
  if (real.length) {
    const top = real.reduce((best, record) => Math.max(best, record.net), real[0].net);
    if (top > 0) {
      const winners = [...new Set(real.filter((record) => record.net === top).map((record) => record.player.trim()))];
      add(70, {
        id: "latest-winner",
        tone: "up",
        text:
          winners.length === 1
            ? `${winners[0]} won the latest game, ${money(top)} up on the night.`
            : `${joinNames(winners)} shared the top spot in the latest game, ${money(top)} up each.`,
      });
    }
  }

  // Runs of nights in profit. This says "in profit", not "won": a night in profit is not always the night's best result.
  const streaks: Array<{ key: string; run: number }> = [];
  for (const [key, list] of results) {
    let run = 0;
    for (let i = list.length - 1; i >= 0 && list[i].net > 0; i--) run += 1;
    if (run >= 3) streaks.push({ key, run });
  }
  streaks.sort((a, b) => b.run - a.run);
  for (const streak of streaks.slice(0, 2)) {
    const who = display.get(streak.key) ?? streak.key;
    add(50, { id: `hot-${streak.key}`, tone: "up", text: `${who} has finished in profit ${streak.run} games in a row.` });
  }

  // Biggest pot of the record.
  const biggest = ordered.reduce((best, session) => (session.totalBuyIn > best.totalBuyIn ? session : best), ordered[0]);
  if (biggest.totalBuyIn > 0) {
    add(20, {
      id: "biggest-pot",
      tone: "info",
      text: biggest === latest
        ? `The latest game was the biggest pot on record: ${money(biggest.totalBuyIn)}.`
        : `Biggest pot on record: ${money(biggest.totalBuyIn)}.`,
    });
  }

  return found
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ weight: _weight, ...item }) => item);
}

function ordinalLabel(n: number) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10] ?? "th"}`;
}

// ----------------------------------------------------------- shared games

export type SharedGames = {
  /** The other player, as the club writes their name. */
  name: string;
  /** Games both of them sat in. */
  games: number;
  /** What the viewer won or lost across those games. */
  yourNet: number;
  /** What the other player won or lost across the same games. */
  theirNet: number;
  /** The most recent shared games, oldest first, for the trend strip. */
  recent: Array<{ date: string; sessionNumber: number; yours: number; theirs: number; isTournament: boolean }>;
};

/** How the viewer has done in the games they and another player both played. */
export function buildSharedGames(
  sessions: ChartSession[],
  viewerName: string,
  otherName: string,
  recentCount = 8,
): SharedGames | null {
  const viewerKey = normalizeName(viewerName);
  const otherKey = normalizeName(otherName);
  if (viewerKey === otherKey) return null;
  const { results, display } = perPlayerResults(sessions);
  const mine = results.get(viewerKey);
  const theirs = results.get(otherKey);
  if (!mine || !theirs) return null;
  const theirBySession = new Map(theirs.map((entry) => [entry.session, entry.net]));
  const shared = mine.flatMap((entry) => {
    const other = theirBySession.get(entry.session);
    return other === undefined ? [] : [{ session: entry.session, yours: entry.net, theirs: other }];
  });
  return {
    name: display.get(otherKey) ?? otherName,
    games: shared.length,
    yourNet: round2(shared.reduce((sum, row) => sum + row.yours, 0)),
    theirNet: round2(shared.reduce((sum, row) => sum + row.theirs, 0)),
    recent: shared.slice(-recentCount).map((row) => ({
      date: row.session.date,
      sessionNumber: row.session.sessionNumber,
      yours: row.yours,
      theirs: row.theirs,
      isTournament: row.session.eventType === "tournament",
    })),
  };
}

// ------------------------------------------------------------ trophy shelf

export type Trophy = {
  id: BadgeId;
  label: string;
  /** How to earn it. */
  blurb: string;
  earned: boolean;
  /** Why the player has it, when earned. */
  reason: string | null;
  /** Progress toward a count-based badge, when locked. */
  progress: { current: number; target: number } | null;
};

/** Every badge, earned or locked, in a fixed order, for one player's profile. */
export function buildTrophyShelf(
  sessions: ChartSession[],
  playerName: string,
  badgeMap?: Map<string, Badge[]>,
  careerGames?: number,
): Trophy[] {
  const map = badgeMap ?? buildBadges(sessions);
  const earned = new Map(badgesFor(map, playerName).map((badge) => [badge.id, badge]));
  const games = careerGames ?? perPlayerResults(sessions).results.get(normalizeName(playerName))?.length ?? 0;
  return BADGE_ORDER.map((id) => {
    const badge = earned.get(id);
    return {
      id,
      label: BADGE_META[id].label,
      blurb: BADGE_META[id].blurb,
      earned: Boolean(badge),
      reason: badge?.reason ?? null,
      progress: !badge && id === "veteran" ? { current: Math.min(games, VETERAN_GAMES), target: VETERAN_GAMES } : null,
    };
  });
}

/**
 * Badge ids earned now that are not in `seen`. Standing badges can move between players, so
 * the caller stores everything it has shown and only announces what is new.
 */
export function newlyEarned(current: Badge[], seen: readonly string[]): Badge[] {
  const known = new Set(seen);
  return current.filter((badge) => !known.has(badge.id));
}

// ---------------------------------------------------------- account stats

export type AccountStats = {
  playerName: string;
  games: number;
  gamesInProfit: number;
  net: number;
  bestGame: number;
  worstGame: number;
  /** Date of the first recorded game, or null with no games. */
  firstDate: string | null;
  longestWinStreak: number;
  /** The last five games, newest first. */
  recent: Array<{ date: string; net: number; sessionNumber: number; isTournament: boolean }>;
};

/** Personal totals for the account page. Null when the member has no recorded games. */
export function buildAccountStats(sessions: ChartSession[], playerName: string): AccountStats | null {
  const { results, display } = perPlayerResults(sessions);
  const key = normalizeName(playerName);
  const list = results.get(key);
  if (!list?.length) return null;

  let longest = 0;
  let run = 0;
  for (const entry of list) {
    run = entry.net > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const nets = list.map((entry) => entry.net);
  return {
    playerName: display.get(key) ?? playerName,
    games: list.length,
    gamesInProfit: nets.filter((net) => net > 0).length,
    net: round2(nets.reduce((sum, net) => sum + net, 0)),
    bestGame: Math.max(...nets),
    worstGame: Math.min(...nets),
    firstDate: list[0].session.date,
    longestWinStreak: longest,
    recent: list
      .slice(-5)
      .reverse()
      .map((entry) => ({
        date: entry.session.date,
        net: entry.net,
        sessionNumber: entry.session.sessionNumber,
        isTournament: entry.session.eventType === "tournament",
      })),
  };
}
