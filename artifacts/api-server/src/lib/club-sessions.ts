import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  clubSessions,
  clubTournaments,
  db,
  jackpotPayouts,
  liveActivityEvents,
  liveSessions,
  normalizeNameKey,
  players,
  sessionResults,
} from "@workspace/db";
import { buildClubDashboard, type NightInput } from "./club-dashboard";
import { nightFingerprint, type ParsedNight } from "./import-parse";
import { loadTournamentEvents } from "./club-tournaments";
import { checkResolution, gapOf, parseResolution, resolveBalance, type BalanceResolution } from "./night-balance";
import { payoutCents, remainingJackpotCents } from "./jackpot";
import { canManageNight, hostOf, LedgerPermissionError, type LedgerActor } from "./ledger-permissions";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

const toCents = (dollars: number) => Math.round(dollars * 100);
const toDollars = (cents: number) => cents / 100;
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

type NightPlayer = { name: string; buyInCents: number; cashOutCents: number };

/** Finds each name on the club's roster, adding the ones that are new (unclaimed). */
export async function ensurePlayers(tx: Executor, clubId: number, names: string[]): Promise<Map<string, number>> {
  const wanted = new Map<string, string>();
  for (const name of names) {
    const key = normalizeNameKey(name);
    if (key && !wanted.has(key)) wanted.set(key, tidy(name));
  }
  if (wanted.size === 0) return new Map();

  const found = await tx
    .select({ id: players.id, nameKey: players.nameKey })
    .from(players)
    .where(and(eq(players.clubId, clubId), inArray(players.nameKey, [...wanted.keys()])));
  const ids = new Map(found.map((row) => [row.nameKey, row.id]));

  const missing = [...wanted.entries()].filter(([key]) => !ids.has(key));
  if (missing.length > 0) {
    const created = await tx
      .insert(players)
      .values(missing.map(([key, displayName]) => ({ clubId, displayName, nameKey: key })))
      .onConflictDoNothing({ target: [players.clubId, players.nameKey] })
      .returning({ id: players.id, nameKey: players.nameKey });
    for (const row of created) ids.set(row.nameKey, row.id);
  }
  // A concurrent insert may have won the race for a name; look those up.
  const stillMissing = [...wanted.keys()].filter((key) => !ids.has(key));
  if (stillMissing.length > 0) {
    const rows = await tx
      .select({ id: players.id, nameKey: players.nameKey })
      .from(players)
      .where(and(eq(players.clubId, clubId), inArray(players.nameKey, stillMissing)));
    for (const row of rows) ids.set(row.nameKey, row.id);
  }
  return ids;
}

type NewNight = {
  clubId: number;
  date: string;
  source: "live" | "import" | "manual";
  liveSessionKey?: string;
  importBatch?: string;
  createdBy?: string | null;
  /** Surplus that went into the bad beat jackpot. */
  jackpotCents?: number;
  players: NightPlayer[];
};

/** Writes one night and its results. Returns the new id, or null when the live session was already recorded. */
async function recordNight(tx: Executor, night: NewNight): Promise<number | null> {
  const merged = new Map<string, NightPlayer>();
  for (const player of night.players) {
    const key = normalizeNameKey(player.name);
    if (!key) continue;
    const existing = merged.get(key);
    if (existing) {
      existing.buyInCents += player.buyInCents;
      existing.cashOutCents += player.cashOutCents;
    } else {
      merged.set(key, { ...player, name: tidy(player.name) });
    }
  }
  if (merged.size === 0) return null;

  const [session] = await tx
    .insert(clubSessions)
    .values({
      clubId: night.clubId,
      sessionDate: night.date,
      source: night.source,
      liveSessionKey: night.liveSessionKey ?? null,
      importBatch: night.importBatch ?? null,
      jackpotCents: night.jackpotCents ?? 0,
      createdBy: night.createdBy ?? null,
    })
    .onConflictDoNothing({ target: clubSessions.liveSessionKey })
    .returning({ id: clubSessions.id });
  if (!session) return null;

  const ids = await ensurePlayers(tx, night.clubId, [...merged.values()].map((player) => player.name));
  await tx.insert(sessionResults).values(
    [...merged.entries()].map(([key, player]) => ({
      sessionId: session.id,
      playerId: ids.get(key)!,
      buyInCents: player.buyInCents,
      cashOutCents: player.cashOutCents,
    })),
  );
  return session.id;
}

/**
 * Every closed live session becomes a recorded night. Safe to run any time: a live session
 * that already has its night is left alone.
 */
