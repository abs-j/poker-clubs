import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { clubTournaments, db, normalizeNameKey, players, tournamentResults } from "@workspace/db";
import { ensurePlayers } from "./club-sessions";
import { buildTournamentEvent, type TournamentInput, type TournamentPlayerInput } from "./tournament-native";
import type { TournamentEvent } from "./tournament-parse";

const toCents = (dollars: number) => Math.round(dollars * 100);
const toDollars = (cents: number) => cents / 100;

export async function recordTournament(clubId: number, createdBy: string | null, input: TournamentInput): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(clubTournaments)
      .values({
        clubId,
        eventDate: input.date,
        title: input.title,
        venue: input.venue,
        notes: input.notes,
        buyInCents: toCents(input.buyIn),
        topUpCents: toCents(input.topUp),
        bountyCents: toCents(input.bounty),
        startingStack: input.startingStack,
        shareFirst: input.shares.first,
        shareSecond: input.shares.second,
        shareThird: input.shares.third,
        createdBy,
      })
      .returning({ id: clubTournaments.id });
    const ids = await ensurePlayers(tx, clubId, input.players.map((player) => player.name));
    await tx.insert(tournamentResults).values(
      input.players.map((player) => ({
        tournamentId: row.id,
        playerId: ids.get(normalizeNameKey(player.name))!,
        finishPlace: player.finishPlace,
        entries: player.entries,
        topUp: player.topUp,
        freeEntry: player.freeEntry,
        knockouts: player.knockouts,
        payoutCents: player.payout === null ? null : toCents(player.payout),
      })),
    );
    return row.id;
  });
}

/** Every tournament the club ran, fully worked out, oldest first. */
export async function loadTournamentEvents(clubId: number): Promise<TournamentEvent[]> {
  const rows = await db
    .select({
      id: clubTournaments.id,
      date: clubTournaments.eventDate,
      title: clubTournaments.title,
      venue: clubTournaments.venue,
      notes: clubTournaments.notes,
      buyIn: clubTournaments.buyInCents,
      topUp: clubTournaments.topUpCents,
      bounty: clubTournaments.bountyCents,
      stack: clubTournaments.startingStack,
      first: clubTournaments.shareFirst,
      second: clubTournaments.shareSecond,
      third: clubTournaments.shareThird,
      name: players.displayName,
      place: tournamentResults.finishPlace,
      entries: tournamentResults.entries,
      topUpFlag: tournamentResults.topUp,
      freeEntry: tournamentResults.freeEntry,
      knockouts: tournamentResults.knockouts,
      payout: tournamentResults.payoutCents,
    })
    .from(clubTournaments)
    .innerJoin(tournamentResults, eq(tournamentResults.tournamentId, clubTournaments.id))
    .innerJoin(players, eq(players.id, tournamentResults.playerId))
    .where(eq(clubTournaments.clubId, clubId))
    .orderBy(asc(clubTournaments.eventDate), asc(clubTournaments.id), asc(tournamentResults.id));

  const inputs = new Map<number, TournamentInput>();
  for (const row of rows) {
    const input = inputs.get(row.id) ?? {
      id: `club-${row.id}`,
      date: row.date,
      title: row.title,
      venue: row.venue,
      notes: row.notes,
      buyIn: toDollars(row.buyIn),
      topUp: toDollars(row.topUp),
      bounty: toDollars(row.bounty),
      startingStack: row.stack,
      shares: { first: row.first, second: row.second, third: row.third },
      players: [] as TournamentPlayerInput[],
    };
    input.players.push({
      name: row.name,
      finishPlace: row.place,
      entries: row.entries,
      topUp: row.topUpFlag,
      freeEntry: row.freeEntry,
      knockouts: row.knockouts,
      payout: row.payout === null ? null : toDollars(row.payout),
    });
    inputs.set(row.id, input);
  }
  return [...inputs.values()].map(buildTournamentEvent);
}

export async function listTournaments(clubId: number) {
  const rows = await db
    .select({
      id: clubTournaments.id,
      date: clubTournaments.eventDate,
      title: clubTournaments.title,
      players: count(tournamentResults.id),
      collectedCents: sql<number>`coalesce(sum(${tournamentResults.entries}), 0)`.mapWith(Number),
    })
    .from(clubTournaments)
    .leftJoin(tournamentResults, eq(tournamentResults.tournamentId, clubTournaments.id))
    .where(eq(clubTournaments.clubId, clubId))
    .groupBy(clubTournaments.id)
    .orderBy(desc(clubTournaments.eventDate), desc(clubTournaments.id));
  return rows.map((row) => ({ id: row.id, date: row.date, title: row.title, players: row.players, entries: row.collectedCents }));
}

export async function deleteTournament(clubId: number, id: number): Promise<boolean> {
  const removed = await db
    .delete(clubTournaments)
    .where(and(eq(clubTournaments.clubId, clubId), eq(clubTournaments.id, id)))
    .returning({ id: clubTournaments.id });
  return removed.length > 0;
}
