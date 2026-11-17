import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { clubSessions, db, liveSessions, nightEditLog, nightSettlements, normalizeNameKey, players, sessionResults } from "@workspace/db";
import { canSettle, hostOf, LedgerPermissionError, type LedgerActor } from "./ledger-permissions";
import { syncClosedLiveSessions } from "./club-sessions";
import { mineUnsettled, nightState, settleLines, type NightSettlementState, type SettleLine, type SettledMark } from "./settle-up";

type TrackedNight = {
  nightId: number;
  date: string;
  hostName: string;
  bank: string | null;
  /** Amounts were changed after someone was ticked settled. */
  flagged: boolean;
  lines: SettleLine[];
};

export type NightLogEntry = { kind: string; summary: string; at: string; by: string };

export type NightSettlement = {
  nightId: number;
  date: string;
  hostName: string;
  bankName: string | null;
  /** Whether the viewer may tick players off: the host, the bank or an admin. */
  canSettle: boolean;
  state: NightSettlementState;
  /** Amounts were changed after someone was ticked settled, so the ticks may be stale. */
  flagged: boolean;
  lines: SettleLine[];
  /** Newest first: edits, bank changes and every tick or untick, with who and when. */
  log: NightLogEntry[];
};

/**
 * Every recorded night is tracked: live-closed, hand-entered and imported. The bank is the night's own, or
 * the one chosen on the live ledger. A player's net is cash-out minus buy-in plus any adjustment.
 */
async function loadTrackedNights(clubId: number, onlyNightId?: number): Promise<TrackedNight[]> {
  await syncClosedLiveSessions(clubId);
  const nights = await db
    .select({
      id: clubSessions.id,
      date: clubSessions.sessionDate,
      hostName: liveSessions.hostName,
      startedBy: liveSessions.startedBy,
      liveBank: liveSessions.bankName,
      bank: clubSessions.bankName,
    })
    .from(clubSessions)
    .leftJoin(liveSessions, and(eq(liveSessions.sessionKey, clubSessions.liveSessionKey), eq(liveSessions.clubId, clubSessions.clubId)))
    .where(
      and(
        eq(clubSessions.clubId, clubId),
        onlyNightId === undefined ? undefined : eq(clubSessions.id, onlyNightId),
      ),
    )
    .orderBy(asc(clubSessions.sessionDate), asc(clubSessions.id));
  if (nights.length === 0) return [];

  const ids = nights.map((night) => night.id);
  const [results, marks, flags] = await Promise.all([
    db
      .select({
        sessionId: sessionResults.sessionId,
        playerId: sessionResults.playerId,
        name: players.displayName,
        buyIn: sessionResults.buyInCents,
        cashOut: sessionResults.cashOutCents,
        adjustment: sessionResults.adjustmentCents,
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
    db
      .select({ sessionId: nightEditLog.clubSessionId })
      .from(nightEditLog)
      .where(and(eq(nightEditLog.clubId, clubId), eq(nightEditLog.kind, "amounts_after_settled"), inArray(nightEditLog.clubSessionId, ids))),
  ]);
  const flagged = new Set(flags.map((row) => row.sessionId));

  return nights.map((night) => {
    const marked = new Map<number, SettledMark>();
    for (const mark of marks) {
      if (mark.sessionId === night.id) marked.set(mark.playerId, { settledAt: mark.settledAt, settledBy: mark.settledBy });
    }
    const rows = results
      .filter((row) => row.sessionId === night.id)
      .map((row) => ({ playerId: row.playerId, name: row.name, netCents: row.cashOut - row.buyIn + row.adjustment }));
    return {
      nightId: night.id,
      date: night.date,
      hostName: night.startedBy ? hostOf({ hostName: night.hostName, startedBy: night.startedBy }) : "",
      bank: night.bank ?? night.liveBank ?? null,
      flagged: flagged.has(night.id),
      lines: settleLines(rows, marked),
    };
  });
}

/** The position of each night in the Games list: nights are numbered by date, then by when they were recorded. */
export async function recordedSessionNumbers(clubId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ id: clubSessions.id })
    .from(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), sql`EXISTS (SELECT 1 FROM ${sessionResults} WHERE ${sessionResults.sessionId} = ${clubSessions.id})`))
    .orderBy(asc(clubSessions.sessionDate), asc(clubSessions.id));
  return new Map(rows.map((row, index) => [row.id, index + 1]));
}

/** What the viewer owes and is owed, plus how settled each tracked night is (for the Games list). */
export async function loadSettleUp(clubId: number, actor: LedgerActor) {
  const viewerName = actor.name;
  const [tracked, numbers] = await Promise.all([loadTrackedNights(clubId), recordedSessionNumbers(clubId)]);
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
        canEdit: canSettle(actor, night.hostName, night.bank),
        flagged: night.flagged,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.nightId - a.nightId);
  return { mine, nights };
}