export async function syncClosedLiveSessions(clubId: number): Promise<number> {
  const pending = await db
    .select({ key: liveSessions.sessionKey, date: liveSessions.sessionDate, endedBy: liveSessions.endedBy, resolution: liveSessions.balanceResolution })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.clubId, clubId),
        eq(liveSessions.status, "ended"),
        sql`NOT EXISTS (SELECT 1 FROM ${clubSessions} WHERE ${clubSessions.liveSessionKey} = ${liveSessions.sessionKey})`,
      ),
    );
  let recorded = 0;
  for (const session of pending) {
    const events = await db
      .select({
        name: liveActivityEvents.memberName,
        action: liveActivityEvents.action,
        cents: liveActivityEvents.amountCents,
        deletedAt: liveActivityEvents.deletedAt,
      })
      .from(liveActivityEvents)
      .where(eq(liveActivityEvents.sessionKey, session.key));

    const byName = new Map<string, NightPlayer>();
    for (const event of events) {
      if (event.deletedAt) continue;
      const key = normalizeNameKey(event.name);
      const entry = byName.get(key) ?? { name: event.name, buyInCents: 0, cashOutCents: 0 };
      if (event.action === "buy_in") entry.buyInCents += event.cents;
      else if (event.action === "cash_out") entry.cashOutCents += event.cents;
      byName.set(key, entry);
    }
    // The admin's choice about any gap (jackpot, one player, shared) is applied as the night is recorded.
    const balanced = resolveBalance([...byName.values()], parseResolution(session.resolution));
    const id = await db.transaction((tx) =>
      recordNight(tx, {
        clubId,
        date: String(session.date).slice(0, 10),
        source: "live",
        liveSessionKey: session.key,
        createdBy: session.endedBy,
        jackpotCents: balanced.jackpotCents,
        players: balanced.players,
      }),
    );
    if (id !== null) recorded += 1;
  }
  return recorded;
}

/** The nights a deleted or reset ledger session produced go with it. */
export async function removeNightsForLiveSession(clubId: number, sessionKey: string, executor: Executor = db): Promise<void> {
  await executor
    .delete(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.liveSessionKey, sessionKey)));
}

export async function removeLiveNights(clubId: number): Promise<void> {
  await db.delete(clubSessions).where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.source, "live")));
}

async function loadNights(clubId: number): Promise<Array<NightInput & { id: number }>> {
  const rows = await db
    .select({
      id: clubSessions.id,
      date: clubSessions.sessionDate,
      name: players.displayName,
      buyInCents: sessionResults.buyInCents,
      cashOutCents: sessionResults.cashOutCents,
    })
    .from(clubSessions)
    .innerJoin(sessionResults, eq(sessionResults.sessionId, clubSessions.id))
    .innerJoin(players, eq(players.id, sessionResults.playerId))
    .where(eq(clubSessions.clubId, clubId))
    .orderBy(asc(clubSessions.sessionDate), asc(clubSessions.id), asc(sessionResults.id));

  const nights = new Map<number, NightInput & { id: number }>();
  for (const row of rows) {
    const night = nights.get(row.id) ?? { id: row.id, date: row.date, players: [] };
    night.players.push({ name: row.name, buyIn: toDollars(row.buyInCents), cashOut: toDollars(row.cashOutCents) });
    nights.set(row.id, night);
  }
  return [...nights.values()];
}

/** The dashboard for a club: every recorded night and tournament it has. */
export async function loadClubDashboard(clubId: number, title: string) {
  await syncClosedLiveSessions(clubId);
  const [nights, events] = await Promise.all([loadNights(clubId), loadTournamentEvents(clubId)]);
  return buildClubDashboard({ title, nights, tournaments: events });
}

/** Every recorded night, oldest first, for the CSV export. */
export async function loadNightsForExport(clubId: number): Promise<NightInput[]> {
  await syncClosedLiveSessions(clubId);
  return (await loadNights(clubId)).map(({ date, players }) => ({ date, players }));
}

export type ImportPreview = {
  nights: number;
  duplicates: number;
  players: number;
  newPlayers: string[];
  firstDate: string | null;
  lastDate: string | null;
};

