import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { clubSessions, db, liveSessions, nightSettlements, normalizeNameKey, players, sessionResults } from "@workspace/db";
import { canSettle, hostOf, LedgerPermissionError, type LedgerActor } from "./ledger-permissions";
import { syncClosedLiveSessions } from "./club-sessions";
import { mineUnsettled, nightState, settleLines, type NightSettlementState, type SettleLine, type SettledMark } from "./settle-up";

type TrackedNight = {
  nightId: number;
  date: string;
  hostName: string;
  bank: string | null;
  lines: SettleLine[];
};

export type NightSettlement = {
  nightId: number;
  date: string;
  hostName: string;
  bankName: string | null;
  /** Whether the viewer may tick players off: the host, the bank or an admin. */
  canSettle: boolean;
  state: NightSettlementState;
  lines: SettleLine[];
};

/**
 * Nights that came from a live ledger started with settle-up on. Older nights, imports and hand-entered
 * nights are history, so nobody is asked to settle them.
 */
async function loadTrackedNights(clubId: number, onlyNightId?: number): Promise<TrackedNight[]> {
  await syncClosedLiveSessions(clubId);
  const nights = await db
    .select({
      id: clubSessions.id,
      date: clubSessions.sessionDate,
      hostName: liveSessions.hostName,
      startedBy: liveSessions.startedBy,
      bank: liveSessions.bankName,
    })
    .from(clubSessions)
    .innerJoin(liveSessions, and(eq(liveSessions.sessionKey, clubSessions.liveSessionKey), eq(liveSessions.clubId, clubSessions.clubId)))
    .where(
      and(
        eq(clubSessions.clubId, clubId),
        eq(liveSessions.settleUp, true),
        onlyNightId === undefined ? undefined : eq(clubSessions.id, onlyNightId),
      ),
    )
    .orderBy(asc(clubSessions.sessionDate), asc(clubSessions.id));
  if (nights.length === 0) return [];

  const ids = nights.map((night) => night.id);
  const [results, marks] = await Promise.all([
    db
      .select({
        sessionId: sessionResults.sessionId,
        playerId: sessionResults.playerId,
        name: players.displayName,
        buyIn: sessionResults.buyInCents,
        cashOut: sessionResults.cashOutCents,
      })
      .from(sessionResults)
      .innerJoin(players, and(eq(players.id, sessionResults.playerId), eq(players.clubId, clubId)))
      .where(inArray(sessionResults.sessionId, ids)),
    db
      .select({
        sessionId: nightSettlements.clubSessionId,
        playerId: nightSettlements.playerId,
        settledAt: nightSettlements.settledAt,
        settledBy: nightSettlements.settledBy,
      })
      .from(nightSettlements)
      .where(and(eq(nightSettlements.clubId, clubId), inArray(nightSettlements.clubSessionId, ids))),
  ]);

  return nights.map((night) => {
    const marked = new Map<number, SettledMark>();
    for (const mark of marks) {
      if (mark.sessionId === night.id) marked.set(mark.playerId, { settledAt: mark.settledAt, settledBy: mark.settledBy });
    }
    const rows = results
      .filter((row) => row.sessionId === night.id)
      .map((row) => ({ playerId: row.playerId, name: row.name, netCents: row.cashOut - row.buyIn }));
    return {
      nightId: night.id,
      date: night.date,
      hostName: hostOf(night),
      bank: night.bank,
      lines: settleLines(rows, marked),
    };
  });
}

/** The position of each night in the Games list: nights are numbered by date, then by when they were recorded. */
async function nightNumbers(clubId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ id: clubSessions.id })
    .from(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), sql`EXISTS (SELECT 1 FROM ${sessionResults} WHERE ${sessionResults.sessionId} = ${clubSessions.id})`))
    .orderBy(asc(clubSessions.sessionDate), asc(clubSessions.id));
  return new Map(rows.map((row, index) => [row.id, index + 1]));
}

/** What the viewer owes and is owed, plus how settled each tracked night is (for the Games list). */
export async function loadSettleUp(clubId: number, viewerName: string) {
  const [tracked, numbers] = await Promise.all([loadTrackedNights(clubId), nightNumbers(clubId)]);
  const owed = mineUnsettled(tracked.map((night) => ({ nightId: night.nightId, date: night.date, bank: night.bank, lines: night.lines })), viewerName);
  const withNumber = <T extends { nightId: number }>(entries: T[]) => entries.map((entry) => ({ ...entry, sessionNumber: numbers.get(entry.nightId) ?? null }));
  const mine = { ...owed, owe: withNumber(owed.owe), owed: withNumber(owed.owed) };
  const nights = tracked
    .map((night) => {
      const state = nightState(night.lines);
      return {
        nightId: night.nightId,
        sessionNumber: numbers.get(night.nightId) ?? null,
        date: night.date,
        state,
        unsettled: night.lines.filter((line) => !line.settled).length,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.nightId - a.nightId);
  return { mine, nights };
}

function present(night: TrackedNight, actor: LedgerActor): NightSettlement {
  return {
    nightId: night.nightId,
    date: night.date,
    hostName: night.hostName,
    bankName: night.bank,
    canSettle: canSettle(actor, night.hostName, night.bank),
    state: nightState(night.lines),
    lines: night.lines,
  };
}

/** One night's settle list, or null when the night does not exist in this club or is not tracked. */
export async function getNightSettlement(clubId: number, nightId: number, actor: LedgerActor): Promise<NightSettlement | null> {
  const [night] = await loadTrackedNights(clubId, nightId);
  return night ? present(night, actor) : null;
}

export type SettleChange = { name: string; settled: boolean } | { all: true; settled: boolean };

/** Ticks or unticks one player (or everyone) for a night. The host, the bank or an admin only. */
export async function changeSettled(clubId: number, nightId: number, actor: LedgerActor, change: SettleChange): Promise<NightSettlement | null> {
  const [night] = await loadTrackedNights(clubId, nightId);
  if (!night) return null;
  if (!canSettle(actor, night.hostName, night.bank)) {
    throw new LedgerPermissionError("Only the host, the bank or an admin can tick people off.");
  }
  const targets = "all" in change
    ? night.lines.filter((line) => line.netCents !== 0)
    : night.lines.filter((line) => line.netCents !== 0 && normalizeNameKey(line.name) === normalizeNameKey(change.name));
  if (targets.length === 0 && !("all" in change)) throw new Error("That person has nothing to settle on this night.");

  const playerIds = targets.map((line) => line.playerId);
  if (playerIds.length > 0) {
    if (change.settled) {
      await db
        .insert(nightSettlements)
        .values(playerIds.map((playerId) => ({ clubId, clubSessionId: nightId, playerId, settledBy: actor.name })))
        .onConflictDoNothing({ target: [nightSettlements.clubSessionId, nightSettlements.playerId] });
    } else {
      await db
        .delete(nightSettlements)
        .where(and(eq(nightSettlements.clubId, clubId), eq(nightSettlements.clubSessionId, nightId), inArray(nightSettlements.playerId, playerIds)));
    }
  }
  const [updated] = await loadTrackedNights(clubId, nightId);
  return updated ? present(updated, actor) : null;
}
