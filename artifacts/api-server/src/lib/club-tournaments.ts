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
        winnerKeepsBounty: input.winnerKeepsBounty,
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
      winnerKeepsBounty: clubTournaments.winnerKeepsBounty,
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
      winnerKeepsBounty: row.winnerKeepsBounty,
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

/** The stored tournament, in the same shape the record form sends, or null when it is not in this club. */
export async function getTournament(clubId: number, id: number): Promise<TournamentInput | null> {
  const [event] = await db
    .select()
    .from(clubTournaments)
    .where(and(eq(clubTournaments.clubId, clubId), eq(clubTournaments.id, id)))
    .limit(1);
  if (!event) return null;
  const rows = await db
    .select({
      id: tournamentResults.id,
      name: players.displayName,
      place: tournamentResults.finishPlace,
      entries: tournamentResults.entries,
      topUp: tournamentResults.topUp,
      freeEntry: tournamentResults.freeEntry,
      knockouts: tournamentResults.knockouts,
      payout: tournamentResults.payoutCents,
    })
    .from(tournamentResults)
    .innerJoin(players, and(eq(players.id, tournamentResults.playerId), eq(players.clubId, clubId)))
    .where(eq(tournamentResults.tournamentId, event.id))
    .orderBy(asc(tournamentResults.id));
  rows.sort((a, b) => (a.place ?? 999) - (b.place ?? 999) || a.id - b.id);
  return {
    id: `club-${event.id}`,
    date: event.eventDate,
    title: event.title,
    venue: event.venue,
    notes: event.notes,
    buyIn: toDollars(event.buyInCents),
    topUp: toDollars(event.topUpCents),
    bounty: toDollars(event.bountyCents),
    startingStack: event.startingStack,
    winnerKeepsBounty: event.winnerKeepsBounty,
    shares: { first: event.shareFirst, second: event.shareSecond, third: event.shareThird },
    players: rows.map((row) => ({
      name: row.name,
      finishPlace: row.place,
      entries: row.entries,
      topUp: row.topUp,
      freeEntry: row.freeEntry,
      knockouts: row.knockouts,
      payout: row.payout === null ? null : toDollars(row.payout),
    })),
  };
}

/** Replaces a tournament and its results. Nothing is written when the id is not in this club. */
export async function updateTournament(clubId: number, id: number, input: TournamentInput): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: clubTournaments.id })
      .from(clubTournaments)
      .where(and(eq(clubTournaments.clubId, clubId), eq(clubTournaments.id, id)))
      .limit(1)
      .for("update");
    if (!row) return false;
    await tx
      .update(clubTournaments)
      .set({
        eventDate: input.date,
        title: input.title,
        venue: input.venue,
        notes: input.notes,
        buyInCents: toCents(input.buyIn),
        topUpCents: toCents(input.topUp),
        bountyCents: toCents(input.bounty),
        startingStack: input.startingStack,
        winnerKeepsBounty: input.winnerKeepsBounty,
        shareFirst: input.shares.first,
        shareSecond: input.shares.second,
        shareThird: input.shares.third,
      })
      .where(and(eq(clubTournaments.clubId, clubId), eq(clubTournaments.id, id)));
    await tx.delete(tournamentResults).where(eq(tournamentResults.tournamentId, id));
    const ids = await ensurePlayers(tx, clubId, input.players.map((player) => player.name));
    await tx.insert(tournamentResults).values(
      input.players.map((player) => ({
        tournamentId: id,
        playerId: ids.get(normalizeNameKey(player.name))!,
        finishPlace: player.finishPlace,
        entries: player.entries,
        topUp: player.topUp,
        freeEntry: player.freeEntry,
        knockouts: player.knockouts,
        payoutCents: player.payout === null ? null : toCents(player.payout),
      })),
    );
    return true;
  });
}

/** Deletes a tournament and its results. False when the id is not in this club. */
export async function deleteTournament(clubId: number, id: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: clubTournaments.id })
      .from(clubTournaments)
      .where(and(eq(clubTournaments.clubId, clubId), eq(clubTournaments.id, id)))
      .limit(1)
      .for("update");
    if (!row) return false;
    await tx.delete(tournamentResults).where(eq(tournamentResults.tournamentId, id));
    const removed = await tx
      .delete(clubTournaments)
      .where(and(eq(clubTournaments.clubId, clubId), eq(clubTournaments.id, id)))
      .returning({ id: clubTournaments.id });
    return removed.length > 0;
  });
}

const sameTournament = (a: { date: string; title: string }, b: { date: string; title: string }) =>
  a.date === b.date && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();

/** What an import would do, tournament by tournament, without saving anything. */
export async function previewTournamentImport(clubId: number, inputs: TournamentInput[]) {
  const existing = await listTournaments(clubId);
  return inputs.map((input) => {
    const event = buildTournamentEvent(input);
    return {
      date: input.date,
      title: input.title,
      players: event.players,
      entries: event.entries,
      totalCollected: event.totalCollected,
      winner: event.winner,
      winnerPrize: event.winnerPrize,
      alreadyRecorded: existing.some((row) => sameTournament(row, input)),
    };
  });
}

/** Records the tournaments not already in the club (same date and title); returns the counts. */
export async function commitTournamentImport(clubId: number, createdBy: string | null, inputs: TournamentInput[]) {
  const existing = await listTournaments(clubId);
  let imported = 0;
  let duplicates = 0;
  for (const input of inputs) {
    if (existing.some((row) => sameTournament(row, input))) {
      duplicates += 1;
      continue;
    }
    await recordTournament(clubId, createdBy, input);
    imported += 1;
  }
  return { imported, duplicates };
}