async function splitDuplicates(clubId: number, nights: ParsedNight[]) {
  const existing = new Set((await loadNights(clubId)).map((night) => nightFingerprint(toParsed(night))));
  const fresh: ParsedNight[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  for (const night of nights) {
    const fingerprint = nightFingerprint(night);
    if (existing.has(fingerprint) || seen.has(fingerprint)) duplicates += 1;
    else fresh.push(night);
    seen.add(fingerprint);
  }
  return { fresh, duplicates };
}

const toParsed = (night: NightInput): ParsedNight => ({ date: night.date, players: night.players });

export async function previewImport(clubId: number, nights: ParsedNight[]): Promise<ImportPreview> {
  const { fresh, duplicates } = await splitDuplicates(clubId, nights);
  const names = new Map<string, string>();
  for (const night of fresh) for (const player of night.players) names.set(normalizeNameKey(player.name), tidy(player.name));
  const known =
    names.size === 0
      ? []
      : await db
          .select({ nameKey: players.nameKey })
          .from(players)
          .where(and(eq(players.clubId, clubId), inArray(players.nameKey, [...names.keys()])));
  const knownKeys = new Set(known.map((row) => row.nameKey));
  const dates = fresh.map((night) => night.date).sort();
  return {
    nights: fresh.length,
    duplicates,
    players: names.size,
    newPlayers: [...names.entries()].filter(([key]) => !knownKeys.has(key)).map(([, name]) => name).sort(),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

export async function commitImport(
  clubId: number,
  createdBy: string | null,
  nights: ParsedNight[],
  source: "import" | "manual",
) {
  const { fresh, duplicates } = await splitDuplicates(clubId, nights);
  const batch = randomUUID();
  const [before] = await db.select({ total: count() }).from(players).where(eq(players.clubId, clubId));
  await db.transaction(async (tx) => {
    for (const night of fresh) {
      await recordNight(tx, {
        clubId,
        date: night.date,
        source,
        importBatch: batch,
        createdBy,
        players: night.players.map((player) => ({
          name: player.name,
          buyInCents: toCents(player.buyIn),
          cashOutCents: toCents(player.cashOut),
        })),
      });
    }
  });
  const [after] = await db.select({ total: count() }).from(players).where(eq(players.clubId, clubId));
  return {
    batchId: batch,
    imported: fresh.length,
    duplicates,
    playersAdded: (after?.total ?? 0) - (before?.total ?? 0),
  };
}

export async function undoImport(clubId: number, batchId: string): Promise<number> {
  const removed = await db
    .delete(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.importBatch, batchId)))
    .returning({ id: clubSessions.id });
  return removed.length;
}

export async function listClubNights(clubId: number) {
  await syncClosedLiveSessions(clubId);
  const rows = await db
    .select({
      id: clubSessions.id,
      date: clubSessions.sessionDate,
      source: clubSessions.source,
      importBatch: clubSessions.importBatch,
      jackpotCents: clubSessions.jackpotCents,
      createdAt: clubSessions.createdAt,
      players: count(sessionResults.id),
      buyInCents: sql<number>`coalesce(sum(${sessionResults.buyInCents}), 0)`.mapWith(Number),
    })
    .from(clubSessions)
    .leftJoin(sessionResults, eq(sessionResults.sessionId, clubSessions.id))
    .where(eq(clubSessions.clubId, clubId))
    .groupBy(clubSessions.id)
    .orderBy(desc(clubSessions.sessionDate), desc(clubSessions.id));
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    source: row.source,
    importBatch: row.importBatch,
    createdAt: row.createdAt.toISOString(),
    players: row.players,
    totalBuyIn: toDollars(row.buyInCents),
    jackpot: toDollars(row.jackpotCents),
  }));
}

export type JackpotPayoutRow = {
  id: number;
  name: string;
  /** Dollars paid to this player. */
  amount: number;
  at: string;
  by: string;
};

export type JackpotView = {
  /** Dollars still in the pot: surplus from nights minus payouts. */
  total: number;
  nights: number;
  payouts: JackpotPayoutRow[];
};

/** A payout the club cannot record (bad amount, unknown player, empty pot). */
export class JackpotInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JackpotInputError";
  }
}

/** The bad beat jackpot still held, in dollars, how many nights added to it, and the payouts already made. */
export async function clubJackpot(clubId: number): Promise<JackpotView> {
  await syncClosedLiveSessions(clubId);
  const [row] = await db
    .select({
      contributed: sql<number>`coalesce(sum(${clubSessions.jackpotCents}), 0)`.mapWith(Number),
      nights: sql<number>`count(*) filter (where ${clubSessions.jackpotCents} > 0)`.mapWith(Number),
    })
    .from(clubSessions)
    .where(eq(clubSessions.clubId, clubId));
  const payouts = await db
    .select({
      id: jackpotPayouts.id,
      name: players.displayName,
      cents: jackpotPayouts.cents,
      at: jackpotPayouts.paidAt,
      by: jackpotPayouts.paidBy,
    })
    .from(jackpotPayouts)
    .innerJoin(players, eq(players.id, jackpotPayouts.playerId))
    .where(eq(jackpotPayouts.clubId, clubId))
    .orderBy(desc(jackpotPayouts.paidAt), desc(jackpotPayouts.id));
  const paid = payouts.reduce((sum, payout) => sum + payout.cents, 0);
  return {
    total: toDollars(remainingJackpotCents(row?.contributed ?? 0, paid)),
    nights: row?.nights ?? 0,
    payouts: payouts.map((payout) => ({
      id: payout.id,
      name: payout.name,
      amount: toDollars(payout.cents),
      at: payout.at.toISOString(),
      by: payout.by,
    })),
  };
}

