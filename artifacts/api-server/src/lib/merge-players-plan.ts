// How two results for the same person become one, without a database. Cash nights add up.
// A tournament is combined only when the money still comes out the same; otherwise the caller refuses.
import { buildTournamentEvent, type TournamentPlayerInput } from "./tournament-native.ts";

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export type CashResult = { buyInCents: number; cashOutCents: number };

/** Buy-ins and cash-outs add, so the club's totals and the person's net stay the same. */
export function combineCash(kept: CashResult, merged: CashResult): CashResult {
  return {
    buyInCents: kept.buyInCents + merged.buyInCents,
    cashOutCents: kept.cashOutCents + merged.cashOutCents,
  };
}

/**
 * A settle-up tick means the whole result for that night is settled.
 * When both names played, keep the tick only if both were already settled.
 */
export function combinedSettlement(keptSettled: boolean, mergedSettled: boolean): "keep" | "clear" {
  return keptSettled && mergedSettled ? "keep" : "clear";
}

export type TournamentMoney = {
  buyIn: number;
  topUp: number;
  bounty: number;
  winnerKeepsBounty: boolean;
  shares: { first: number; second: number; third: number };
};

const bestPlace = (left: number | null, right: number | null): number | null => {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
};

/**
 * Folds two results in one tournament into the kept name.
 * Prizes already on the board are written down as amounts, so the other players' payouts do not move.
 * Two top-ups, or two free entries, cannot be stored on one row without changing what the club collected.
 */
export function combineTournamentField(
  players: TournamentPlayerInput[],
  money: TournamentMoney,
  keepKey: string,
  mergeKey: string,
): { players: TournamentPlayerInput[] } | { error: string } {
  const keep = players.find((player) => nameKey(player.name) === keepKey);
  const merged = players.find((player) => nameKey(player.name) === mergeKey);
  if (!keep || !merged) return { error: "Both names have to be in the tournament." };
  if (keep.topUp && merged.topUp) {
    return { error: "Both names took a top-up in this tournament, so those results can't be combined." };
  }
  if (keep.freeEntry && merged.freeEntry) {
    return { error: "Both names have a free entry in this tournament, so those results can't be combined." };
  }

  const event = buildTournamentEvent({
    id: "merge",
    date: "2020-01-01",
    title: "Merge",
    venue: null,
    notes: null,
    startingStack: 0,
    ...money,
    players,
  });
  const prizeOf = (key: string) => event.results.find((result) => nameKey(result.player) === key)?.mainPrize ?? 0;
  const combined: TournamentPlayerInput = {
    name: keep.name,
    finishPlace: bestPlace(keep.finishPlace, merged.finishPlace),
    entries: keep.entries + merged.entries,
    topUp: keep.topUp || merged.topUp,
    freeEntry: keep.freeEntry || merged.freeEntry,
    knockouts: keep.knockouts + merged.knockouts,
    payout: round2(prizeOf(keepKey) + prizeOf(mergeKey)),
  };
  const rest = players
    .filter((player) => {
      const key = nameKey(player.name);
      return key !== keepKey && key !== mergeKey;
    })
    .map((player) => ({ ...player, payout: prizeOf(nameKey(player.name)) }));
  return { players: [combined, ...rest] };
}
