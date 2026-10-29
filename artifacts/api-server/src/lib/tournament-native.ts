// Works out a tournament from what a club entered: who finished where, how many entries and
// knockouts each had, and optionally what each was paid. Produces the same TournamentEvent the
// sheet reader produces, so every tournament screen, the points and the recaps work unchanged.
// Pure functions with no database access, so the maths can be unit tested.
import { parseDate } from "./import-parse.ts";
import type { TournamentEvent, TournamentResultRow } from "./tournament-parse.ts";

export type TournamentPlayerInput = {
  name: string;
  finishPlace: number | null;
  /** Total entries including rebuys. */
  entries: number;
  topUp: boolean;
  freeEntry: boolean;
  knockouts: number;
  /** Prize for finishing position. null = work it out from the shares. */
  payout: number | null;
};

export type TournamentInput = {
  id: string;
  date: string;
  title: string;
  venue: string | null;
  notes: string | null;
  buyIn: number;
  topUp: number;
  bounty: number;
  startingStack: number;
  /** The winner also collects their own bounty. */
  winnerKeepsBounty: boolean;
  shares: { first: number; second: number; third: number };
  players: TournamentPlayerInput[];
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function amount(value: unknown, label: string, max = 100_000): number | string {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) return `${label} must be between 0 and ${max.toLocaleString("en")}.`;
  return round2(parsed);
}

function whole(value: unknown, label: string, min: number, max: number): number | string {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return `${label} must be a whole number from ${min} to ${max}.`;
  return parsed;
}

/** Checks what the form sent and returns it cleaned, or the first thing wrong. */
export function validateTournament(body: unknown, id: string): { value: TournamentInput } | { error: string } {
  const input = (body ?? {}) as Record<string, unknown>;
  const date = typeof input.date === "string" ? parseDate(input.date) : null;
  if (!date) return { error: "Choose the date of the tournament." };

  const title = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ") : "";
  if (title.length > 80) return { error: "Keep the title under 80 characters." };
  const venue = typeof input.venue === "string" && input.venue.trim() ? input.venue.trim().slice(0, 80) : null;
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 500) : null;

  const buyIn = amount(input.buyIn ?? 0, "Buy-in");
  const topUp = amount(input.topUp ?? 0, "Top-up");
  const bounty = amount(input.bounty ?? 0, "Bounty");
  const stack = whole(input.startingStack ?? 0, "Starting stack", 0, 10_000_000);
  for (const field of [buyIn, topUp, bounty, stack]) if (typeof field === "string") return { error: field };
  if ((bounty as number) > (buyIn as number)) return { error: "The bounty can't be more than the buy-in." };

  const rawShares = (input.shares ?? {}) as Record<string, unknown>;
  const first = whole(rawShares.first ?? 50, "First place share", 0, 100);
  const second = whole(rawShares.second ?? 30, "Second place share", 0, 100);
  const third = whole(rawShares.third ?? 20, "Third place share", 0, 100);
  for (const field of [first, second, third]) if (typeof field === "string") return { error: field };
  if ((first as number) + (second as number) + (third as number) > 100) return { error: "The prize shares can't add up to more than 100%." };

  const rows = Array.isArray(input.players) ? (input.players as unknown[]) : [];
  const players: TournamentPlayerInput[] = [];
  const names = new Set<string>();
  const places = new Set<number>();
  for (const row of rows) {
    const entry = (row ?? {}) as Record<string, unknown>;
    const name = typeof entry.name === "string" ? entry.name.trim().replace(/\s+/g, " ") : "";
    if (!name) continue;
    if (name.length > 40) return { error: `${name.slice(0, 20)}… is too long a name.` };
    if (names.has(name.toLowerCase())) return { error: `${name} is listed twice.` };
    names.add(name.toLowerCase());

    const placeRaw = entry.finishPlace;
    let finishPlace: number | null = null;
    if (placeRaw !== null && placeRaw !== undefined && placeRaw !== "") {
      const place = whole(placeRaw, `${name}'s finish place`, 1, 200);
      if (typeof place === "string") return { error: place };
      if (places.has(place)) return { error: `Two players can't both finish ${place}.` };
      places.add(place);
      finishPlace = place;
    }
    const entries = whole(entry.entries ?? 1, `${name}'s entries`, 1, 20);
    const knockouts = whole(entry.knockouts ?? 0, `${name}'s knockouts`, 0, 100);
    if (typeof entries === "string") return { error: entries };
    if (typeof knockouts === "string") return { error: knockouts };
    let payout: number | null = null;
    if (entry.payout !== null && entry.payout !== undefined && entry.payout !== "") {
      const paid = amount(entry.payout, `${name}'s payout`);
      if (typeof paid === "string") return { error: paid };
      payout = paid;
    }
    players.push({ name, finishPlace, entries, topUp: entry.topUp === true, freeEntry: entry.freeEntry === true, knockouts, payout });
  }
  if (players.length < 2) return { error: "Add at least two players." };
  if (players.length > 100) return { error: "That's more than 100 players." };

  return {
    value: {
      id,
      date,
      title: title || "Tournament",
      venue,
      notes,
      buyIn: buyIn as number,
      topUp: topUp as number,
      bounty: bounty as number,
      startingStack: stack as number,
      winnerKeepsBounty: input.winnerKeepsBounty === true,
      shares: { first: first as number, second: second as number, third: third as number },
      players,
    },
  };
}

