import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  clubSessions,
  clubTournaments,
  db,
  jackpotDeposits,
  jackpotPayouts,
  liveActivityEventComments,
  liveActivityEvents,
  liveSessions,
  nightEditLog,
  nightSettlements,
  normalizeNameKey,
  players,
  sessionResults,
} from "@workspace/db";
import { buildClubDashboard, type NightInput } from "./club-dashboard";
import { nightFingerprint, parseMoney, type ParsedNight } from "./import-parse";
import { loadTournamentEvents } from "./club-tournaments";
import { recordedSessionNumbers } from "./night-settlement";
import { adjustedRemainingCents, checkResolution, gapOf, parseResolution, resolveBalance, type BalanceResolution } from "./night-balance";
import { payoutCents, remainingJackpotCents } from "./jackpot";
import { canManageNight, hostOf, LedgerPermissionError, type LedgerActor } from "./ledger-permissions";
import { liveLedgerSessionDate } from "./live-ledger-utils";
import type { JackpotPayoutExport } from "./export-csv";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

const toCents = (dollars: number) => Math.round(dollars * 100);
const toDollars = (cents: number) => cents / 100;
const tidy = (name: string) => name.trim().replace(/\s+/g, " ");

type NightPlayer = { name: string; buyInCents: number; cashOutCents: number; adjustmentCents?: number; adjustmentNote?: string | null };

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
  notes?: string | null;
  bankName?: string | null;
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
      existing.adjustmentCents = (existing.adjustmentCents ?? 0) + (player.adjustmentCents ?? 0);
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
      notes: night.notes ?? null,
      bankName: night.bankName ?? null,
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
      adjustmentCents: player.adjustmentCents ?? 0,
      adjustmentNote: player.adjustmentNote ?? null,
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