/**
 * Records a payout to one player and returns the pot afterwards.
 * The caller has already checked that the host or an admin is asking.
 * Two payouts at once are serialized on the club row so they cannot overdraw the pot.
 */
export async function recordJackpotPayout(
  clubId: number,
  paidBy: string,
  body: { name?: unknown; amount?: unknown },
): Promise<JackpotView> {
  const name = typeof body.name === "string" ? tidy(body.name) : "";
  const key = normalizeNameKey(name);
  if (!key || name.length > 80) throw new JackpotInputError("Choose a player.");
  await syncClosedLiveSessions(clubId);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM clubs WHERE id = ${clubId} FOR UPDATE`);
    const [pot] = await tx
      .select({
        contributed: sql<number>`coalesce(sum(${clubSessions.jackpotCents}), 0)`.mapWith(Number),
      })
      .from(clubSessions)
      .where(eq(clubSessions.clubId, clubId));
    const [paid] = await tx
      .select({
        cents: sql<number>`coalesce(sum(${jackpotPayouts.cents}), 0)`.mapWith(Number),
      })
      .from(jackpotPayouts)
      .where(eq(jackpotPayouts.clubId, clubId));
    const checked = payoutCents(body.amount, remainingJackpotCents(pot?.contributed ?? 0, paid?.cents ?? 0));
    if ("error" in checked) throw new JackpotInputError(checked.error);
    const [player] = await tx
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.clubId, clubId), eq(players.nameKey, key)))
      .limit(1);
    if (!player) throw new JackpotInputError("That person is not on this club's roster.");
    await tx.insert(jackpotPayouts).values({ clubId, playerId: player.id, cents: checked.cents, paidBy });
  });
  return clubJackpot(clubId);
}

/** Deletes a hand-entered or imported night. Nights from the live ledger are removed there instead. */
export async function deleteNight(clubId: number, id: number): Promise<"deleted" | "missing" | "live"> {
  const [night] = await db
    .select({ source: clubSessions.source })
    .from(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, id)))
    .limit(1);
  if (!night) return "missing";
  if (night.source === "live") return "live";
  await db.delete(clubSessions).where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, id)));
  return "deleted";
}

/**
 * Records what to do with the open ledger's gap, applied when it closes. Returns the gap it was chosen for,
 * or a reason it can't be used (no open ledger, or a choice that doesn't fit the gap).
 */
export async function setLedgerResolution(
  clubId: number,
  resolution: BalanceResolution,
  actor: LedgerActor,
): Promise<{ ok: true; direction: "balanced" | "over" | "under"; cents: number } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ key: liveSessions.sessionKey, hostName: liveSessions.hostName, startedBy: liveSessions.startedBy })
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), inArray(liveSessions.status, ["open", "finalizing"])))
      .orderBy(desc(liveSessions.startedAt))
      .limit(1)
      .for("update");
    if (!session) return { ok: false as const, error: "There is no open ledger to balance." };
    if (!canManageNight(actor, hostOf(session))) {
      throw new LedgerPermissionError("Only the host or an admin can choose how this night balances.");
    }

    const events = await tx
      .select({ name: liveActivityEvents.memberName, action: liveActivityEvents.action, cents: liveActivityEvents.amountCents, deletedAt: liveActivityEvents.deletedAt })
      .from(liveActivityEvents)
      .where(eq(liveActivityEvents.sessionKey, session.key));
    const byName = new Map<string, NightPlayer>();
    for (const event of events) {
      if (event.deletedAt) continue;
      const key = normalizeNameKey(event.name);
      const entry = byName.get(key) ?? { name: event.name, buyInCents: 0, cashOutCents: 0 };
      if (event.action === "buy_in") entry.buyInCents += event.cents;
      else if (event.action === "cash_out") entry.cashOutCents += event.cents;
      byName.set(key, entry);
    }
    const nightPlayers = [...byName.values()];
    const problem = checkResolution(nightPlayers, resolution);
    if (problem) return { ok: false as const, error: problem };
    await tx.update(liveSessions).set({ balanceResolution: resolution }).where(eq(liveSessions.sessionKey, session.key));
    return { ok: true as const, ...gapOf(nightPlayers) };
  });
}
