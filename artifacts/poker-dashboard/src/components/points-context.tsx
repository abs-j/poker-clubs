import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TournamentEvent } from "@/lib/earnings-analytics";
import {
  buildPointsLeaderboard,
  firstScoredDate,
  pointsSeasons,
  scoreNights,
  seasonOf,
  type NightKind,
  type PointsCashNight,
  type PointsRow,
  type PointsRules,
  POINTS_RULES,
} from "@/lib/points";

type PointsValue = {
  /** The rules this club scores by. */
  rules: PointsRules;
  /** Every season with a scored night, newest first. */
  seasons: string[];
  /** The newest season, or null when nothing is scored yet. */
  currentSeason: string | null;
  rowsFor: (season: string) => PointsRow[];
  /** Rows for a season limited to some kinds of night (the leaderboard's Cash / Tournaments filter). */
  rowsWith: (options: { season: string; kinds?: NightKind[] }) => PointsRow[];
  /** The same month's standings before its latest scored night, for "who just moved" news. */
  rowsBeforeLatest: (season: string) => PointsRow[];
  /** First night that scored, e.g. for "scored nights start on". */
  firstNight: string | null;
  tournaments: TournamentEvent[];
};

const EMPTY: PointsValue = {
  rules: POINTS_RULES,
  seasons: [],
  currentSeason: null,
  rowsFor: () => [],
  rowsWith: () => [],
  rowsBeforeLatest: () => [],
  firstNight: null,
  tournaments: [],
};
const PointsContext = createContext<PointsValue>(EMPTY);

/** Computes club points once from the nights already loaded, for every screen to share. */
export function PointsProvider({
  cashNights,
  tournaments,
  rules = POINTS_RULES,
  children,
}: {
  cashNights: PointsCashNight[];
  tournaments: TournamentEvent[];
  rules?: PointsRules;
  children: ReactNode;
}) {
  const value = useMemo<PointsValue>(() => {
    const seasons = pointsSeasons(cashNights, tournaments, rules);
    const cache = new Map<string, PointsRow[]>();
    return {
      rules,
      seasons,
      currentSeason: seasons[0] ?? null,
      rowsFor: (season) => {
        const cached = cache.get(season);
        if (cached) return cached;
        const rows = buildPointsLeaderboard(cashNights, tournaments, { season, rules });
        cache.set(season, rows);
        return rows;
      },
      rowsWith: ({ season, kinds }) => {
        const cacheKey = `${season}|${(kinds ?? []).join(",")}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;
        const rows = buildPointsLeaderboard(cashNights, tournaments, { season, kinds, rules });
        cache.set(cacheKey, rows);
        return rows;
      },
      rowsBeforeLatest: (season) => {
        const nights = scoreNights(cashNights, tournaments, rules)
          .map((entry) => entry.night)
          .filter((night) => seasonOf(night.date) === season)
          .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        const latest = nights[nights.length - 1];
        if (!latest) return [];
        return buildPointsLeaderboard(
          cashNights.filter((night) => `cash-${night.sessionNumber}` !== latest.id),
          tournaments.filter((event) => `tournament-${event.id}` !== latest.id),
          { season, rules },
        );
      },
      firstNight: firstScoredDate(cashNights, tournaments, rules),
      tournaments,
    };
  }, [cashNights, tournaments, rules]);
  return <PointsContext.Provider value={value}>{children}</PointsContext.Provider>;
}

export const usePoints = () => useContext(PointsContext);