async function loadNights(clubId: number): Promise<Array<NightInput & { id: number; jackpot: number }>> {
  const rows = await db
    .select({
      id: clubSessions.id,
      date: clubSessions.sessionDate,
      jackpotCents: clubSessions.jackpotCents,
      name: players.displayName,
      buyInCents: sessionResults.buyInCents,
      cashOutCents: sessionResults.cashOutCents,
    })
    .from(clubSessions)
    .innerJoin(sessionResults, eq(sessionResults.sessionId, clubSessions.id))
    .innerJoin(players, and(eq(players.id, sessionResults.playerId), eq(players.clubId, clubId)))
    .where(eq(clubSessions.clubId, clubId))
    .orderBy(asc(clubSessions.sessionDate), asc(clubSessions.id), asc(sessionResults.id));

  const nights = new Map<number, NightInput & { id: number; jackpot: number }>();
  for (const row of rows) {
    const night = nights.get(row.id) ?? { id: row.id, date: row.date, players: [], jackpot: toDollars(row.jackpotCents) };
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

/** Every recorded night, oldest first, with the surplus that went into the jackpot. */
export async function loadNightsForExport(clubId: number): Promise<Array<NightInput & { jackpot: number }>> {
  await syncClosedLiveSessions(clubId);
  return (await loadNights(clubId)).map(({ date, players, jackpot }) => ({ date, players, jackpot }));
}

/** Payouts out of the jackpot, oldest first. The date is the club's calendar day. */
export async function loadJackpotPayoutsForExport(clubId: number, timeZone: string): Promise<JackpotPayoutExport[]> {
  const rows = await db
    .select({
      name: players.displayName,
      cents: jackpotPayouts.cents,
      at: jackpotPayouts.paidAt,
    })
    .from(jackpotPayouts)
    .innerJoin(players, and(eq(players.id, jackpotPayouts.playerId), eq(players.clubId, clubId)))
    .where(eq(jackpotPayouts.clubId, clubId))
    .orderBy(asc(jackpotPayouts.paidAt), asc(jackpotPayouts.id));
  return rows
    .filter((row) => row.cents > 0)
    .map((row) => ({ date: liveLedgerSessionDate(row.at, timeZone), name: row.name, amount: toDollars(row.cents) }));
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

export const MAX_NIGHT_NOTE = 2000;

/** Tidies a night note: trimmed, bounded, and null when empty. */
export function cleanNightNote(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > MAX_NIGHT_NOTE) return undefined;
  return text || null;
}

export type ManualNightResult = { id: number; players: number; jackpotCents: number; deductions: Array<{ name: string; cents: number }> };

/**
 * Records a finished night straight from notes: its date, players, an optional note and how the money
 * balances. Players may carry adjustments (a signed correction to what they owe or are owed) and the night a
 * jackpot figure; together they must make the night add up, or it is refused, so a night that does not
 * balance is never recorded. The older "resolution" (take amounts off cash-outs, or send a surplus to the
 * jackpot) is still accepted.
 */
export async function recordManualNight(
  clubId: number,
  input: {
    date: string;
    players: NightPlayer[];
    notes: string | null;
    resolution: BalanceResolution | null;
    createdBy: string;
    jackpotCents?: number;
    bankName?: string | null;
  },
): Promise<ManualNightResult | { error: string }> {
  let nightPlayers = input.players;
  let jackpotCents = input.jackpotCents ?? 0;
  let deductions: Array<{ name: string; cents: number }> = [];
  if (input.resolution && input.resolution.mode !== "none") {
    const problem = checkResolution(input.players, input.resolution);
    if (problem) return { error: problem };
    const outcome = resolveBalance(input.players, input.resolution);
    nightPlayers = outcome.players;
    jackpotCents += outcome.jackpotCents;
    deductions = outcome.deductions;
  }
  if (adjustedRemainingCents(nightPlayers, jackpotCents) !== 0) {
    return { error: "The buy-ins and cash-outs don't match. Add adjustments or a jackpot amount until the night balances." };
  }
  const bankName = input.bankName ? await rosterName(clubId, input.bankName) : null;
  if (input.bankName && !bankName) return { error: "The bank has to be a player in this club." };
  const id = await db.transaction((tx) =>
    recordNight(tx, {
      clubId,
      date: input.date,
      source: "manual",
      createdBy: input.createdBy,
      jackpotCents,
      notes: input.notes,
      bankName,
      players: nightPlayers,
    }),
  );
  if (id === null) return { error: "Add at least one player." };
  return { id, players: nightPlayers.length, jackpotCents, deductions };
}

/** The roster spelling of a player's name, or null when the club has no such player. */
export async function rosterName(clubId: number, name: string): Promise<string | null> {
  const key = normalizeNameKey(name);
  if (!key) return null;
  const [row] = await db
    .select({ name: players.displayName })
    .from(players)
    .where(and(eq(players.clubId, clubId), eq(players.nameKey, key)))
    .limit(1);
  return row?.name ?? null;
}

/** Sets or clears a night's note. False when the night isn't this club's. */
export async function setNightNote(clubId: number, id: number, note: string | null): Promise<boolean> {
  const rows = await db
    .update(clubSessions)
    .set({ notes: note })
    .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, id)))
    .returning({ id: clubSessions.id });
  return rows.length > 0;
}

/** Every night's note for the club, by night id. Only nights that have one. */
export async function listNightNotes(clubId: number): Promise<Record<number, string>> {
  const rows = await db
    .select({ id: clubSessions.id, notes: clubSessions.notes })
    .from(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), sql`${clubSessions.notes} IS NOT NULL`));
  return Object.fromEntries(rows.map((row) => [row.id, row.notes as string]));
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
      notes: clubSessions.notes,
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
    notes: row.notes,
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

export type JackpotDepositRow = { id: number; amount: number; note: string | null; at: string; by: string };
/** A night that added surplus. The id is only sent to admins, who can edit it. */
export type JackpotNightRow = { id?: number; number: number | null; date: string; amount: number };

export type JackpotView = {
  /** Dollars still in the pot: surplus from nights plus deposits, minus payouts. */
  total: number;
  nights: number;
  payouts: JackpotPayoutRow[];
  deposits: JackpotDepositRow[];
  nightEntries: JackpotNightRow[];
};

/** A payout the club cannot record (bad amount, unknown player, empty pot). */
export class JackpotInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JackpotInputError";
  }
}