async function loadLog(clubId: number, nightId: number): Promise<NightLogEntry[]> {
  const rows = await db
    .select({ kind: nightEditLog.kind, summary: nightEditLog.summary, at: nightEditLog.at, by: nightEditLog.by })
    .from(nightEditLog)
    .where(and(eq(nightEditLog.clubId, clubId), eq(nightEditLog.clubSessionId, nightId)))
    .orderBy(desc(nightEditLog.at), desc(nightEditLog.id))
    .limit(50);
  return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
}

function present(night: TrackedNight, actor: LedgerActor, log: NightLogEntry[]): NightSettlement {
  return {
    nightId: night.nightId,
    date: night.date,
    hostName: night.hostName,
    bankName: night.bank,
    canSettle: canSettle(actor, night.hostName, night.bank),
    state: nightState(night.lines),
    flagged: night.flagged,
    lines: night.lines,
    log,
  };
}

/** One night's settle list, or null when the night does not exist in this club or is not tracked. */
export async function getNightSettlement(clubId: number, nightId: number, actor: LedgerActor): Promise<NightSettlement | null> {
  const [night] = await loadTrackedNights(clubId, nightId);
  return night ? present(night, actor, await loadLog(clubId, nightId)) : null;
}

export type SettleChange = { name: string; settled: boolean } | { all: true; settled: boolean };

/** Ticks or unticks one player (or everyone) for a night, and logs it. The host, the bank or an admin only. */
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
    const names = targets.map((line) => line.name).join(", ").slice(0, 900);
    await db.transaction(async (tx) => {
      if (change.settled) {
        await tx
          .insert(nightSettlements)
          .values(playerIds.map((playerId) => ({ clubId, clubSessionId: nightId, playerId, settledBy: actor.name })))
          .onConflictDoNothing({ target: [nightSettlements.clubSessionId, nightSettlements.playerId] });
      } else {
        await tx
          .delete(nightSettlements)
          .where(and(eq(nightSettlements.clubId, clubId), eq(nightSettlements.clubSessionId, nightId), inArray(nightSettlements.playerId, playerIds)));
      }
      await tx.insert(nightEditLog).values({
        clubId,
        clubSessionId: nightId,
        kind: change.settled ? "settled" : "unsettled",
        summary: `${change.settled ? "Marked settled" : "Marked not settled"}: ${names}.`,
        by: actor.name,
      });
    });
  }
  const [updated] = await loadTrackedNights(clubId, nightId);
  return updated ? present(updated, actor, await loadLog(clubId, nightId)) : null;
}

export class BankError extends Error {}

/** Sets or clears a night's bank (a player on the club's roster). The host, the current bank or an admin. */
export async function changeNightBank(clubId: number, nightId: number, actor: LedgerActor, name: string | null): Promise<NightSettlement | null> {
  const [night] = await loadTrackedNights(clubId, nightId);
  if (!night) return null;
  if (!canSettle(actor, night.hostName, night.bank)) throw new LedgerPermissionError("Only the host, the bank or an admin can change the bank.");
  let bankName: string | null = null;
  if (name) {
    const [row] = await db
      .select({ name: players.displayName })
      .from(players)
      .where(and(eq(players.clubId, clubId), eq(players.nameKey, normalizeNameKey(name))))
      .limit(1);
    if (!row) throw new BankError("The bank has to be a player in this club.");
    bankName = row.name;
  }
  await db.transaction(async (tx) => {
    await tx.update(clubSessions).set({ bankName }).where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, nightId)));
    await tx.insert(nightEditLog).values({ clubId, clubSessionId: nightId, kind: "bank", summary: `Bank changed from ${night.bank ?? "none"} to ${bankName ?? "none"}.`, by: actor.name });
  });
  return getNightSettlement(clubId, nightId, actor);
}

/** What the editor needs to open a night: its figures, bank and whether the viewer may change it. */
export async function loadNightForEdit(clubId: number, nightId: number, actor: LedgerActor) {
  const [night] = await loadTrackedNights(clubId, nightId);
  if (!night) return null;
  const [header] = await db
    .select({ date: clubSessions.sessionDate, source: clubSessions.source, jackpotCents: clubSessions.jackpotCents, notes: clubSessions.notes })
    .from(clubSessions)
    .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.id, nightId)))
    .limit(1);
  if (!header) return null;
  const rows = await db
    .select({
      name: players.displayName,
      buyIn: sessionResults.buyInCents,
      cashOut: sessionResults.cashOutCents,
      adjustment: sessionResults.adjustmentCents,
      note: sessionResults.adjustmentNote,
    })
    .from(sessionResults)
    .innerJoin(players, eq(players.id, sessionResults.playerId))
    .where(eq(sessionResults.sessionId, nightId))
    .orderBy(asc(sessionResults.id));
  return {
    nightId,
    date: header.date,
    source: header.source,
    jackpotCents: header.jackpotCents,
    notes: header.notes,
    bankName: night.bank,
    canEdit: canSettle(actor, night.hostName, night.bank),
    players: rows.map((row) => ({ name: row.name, buyInCents: row.buyIn, cashOutCents: row.cashOut, adjustmentCents: row.adjustment, adjustmentNote: row.note })),
  };
}