/** Splits the main prize pool across 1st to 3rd by the shares, among the places that exist. */
function sharePayouts(pool: number, shares: TournamentInput["shares"], placesPresent: number[]): Map<number, number> {
  const weights: Array<[number, number]> = ([[1, shares.first], [2, shares.second], [3, shares.third]] as Array<[number, number]>).filter(
    ([place, weight]) => placesPresent.includes(place) && weight > 0,
  );
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  const out = new Map<number, number>();
  if (total === 0 || pool <= 0) return out;
  let paid = 0;
  for (const [place, weight] of weights) {
    const share = round2((pool * weight) / total);
    out.set(place, share);
    paid += share;
  }
  // Rounding crumbs go to the top of the table so the pool pays out exactly.
  const topPlace = weights[0][0];
  out.set(topPlace, round2((out.get(topPlace) ?? 0) + (pool - paid)));
  return out;
}

export function buildTournamentEvent(input: TournamentInput): TournamentEvent {
  const investedBy = (player: TournamentPlayerInput) =>
    round2(Math.max(0, player.entries - (player.freeEntry ? 1 : 0)) * input.buyIn + (player.topUp ? input.topUp : 0));
  const totalCollected = round2(input.players.reduce((sum, player) => sum + investedBy(player), 0));
  // Bounties are paid per knockout. Every entry puts one in, but the winner's own is never
  // claimed unless the club lets the winner keep it, so whatever isn't paid out rolls into the
  // main prize pool and the books always balance.
  const winnerBounty = (player: TournamentPlayerInput) => (input.winnerKeepsBounty && player.finishPlace === 1 ? 1 : 0);
  const bountyPool = round2(input.players.reduce((sum, player) => sum + player.knockouts + winnerBounty(player), 0) * input.bounty);
  const mainPrizePool = round2(Math.max(0, totalCollected - bountyPool));

  const anyPayout = input.players.some((player) => player.payout !== null);
  const auto = anyPayout
    ? new Map<number, number>()
    : sharePayouts(mainPrizePool, input.shares, input.players.map((player) => player.finishPlace).filter((place): place is number => place !== null));

  const results: TournamentResultRow[] = input.players
    .map((player) => {
      const invested = investedBy(player);
      const mainPrize = round2(player.payout ?? (player.finishPlace !== null ? auto.get(player.finishPlace) ?? 0 : 0));
      const bountiesWon = round2((player.knockouts + winnerBounty(player)) * input.bounty);
      const totalReturn = round2(mainPrize + bountiesWon);
      return {
        player: player.name,
        entries: player.entries,
        rebuys: Math.max(0, player.entries - 1),
        topUp: player.topUp,
        freeEntry: player.freeEntry,
        finishPlace: player.finishPlace,
        knockouts: player.knockouts,
        eliminatedBy: null,
        invested,
        bountiesWon,
        mainPrize,
        totalReturn,
        netProfit: round2(totalReturn - invested),
        inTheMoney: mainPrize > 0,
      };
    })
    .sort((a, b) => {
      if (a.finishPlace !== null && b.finishPlace !== null) return a.finishPlace - b.finishPlace;
      if (a.finishPlace !== null) return -1;
      if (b.finishPlace !== null) return 1;
      return b.netProfit - a.netProfit || a.player.localeCompare(b.player);
    });

  const byPlace = (place: number) => results.find((result) => result.finishPlace === place) ?? null;
  const hunter = results.reduce<TournamentResultRow | null>((top, result) => (result.knockouts > (top?.knockouts ?? 0) ? result : top), null);
  const totalReturned = round2(results.reduce((sum, result) => sum + result.totalReturn, 0));
  const gap = round2(totalReturned - totalCollected);

  return {
    id: input.id,
    date: input.date,
    title: input.title,
    status: "Completed",
    format: input.bounty > 0 ? "Bounty tournament" : "Freezeout",
    startTime: null,
    venue: input.venue,
    buyIn: input.buyIn,
    topUp: input.topUp,
    bounty: input.bounty,
    bountyBasis: input.bounty > 0 ? "per entry" : null,
    startingStack: input.startingStack,
    topUpStack: 0,
    shares: input.shares,
    players: results.length,
    entries: input.players.reduce((sum, player) => sum + player.entries, 0),
    rebuys: results.reduce((sum, result) => sum + result.rebuys, 0),
    topUps: input.players.filter((player) => player.topUp).length,
    freeEntries: input.players.filter((player) => player.freeEntry).length,
    knockouts: results.reduce((sum, result) => sum + result.knockouts, 0),
    totalCollected,
    bountyPool,
    mainPrizePool,
    winner: byPlace(1)?.player ?? null,
    runnerUp: byPlace(2)?.player ?? null,
    thirdPlace: byPlace(3)?.player ?? null,
    winnerPrize: byPlace(1)?.mainPrize ?? 0,
    topBountyHunter: hunter?.player ?? null,
    mostKnockouts: hunter?.knockouts ?? 0,
    notes: input.notes,
    dataCheck: Math.abs(gap) < 0.5 ? "OK" : `Returns differ from the money collected by ${Math.abs(gap).toFixed(2)}`,
    results,
  };
}