/** Everything that went in and out of the pot, in cents. */
async function potTotals(executor: Executor, clubId: number): Promise<{ nightCents: number; depositCents: number; paidCents: number }> {
  const [nights] = await executor
    .select({ cents: sql<number>`coalesce(sum(${clubSessions.jackpotCents}), 0)`.mapWith(Number) })
    .from(clubSessions)
    .where(eq(clubSessions.clubId, clubId));
  const [deposits] = await executor
    .select({ cents: sql<number>`coalesce(sum(${jackpotDeposits.cents}), 0)`.mapWith(Number) })
    .from(jackpotDeposits)
    .where(eq(jackpotDeposits.clubId, clubId));
  const [paid] = await executor
    .select({ cents: sql<number>`coalesce(sum(${jackpotPayouts.cents}), 0)`.mapWith(Number) })
    .from(jackpotPayouts)
    .where(eq(jackpotPayouts.clubId, clubId));
  return { nightCents: nights?.cents ?? 0, depositCents: deposits?.cents ?? 0, paidCents: paid?.cents ?? 0 };
}

const heldCents = (totals: { nightCents: number; depositCents: number; paidCents: number }) =>
  remainingJackpotCents(totals.nightCents + totals.depositCents, totals.paidCents);

/** Runs a change to the pot with the club row locked, so two edits at once can't overdraw it. */
async function withPotLock<T>(clubId: number, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM clubs WHERE id = ${clubId} FOR UPDATE`);
    return work(tx);
  });
}

/** The bad beat jackpot still held, in dollars, with every deposit, payout and night that built it. */
export async function clubJackpot(clubId: number, options: { admin?: boolean } = {}): Promise<JackpotView> {
  await syncClosedLiveSessions(clubId);
  const totals = await potTotals(db, clubId);
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
  const deposits = await db
    .select()
    .from(jackpotDeposits)
    .where(eq(jackpotDeposits.clubId, clubId))
    .orderBy(desc(jackpotDeposits.madeAt), desc(jackpotDeposits.id));
  const withSurplus = await db
    .select({ id: clubSessions.id, date: clubSessions.sessionDate, cents: clubSessions.jackpotCents })
    .from(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), sql`${clubSessions.jackpotCents} > 0`))
    .orderBy(desc(clubSessions.sessionDate), desc(clubSessions.id));
  const numbers = await recordedSessionNumbers(clubId);
  return {
    total: toDollars(heldCents(totals)),
    nights: withSurplus.length,
    payouts: payouts.map((payout) => ({
      id: payout.id,
      name: payout.name,
      amount: toDollars(payout.cents),
      at: payout.at.toISOString(),
      by: payout.by,
    })),
    deposits: deposits.map((row) => ({ id: row.id, amount: toDollars(row.cents), note: row.note, at: row.madeAt.toISOString(), by: row.madeBy })),
    nightEntries: withSurplus.map((night) => ({
      ...(options.admin ? { id: night.id } : {}),
      number: numbers.get(night.id) ?? null,
      date: String(night.date).slice(0, 10),
      amount: toDollars(night.cents),
    })),
  };
}

async function findPlayerId(tx: Executor, clubId: number, rawName: unknown): Promise<number> {
  const name = typeof rawName === "string" ? tidy(rawName) : "";
  const key = normalizeNameKey(name);
  if (!key || name.length > 80) throw new JackpotInputError("Choose a player.");
  const [player] = await tx
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.clubId, clubId), eq(players.nameKey, key)))
    .limit(1);
  if (!player) throw new JackpotInputError("That person is not on this club's roster.");
  return player.id;
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
  options: { admin?: boolean } = {},
): Promise<JackpotView> {
  await syncClosedLiveSessions(clubId);
  await withPotLock(clubId, async (tx) => {
    const playerId = await findPlayerId(tx, clubId, body.name);
    const checked = payoutCents(body.amount, heldCents(await potTotals(tx, clubId)));
    if ("error" in checked) throw new JackpotInputError(checked.error);
    await tx.insert(jackpotPayouts).values({ clubId, playerId, cents: checked.cents, paidBy });
  });
  return clubJackpot(clubId, options);
}

/** Changes the player and amount of a payout. The new amount must fit in the pot with the old one returned. */
export async function updateJackpotPayout(clubId: number, id: number, body: { name?: unknown; amount?: unknown }): Promise<JackpotView> {
  await withPotLock(clubId, async (tx) => {
    const [row] = await tx.select().from(jackpotPayouts).where(and(eq(jackpotPayouts.clubId, clubId), eq(jackpotPayouts.id, id))).limit(1).for("update");
    if (!row) throw new JackpotInputError("That payout no longer exists.");
    const playerId = body.name === undefined ? row.playerId : await findPlayerId(tx, clubId, body.name);
    const checked = body.amount === undefined
      ? { cents: row.cents }
      : payoutCents(body.amount, heldCents(await potTotals(tx, clubId)) + row.cents);
    if ("error" in checked) throw new JackpotInputError(checked.error);
    await tx.update(jackpotPayouts).set({ playerId, cents: checked.cents }).where(eq(jackpotPayouts.id, id));
  });
  return clubJackpot(clubId, { admin: true });
}

/** Removes a payout; the money goes back into the pot. */
export async function deleteJackpotPayout(clubId: number, id: number): Promise<boolean> {
  const rows = await db.delete(jackpotPayouts).where(and(eq(jackpotPayouts.clubId, clubId), eq(jackpotPayouts.id, id))).returning({ id: jackpotPayouts.id });
  return rows.length > 0;
}

/** Adds money to the pot directly. Admin. */
export async function addJackpotDeposit(clubId: number, madeBy: string, body: { amount?: unknown; note?: unknown }): Promise<JackpotView> {
  const dollars = typeof body.amount === "number" ? body.amount : typeof body.amount === "string" ? parseMoney(body.amount) : null;
  const cents = dollars === null ? 0 : Math.round(dollars * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new JackpotInputError("Enter an amount like 5 or 12.50.");
  if (cents > 100_000_00) throw new JackpotInputError("That amount is too large.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;
  await db.insert(jackpotDeposits).values({ clubId, cents, note, madeBy });
  return clubJackpot(clubId, { admin: true });
}

/** Removes a deposit, unless payouts have already spent it. */
export async function deleteJackpotDeposit(clubId: number, id: number): Promise<JackpotView | null> {
  const found = await withPotLock(clubId, async (tx) => {
    const [row] = await tx.select().from(jackpotDeposits).where(and(eq(jackpotDeposits.clubId, clubId), eq(jackpotDeposits.id, id))).limit(1).for("update");
    if (!row) return false;
    if (heldCents(await potTotals(tx, clubId)) - row.cents < 0) throw new JackpotInputError("Payouts have already spent this money. Remove or lower a payout first.");
    await tx.delete(jackpotDeposits).where(eq(jackpotDeposits.id, id));
    return true;
  });
  return found ? clubJackpot(clubId, { admin: true }) : null;
}

/** Sets how much of a night's surplus went into the pot (0 removes it). Refused if payouts would then exceed the pot. */
export async function setNightJackpot(clubId: number, nightId: number, amount: unknown): Promise<JackpotView | null> {
  const dollars = typeof amount === "number" ? amount : typeof amount === "string" ? parseMoney(amount) : null;
  const cents = dollars === null ? -1 : Math.round(dollars * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents > 100_000_00) throw new JackpotInputError("Enter an amount like 5 or 12.50, or 0 to take it out.");
  const found = await withPotLock(clubId, async (tx) => {
    const [night] = await tx.select({ id: clubSessions.id, cents: clubSessions.jackpotCents }).from(clubSessions).where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, nightId))).limit(1).for("update");
    if (!night) return false;
    if (heldCents(await potTotals(tx, clubId)) - night.cents + cents < 0) throw new JackpotInputError("Payouts have already spent that money. Remove or lower a payout first.");
    await tx.update(clubSessions).set({ jackpotCents: cents }).where(eq(clubSessions.id, nightId));
    return true;
  });
  return found ? clubJackpot(clubId, { admin: true }) : null;
}

export type RecordedNightChange = {
  date: string;
  players: NightPlayer[];
  /** What goes into the bad beat jackpot from this night. Omitted keeps the current figure. */
  jackpotCents?: number;
  /** Omitted keeps the note; null clears it. */
  notes?: string | null;
  /** Omitted keeps the bank; null clears it. */
  bankName?: string | null;
  by: string;
};

export type NightUpdateOutcome = "updated" | "missing" | "unbalanced" | "pot" | "bank";

const dollars = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

async function rosterNameIn(executor: Executor, clubId: number, name: string): Promise<string | null> {
  const key = normalizeNameKey(name);
  if (!key) return null;
  const [row] = await executor.select({ name: players.displayName }).from(players).where(and(eq(players.clubId, clubId), eq(players.nameKey, key))).limit(1);
  return row?.name ?? null;
}

/**
 * Replaces the players, date, jackpot, note and bank of a recorded night, and logs what changed. The night
 * must balance (net of adjustments plus jackpot is zero). Changing amounts after anyone was ticked settled is
 * logged as such so the night can be flagged. A night from the live ledger can be corrected here too; reopening
 * it later rebuilds it from the ledger.
 */
export async function updateNight(clubId: number, id: number, change: RecordedNightChange): Promise<NightUpdateOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM clubs WHERE id = ${clubId} FOR UPDATE`);
    const [night] = await tx
      .select({ id: clubSessions.id, date: clubSessions.sessionDate, jackpotCents: clubSessions.jackpotCents, bankName: clubSessions.bankName })
      .from(clubSessions)
      .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, id)))
      .limit(1)
      .for("update");
    if (!night) return "missing";

    const jackpotCents = change.jackpotCents ?? night.jackpotCents;
    if (adjustedRemainingCents(change.players, jackpotCents) !== 0) return "unbalanced";
    if (jackpotCents !== night.jackpotCents && heldCents(await potTotals(tx, clubId)) - night.jackpotCents + jackpotCents < 0) return "pot";
    let bankName = night.bankName;
    if (change.bankName !== undefined) {
      bankName = change.bankName ? await rosterNameIn(tx, clubId, change.bankName) : null;
      if (change.bankName && !bankName) return "bank";
    }

    const before = await tx
      .select({ key: players.nameKey, name: players.displayName, buyIn: sessionResults.buyInCents, cashOut: sessionResults.cashOutCents, adjustment: sessionResults.adjustmentCents })
      .from(sessionResults)
      .innerJoin(players, eq(players.id, sessionResults.playerId))
      .where(eq(sessionResults.sessionId, id));
    const merged = new Map<string, NightPlayer>();
    for (const player of change.players) {
      const key = normalizeNameKey(player.name);
      if (!key) continue;
      const entry = merged.get(key);
      if (entry) {
        entry.buyInCents += player.buyInCents;
        entry.cashOutCents += player.cashOutCents;
        entry.adjustmentCents = (entry.adjustmentCents ?? 0) + (player.adjustmentCents ?? 0);
      } else {
        merged.set(key, { ...player, name: tidy(player.name) });
      }
    }

    await tx
      .update(clubSessions)
      .set({
        sessionDate: change.date,
        jackpotCents,
        bankName,
        ...(change.notes !== undefined ? { notes: change.notes } : {}),
      })
      .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, id)));
    await tx.delete(sessionResults).where(eq(sessionResults.sessionId, id));
    const ids = await ensurePlayers(tx, clubId, [...merged.values()].map((player) => player.name));
    if (merged.size > 0) {
      await tx.insert(sessionResults).values(
        [...merged.entries()].map(([key, player]) => ({
          sessionId: id,
          playerId: ids.get(key)!,
          buyInCents: player.buyInCents,
          cashOutCents: player.cashOutCents,
          adjustmentCents: player.adjustmentCents ?? 0,
          adjustmentNote: player.adjustmentNote ?? null,
        })),
      );
    }

    // What changed, for the log: amounts per player, the date, the jackpot and the bank.
    const was = new Map(before.map((row) => [row.key, row]));
    const notes: string[] = [];
    let amountsChanged = false;
    for (const [key, player] of merged) {
      const old = was.get(key);
      const adj = player.adjustmentCents ?? 0;
      if (!old) {
        notes.push(`added ${player.name}`);
        amountsChanged = true;
      } else if (old.buyIn !== player.buyInCents || old.cashOut !== player.cashOutCents || old.adjustment !== adj) {
        notes.push(`${player.name} ${dollars(old.cashOut - old.buyIn + old.adjustment)} to ${dollars(player.cashOutCents - player.buyInCents + adj)}`);
        amountsChanged = true;
      }
    }
    for (const [key, old] of was) {
      if (!merged.has(key)) {
        notes.push(`removed ${old.name}`);
        amountsChanged = true;
      }
    }
    if (night.date !== change.date) notes.push(`date ${night.date} to ${change.date}`);
    if (jackpotCents !== night.jackpotCents) notes.push(`jackpot ${dollars(night.jackpotCents)} to ${dollars(jackpotCents)}`);
    if ((bankName ?? null) !== (night.bankName ?? null)) notes.push(`bank ${night.bankName ?? "none"} to ${bankName ?? "none"}`);
    if (notes.length > 0) {
      await tx.insert(nightEditLog).values({ clubId, clubSessionId: id, kind: "edit", summary: `Edited: ${notes.join("; ")}.`.slice(0, 1000), by: change.by });
      if (amountsChanged) {
        const [settled] = await tx
          .select({ total: count() })
          .from(nightSettlements)
          .where(and(eq(nightSettlements.clubId, clubId), eq(nightSettlements.clubSessionId, id)));
        if ((settled?.total ?? 0) > 0) {
          await tx.insert(nightEditLog).values({ clubId, clubSessionId: id, kind: "amounts_after_settled", summary: "Amounts were changed after people were ticked settled. Check the ticks.", by: change.by });
        }
      }
    }
    return "updated";
  });
}

/**
 * Deletes one recorded night and the rows that belong to it, in one transaction.
 * Session results and settle-up ticks go with the night. A live-ledger night takes its
 * ledger session with it, so closing is not recorded again. The jackpot is the sum of
 * what nights added minus payouts: a delete that would leave the pot short is refused
 * and nothing is removed.
 */
export async function deleteNight(clubId: number, id: number): Promise<"deleted" | "missing" | "jackpot"> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM clubs WHERE id = ${clubId} FOR UPDATE`);
    const [night] = await tx
      .select({
        id: clubSessions.id,
        liveSessionKey: clubSessions.liveSessionKey,
        jackpotCents: clubSessions.jackpotCents,
      })
      .from(clubSessions)
      .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, id)))
      .limit(1)
      .for("update");
    if (!night) return "missing";

    const after = heldCents(await potTotals(tx, clubId)) - night.jackpotCents;
    if (night.jackpotCents > 0 && after < 0) return "jackpot";

    if (night.liveSessionKey) {
      const [live] = await tx
        .select({ key: liveSessions.sessionKey })
        .from(liveSessions)
        .where(and(
          eq(liveSessions.sessionKey, night.liveSessionKey),
          or(eq(liveSessions.clubId, clubId), isNull(liveSessions.clubId)),
        ))
        .limit(1)
        .for("update");
      if (live) {
        const events = await tx
          .select({ eventId: liveActivityEvents.eventId })
          .from(liveActivityEvents)
          .where(eq(liveActivityEvents.sessionKey, live.key));
        const eventIds = events.map((event) => event.eventId);
        if (eventIds.length > 0) {
          await tx.delete(liveActivityEventComments).where(inArray(liveActivityEventComments.eventId, eventIds));
          await tx.delete(liveActivityEvents).where(inArray(liveActivityEvents.eventId, eventIds));
        }
        await tx.delete(liveSessions).where(eq(liveSessions.sessionKey, live.key));
      }
    }

    await tx.delete(nightSettlements).where(and(eq(nightSettlements.clubId, clubId), eq(nightSettlements.clubSessionId, night.id)));
    await tx.delete(sessionResults).where(eq(sessionResults.sessionId, night.id));
    await tx.delete(clubSessions).where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, night.id)));
    return "deleted";
  });
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
