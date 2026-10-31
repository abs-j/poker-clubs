// An admin merges a duplicate or misspelled name into the one they want to keep.
// Every reference moves in one transaction. A night both names played is summed.
// A tournament both played is summed only when the money still balances; otherwise the merge is refused.
import { and, count, eq, inArray, sql, type AnyColumn } from "drizzle-orm";
import {
  authSessions,
  clubSessions,
  clubTournaments,
  db,
  jackpotPayouts,
  liveActivityEvents,
  liveSessions,
  memberAvatars,
  memberUsage,
  memberUsageActivity,
  memberships,
  nightSettlements,
  normalizeNameKey,
  players,
  sessionResults,
  siteVisits,
  tournamentResults,
} from "@workspace/db";
import { normalizeMemberKey } from "./avatar-image.ts";
import { parseResolution } from "./night-balance.ts";
import { combineCash, combinedSettlement, combineTournamentField, type TournamentMoney } from "./merge-players-plan.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

const tidy = (name: string) => name.trim().replace(/\s+/g, " ");
const toDollars = (cents: number) => cents / 100;
const toCents = (dollars: number) => Math.round(dollars * 100);

/** The name, ignoring case and extra spaces, the same way the roster matches people. */
function normalizedEquals(column: AnyColumn, key: string) {
  return sql`lower(regexp_replace(btrim(${column}), ${"\\s+"}, ' ', 'g')) = ${key}`;
}

export class MergeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "MergeError";
  }
}

export type MergeClaim = "none" | "stays" | "moves";
export type MergePicture = "none" | "moves" | "kept";

export type MergePreview = {
  keep: string;
  merge: string;
  /** Always true: there is no undo. */
  irreversible: true;
  /** Recorded nights under the name being removed. */
  nights: number;
  /** Nights where both names played, so the two results are added together. */
  nightsCombined: number;
  ledgerEntries: number;
  tournaments: number;
  tournamentsCombined: number;
  /** Settle-up ticks on the name being removed. */
  settlements: number;
  /** Ticks that follow the name, because only that name played the night. */
  settlementsMoved: number;
  /** Nights both names played that already had a tick. */
  settlementsCombined: number;
  /** Ticks dropped because only one of the two names was settled. */
  settlementsCleared: number;
  jackpotPayouts: number;
  hostNights: number;
  bankNights: number;
  claim: MergeClaim;
  picture: MergePicture;
};

export type MergeResult = MergePreview & { merged: true };

type PlayerRow = { id: number; displayName: string; nameKey: string; userId: string | null };

type CashCollision = {
  sessionId: number;
  keepResultId: number;
  mergeResultId: number;
  buyInCents: number;
  cashOutCents: number;
};

type Plan = {
  preview: MergePreview;
  clubId: number;
  keep: PlayerRow;
  merge: PlayerRow;
  keepKey: string;
  mergeKey: string;
  userId: string | null;
  moveMembershipId: number | null;
  cashCollisions: CashCollision[];
  cashMoveIds: number[];
  settlementDeleteIds: number[];
  settlementMoveIds: number[];
  tournamentCombineIds: number[];
  tournamentMoveIds: number[];
};

function isUniqueViolation(error: unknown): boolean {
  const wrapped = error as { code?: string; cause?: { code?: string } };
  return (wrapped.cause?.code ?? wrapped.code) === "23505";
}

async function loadPlayers(tx: Executor, clubId: number, keepKey: string, mergeKey: string, lock: boolean): Promise<PlayerRow[]> {
  const query = tx
    .select({ id: players.id, displayName: players.displayName, nameKey: players.nameKey, userId: players.userId })
    .from(players)
    .where(and(eq(players.clubId, clubId), inArray(players.nameKey, [keepKey, mergeKey])));
  return lock ? query.for("update") : query;
}

async function readPlan(tx: Executor, clubId: number, keepName: string, mergeName: string, lock: boolean): Promise<Plan> {
  const keepInput = tidy(keepName);
  const mergeInput = tidy(mergeName);
  if (!keepInput || !mergeInput) throw new MergeError("Enter both names.", 400);
  if (keepInput.length > 80 || mergeInput.length > 80) throw new MergeError("Names must be 80 characters or fewer.", 400);
  const keepKey = normalizeNameKey(keepInput);
  const mergeKey = normalizeNameKey(mergeInput);
  if (!keepKey || !mergeKey || keepKey === mergeKey) throw new MergeError("Choose two different names.", 400);

  if (lock) await tx.execute(sql`SELECT id FROM clubs WHERE id = ${clubId} FOR UPDATE`);
  const found = await loadPlayers(tx, clubId, keepKey, mergeKey, lock);
  const keep = found.find((player) => player.nameKey === keepKey);
  const merge = found.find((player) => player.nameKey === mergeKey);
  if (!keep) throw new MergeError(`No player named "${keepInput}" in this club.`, 404);
  if (!merge) throw new MergeError(`No player named "${mergeInput}" in this club.`, 404);
  if (keep.id === merge.id) throw new MergeError("Choose two different names.", 400);

  const memberQuery = tx
    .select({ id: memberships.id, playerId: memberships.playerId, userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), inArray(memberships.playerId, [keep.id, merge.id])));
  const memberRows = lock ? await memberQuery.for("update") : await memberQuery;
  const accounts = new Set([keep.userId, merge.userId, ...memberRows.map((row) => row.userId)].filter((id): id is string => Boolean(id)));
  if (memberRows.length > 1 || accounts.size > 1) {
    throw new MergeError("Both names are linked to accounts. Remove one person from the club before merging these names.", 409);
  }
  const moveMembershipId = memberRows.find((row) => row.playerId === merge.id)?.id ?? null;
  const userId = [...accounts][0] ?? null;
  const claim: MergeClaim = userId && merge.userId === userId && keep.userId !== userId ? "moves" : userId ? "stays" : "none";

  const mergeCash = await tx
    .select({
      id: sessionResults.id,
      sessionId: sessionResults.sessionId,
      buyInCents: sessionResults.buyInCents,
      cashOutCents: sessionResults.cashOutCents,
    })
    .from(sessionResults)
    .innerJoin(clubSessions, eq(sessionResults.sessionId, clubSessions.id))
    .where(and(eq(sessionResults.playerId, merge.id), eq(clubSessions.clubId, clubId)));
  const keepCash = await tx
    .select({
      id: sessionResults.id,
      sessionId: sessionResults.sessionId,
      buyInCents: sessionResults.buyInCents,
      cashOutCents: sessionResults.cashOutCents,
    })
    .from(sessionResults)
    .innerJoin(clubSessions, eq(sessionResults.sessionId, clubSessions.id))
    .where(and(eq(sessionResults.playerId, keep.id), eq(clubSessions.clubId, clubId)));
  const keepBySession = new Map(keepCash.map((row) => [row.sessionId, row]));
  const cashCollisions: CashCollision[] = [];
  const cashMoveIds: number[] = [];
  for (const row of mergeCash) {
    const other = keepBySession.get(row.sessionId);
    if (!other) {
      cashMoveIds.push(row.id);
      continue;
    }
    const summed = combineCash(other, row);
    cashCollisions.push({
      sessionId: row.sessionId,
      keepResultId: other.id,
      mergeResultId: row.id,
      buyInCents: summed.buyInCents,
      cashOutCents: summed.cashOutCents,
    });
  }
  const collisionSessions = new Set(cashCollisions.map((row) => row.sessionId));

  const marks = await tx
    .select({ id: nightSettlements.id, sessionId: nightSettlements.clubSessionId, playerId: nightSettlements.playerId })
    .from(nightSettlements)
    .where(and(eq(nightSettlements.clubId, clubId), inArray(nightSettlements.playerId, [keep.id, merge.id])));
  const settlementDeleteIds: number[] = [];
  const settlementMoveIds: number[] = [];
  let settlementsCombined = 0;
  let settlementsCleared = 0;
  const sessionsWithMarks = new Set(marks.map((mark) => mark.sessionId));
  for (const sessionId of sessionsWithMarks) {
    const onNight = marks.filter((mark) => mark.sessionId === sessionId);
    const keepMark = onNight.find((mark) => mark.playerId === keep.id);
    const mergeMark = onNight.find((mark) => mark.playerId === merge.id);
    if (collisionSessions.has(sessionId)) {
      if (keepMark || mergeMark) settlementsCombined += 1;
      if (combinedSettlement(Boolean(keepMark), Boolean(mergeMark)) === "keep" && mergeMark) {
        settlementDeleteIds.push(mergeMark.id);
      } else {
        if (keepMark || mergeMark) settlementsCleared += 1;
        for (const mark of onNight) settlementDeleteIds.push(mark.id);
      }
    } else if (mergeMark) {
      settlementMoveIds.push(mergeMark.id);
    }
  }

  const mergeTournaments = await tx
    .select({ id: tournamentResults.tournamentId })
    .from(tournamentResults)
    .innerJoin(clubTournaments, eq(tournamentResults.tournamentId, clubTournaments.id))
    .where(and(eq(tournamentResults.playerId, merge.id), eq(clubTournaments.clubId, clubId)));
  const keepTournaments = await tx
    .select({ id: tournamentResults.tournamentId })
    .from(tournamentResults)
    .innerJoin(clubTournaments, eq(tournamentResults.tournamentId, clubTournaments.id))
    .where(and(eq(tournamentResults.playerId, keep.id), eq(clubTournaments.clubId, clubId)));
  const keepTournamentIds = new Set(keepTournaments.map((row) => row.id));
  const tournamentCombineIds = mergeTournaments.filter((row) => keepTournamentIds.has(row.id)).map((row) => row.id);
  const tournamentMoveIds = mergeTournaments.filter((row) => !keepTournamentIds.has(row.id)).map((row) => row.id);
  // Refuse now, before any write, when a shared tournament cannot be added together.
  for (const tournamentId of tournamentCombineIds) await loadTournamentCombine(tx, clubId, tournamentId, keepKey, mergeKey);

  const [ledger] = await tx
    .select({ total: count() })
    .from(liveActivityEvents)
    .where(and(eq(liveActivityEvents.clubId, clubId), normalizedEquals(liveActivityEvents.memberName, mergeKey)));
  const [payouts] = await tx
    .select({ total: count() })
    .from(jackpotPayouts)
    .where(and(eq(jackpotPayouts.clubId, clubId), eq(jackpotPayouts.playerId, merge.id)));
  const [hosts] = await tx
    .select({ total: count() })
    .from(liveSessions)
    .where(and(
      eq(liveSessions.clubId, clubId),
      sql`(${normalizedEquals(liveSessions.hostName, mergeKey)} OR ((${liveSessions.hostName} IS NULL OR btrim(${liveSessions.hostName}) = '') AND ${normalizedEquals(liveSessions.startedBy, mergeKey)}))`,
    ));
  const [banks] = await tx
    .select({ total: count() })
    .from(liveSessions)
    .where(and(eq(liveSessions.clubId, clubId), normalizedEquals(liveSessions.bankName, mergeKey)));

  const pictures = await tx
    .select({ memberKey: memberAvatars.memberKey })
    .from(memberAvatars)
    .where(eq(memberAvatars.clubId, clubId));
  const keepPicture = pictures.some((row) => row.memberKey === normalizeMemberKey(keep.displayName));
  const mergePicture = pictures.some((row) => row.memberKey === normalizeMemberKey(merge.displayName));
  const picture: MergePicture = !mergePicture ? "none" : keepPicture ? "kept" : "moves";

  const mergeSettlements = marks.filter((mark) => mark.playerId === merge.id).length;
  return {
    preview: {
      keep: keep.displayName,
      merge: merge.displayName,
      irreversible: true,
      nights: mergeCash.length,
      nightsCombined: cashCollisions.length,
      ledgerEntries: Number(ledger?.total ?? 0),
      tournaments: mergeTournaments.length,
      tournamentsCombined: tournamentCombineIds.length,
      settlements: mergeSettlements,
      settlementsMoved: settlementMoveIds.length,
      settlementsCombined,
      settlementsCleared,
      jackpotPayouts: Number(payouts?.total ?? 0),
      hostNights: Number(hosts?.total ?? 0),
      bankNights: Number(banks?.total ?? 0),
      claim,
      picture,
    },
    clubId,
    keep,
    merge,
    keepKey,
    mergeKey,
    userId,
    moveMembershipId,
    cashCollisions,
    cashMoveIds,
    settlementDeleteIds,
    settlementMoveIds,
    tournamentCombineIds,
    tournamentMoveIds,
  };
}

async function renameNames(tx: Tx, plan: Plan) {
  const { clubId, mergeKey } = plan;
  const keepName = plan.keep.displayName;
  const whereName = (column: AnyColumn) => and(eq(liveActivityEvents.clubId, clubId), normalizedEquals(column, mergeKey));

  await tx.update(liveActivityEvents).set({ memberName: keepName }).where(whereName(liveActivityEvents.memberName));
  await tx.update(liveActivityEvents).set({ createdBy: keepName }).where(whereName(liveActivityEvents.createdBy));
  await tx.update(liveActivityEvents).set({ updatedBy: keepName }).where(whereName(liveActivityEvents.updatedBy));
  await tx.update(liveActivityEvents).set({ deletedBy: keepName }).where(whereName(liveActivityEvents.deletedBy));

  await tx.execute(sql`
    UPDATE live_activity_event_comments AS c
    SET created_by = ${keepName}
    FROM live_activity_events AS e
    WHERE c.event_id = e.event_id
      AND e.club_id = ${clubId}
      AND lower(regexp_replace(btrim(c.created_by), ${"\\s+"}, ' ', 'g')) = ${mergeKey}
  `);

  const sessionName = (column: AnyColumn) => and(eq(liveSessions.clubId, clubId), normalizedEquals(column, mergeKey));
  await tx.update(liveSessions).set({ hostName: keepName }).where(sessionName(liveSessions.hostName));
  await tx.update(liveSessions).set({ bankName: keepName }).where(sessionName(liveSessions.bankName));
  await tx.update(liveSessions).set({ startedBy: keepName }).where(sessionName(liveSessions.startedBy));
  await tx.update(liveSessions).set({ endedBy: keepName }).where(sessionName(liveSessions.endedBy));

  const sessions = await tx
    .select({ id: liveSessions.id, resolution: liveSessions.balanceResolution })
    .from(liveSessions)
    .where(eq(liveSessions.clubId, clubId));
  for (const session of sessions) {
    const resolution = parseResolution(session.resolution);
    if (resolution?.mode === "player" && normalizeNameKey(resolution.name) === mergeKey) {
      await tx
        .update(liveSessions)
        .set({ balanceResolution: { mode: "player", name: keepName } })
        .where(and(eq(liveSessions.id, session.id), eq(liveSessions.clubId, clubId)));
    }
  }

  await tx.update(clubSessions).set({ createdBy: keepName }).where(and(eq(clubSessions.clubId, clubId), normalizedEquals(clubSessions.createdBy, mergeKey)));
  await tx.update(clubTournaments).set({ createdBy: keepName }).where(and(eq(clubTournaments.clubId, clubId), normalizedEquals(clubTournaments.createdBy, mergeKey)));
  await tx.update(nightSettlements).set({ settledBy: keepName }).where(and(eq(nightSettlements.clubId, clubId), normalizedEquals(nightSettlements.settledBy, mergeKey)));
  await tx.update(jackpotPayouts).set({ paidBy: keepName }).where(and(eq(jackpotPayouts.clubId, clubId), normalizedEquals(jackpotPayouts.paidBy, mergeKey)));
  await tx.update(siteVisits).set({ memberName: keepName }).where(and(eq(siteVisits.clubId, clubId), normalizedEquals(siteVisits.memberName, mergeKey)));
  await tx.update(authSessions).set({ memberName: keepName }).where(and(eq(authSessions.clubId, clubId), normalizedEquals(authSessions.memberName, mergeKey)));
}

async function mergeUsage(tx: Tx, plan: Plan) {
  const { clubId, keepKey, mergeKey } = plan;
  const keepName = plan.keep.displayName;
  const rows = await tx.select().from(memberUsage).where(eq(memberUsage.clubId, clubId));
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = normalizeNameKey(row.memberName);
    if (key !== keepKey && key !== mergeKey) continue;
    const list = groups.get(row.section) ?? [];
    list.push(row);
    groups.set(row.section, list);
  }
  for (const [section, list] of groups) {
    if (list.length === 1 && list[0].memberName === keepName) continue;
    const lastActiveAt = list.reduce((latest, row) => (row.lastActiveAt > latest ? row.lastActiveAt : latest), list[0].lastActiveAt);
    await tx.delete(memberUsage).where(and(eq(memberUsage.clubId, clubId), inArray(memberUsage.id, list.map((row) => row.id))));
    await tx.insert(memberUsage).values({
      clubId,
      memberName: keepName,
      section,
      pageViews: list.reduce((sum, row) => sum + row.pageViews, 0),
      activeSeconds: list.reduce((sum, row) => sum + row.activeSeconds, 0),
      lastActiveAt,
    });
  }

  const activity = await tx.select().from(memberUsageActivity).where(eq(memberUsageActivity.clubId, clubId));
  const buckets = new Map<string, typeof activity>();
  for (const row of activity) {
    const key = normalizeNameKey(row.memberName);
    if (key !== keepKey && key !== mergeKey) continue;
    const bucket = `${row.section}|${new Date(row.bucketAt).toISOString()}`;
    const list = buckets.get(bucket) ?? [];
    list.push(row);
    buckets.set(bucket, list);
  }
  for (const list of buckets.values()) {
    if (list.length === 1 && list[0].memberName === keepName) continue;
    const sample = list[0];
    await tx.delete(memberUsageActivity).where(and(eq(memberUsageActivity.clubId, clubId), inArray(memberUsageActivity.id, list.map((row) => row.id))));
    await tx.insert(memberUsageActivity).values({
      clubId,
      memberName: keepName,
      section: sample.section,
      bucketAt: sample.bucketAt,
      pageViews: list.reduce((sum, row) => sum + row.pageViews, 0),
      activeSeconds: list.reduce((sum, row) => sum + row.activeSeconds, 0),
    });
  }
}

async function mergePicture(tx: Tx, plan: Plan) {
  const pictures = await tx.select().from(memberAvatars).where(eq(memberAvatars.clubId, plan.clubId));
  const keepPictureKey = normalizeMemberKey(plan.keep.displayName);
  const keepPicture = pictures.find((row) => row.memberKey === keepPictureKey);
  const mergePicture = pictures.find((row) => row.memberKey === normalizeMemberKey(plan.merge.displayName));
  if (!mergePicture) return;
  if (keepPicture) {
    await tx.delete(memberAvatars).where(and(eq(memberAvatars.id, mergePicture.id), eq(memberAvatars.clubId, plan.clubId)));
    return;
  }
  await tx
    .update(memberAvatars)
    .set({ memberKey: keepPictureKey, memberName: plan.keep.displayName })
    .where(and(eq(memberAvatars.id, mergePicture.id), eq(memberAvatars.clubId, plan.clubId)));
}

async function loadTournamentCombine(tx: Executor, clubId: number, tournamentId: number, keepKey: string, mergeKey: string) {
  const [event] = await tx
    .select({
      id: clubTournaments.id,
      title: clubTournaments.title,
      date: clubTournaments.eventDate,
      buyIn: clubTournaments.buyInCents,
      topUp: clubTournaments.topUpCents,
      bounty: clubTournaments.bountyCents,
      winnerKeepsBounty: clubTournaments.winnerKeepsBounty,
      first: clubTournaments.shareFirst,
      second: clubTournaments.shareSecond,
      third: clubTournaments.shareThird,
    })
    .from(clubTournaments)
    .where(and(eq(clubTournaments.id, tournamentId), eq(clubTournaments.clubId, clubId)))
    .limit(1);
  if (!event) throw new MergeError("That tournament is not in this club.", 404);

  const rows = await tx
    .select({
      id: tournamentResults.id,
      playerId: tournamentResults.playerId,
      name: players.displayName,
      nameKey: players.nameKey,
      finishPlace: tournamentResults.finishPlace,
      entries: tournamentResults.entries,
      topUp: tournamentResults.topUp,
      freeEntry: tournamentResults.freeEntry,
      knockouts: tournamentResults.knockouts,
      payoutCents: tournamentResults.payoutCents,
    })
    .from(tournamentResults)
    .innerJoin(players, eq(players.id, tournamentResults.playerId))
    .where(and(eq(tournamentResults.tournamentId, event.id), eq(players.clubId, clubId)));

  const money: TournamentMoney = {
    buyIn: toDollars(event.buyIn),
    topUp: toDollars(event.topUp),
    bounty: toDollars(event.bounty),
    winnerKeepsBounty: event.winnerKeepsBounty,
    shares: { first: event.first, second: event.second, third: event.third },
  };
  const combined = combineTournamentField(
    rows.map((row) => ({
      name: row.name,
      finishPlace: row.finishPlace,
      entries: row.entries,
      topUp: row.topUp,
      freeEntry: row.freeEntry,
      knockouts: row.knockouts,
      payout: row.payoutCents === null ? null : toDollars(row.payoutCents),
    })),
    money,
    keepKey,
    mergeKey,
  );
  if ("error" in combined) throw new MergeError(`${combined.error} (${event.title}, ${event.date})`, 409);
  return { event, rows, players: combined.players };
}

async function combineTournament(tx: Tx, plan: Plan, tournamentId: number) {
  const { event, rows, players: combinedPlayers } = await loadTournamentCombine(tx, plan.clubId, tournamentId, plan.keepKey, plan.mergeKey);
  const byKey = new Map(rows.map((row) => [row.nameKey, row]));
  for (const player of combinedPlayers) {
    const row = byKey.get(normalizeNameKey(player.name));
    if (!row || row.playerId === plan.merge.id) continue;
    await tx
      .update(tournamentResults)
      .set({
        finishPlace: player.finishPlace,
        entries: player.entries,
        topUp: player.topUp,
        freeEntry: player.freeEntry,
        knockouts: player.knockouts,
        payoutCents: toCents(player.payout ?? 0),
      })
      .where(and(eq(tournamentResults.id, row.id), eq(tournamentResults.playerId, row.playerId)));
  }
  await tx
    .delete(tournamentResults)
    .where(and(eq(tournamentResults.tournamentId, event.id), eq(tournamentResults.playerId, plan.merge.id)));
}

async function applyPlan(tx: Tx, plan: Plan) {
  for (const row of plan.cashCollisions) {
    await tx
      .update(sessionResults)
      .set({ buyInCents: row.buyInCents, cashOutCents: row.cashOutCents })
      .where(and(eq(sessionResults.id, row.keepResultId), eq(sessionResults.playerId, plan.keep.id)));
    await tx.delete(sessionResults).where(and(eq(sessionResults.id, row.mergeResultId), eq(sessionResults.playerId, plan.merge.id)));
  }
  if (plan.cashMoveIds.length > 0) {
    await tx
      .update(sessionResults)
      .set({ playerId: plan.keep.id })
      .where(and(eq(sessionResults.playerId, plan.merge.id), inArray(sessionResults.id, plan.cashMoveIds)));
  }

  if (plan.settlementDeleteIds.length > 0) {
    await tx
      .delete(nightSettlements)
      .where(and(eq(nightSettlements.clubId, plan.clubId), inArray(nightSettlements.id, plan.settlementDeleteIds)));
  }
  if (plan.settlementMoveIds.length > 0) {
    await tx
      .update(nightSettlements)
      .set({ playerId: plan.keep.id })
      .where(and(eq(nightSettlements.clubId, plan.clubId), eq(nightSettlements.playerId, plan.merge.id), inArray(nightSettlements.id, plan.settlementMoveIds)));
  }

  for (const tournamentId of plan.tournamentCombineIds) await combineTournament(tx, plan, tournamentId);
  if (plan.tournamentMoveIds.length > 0) {
    await tx
      .update(tournamentResults)
      .set({ playerId: plan.keep.id })
      .where(and(eq(tournamentResults.playerId, plan.merge.id), inArray(tournamentResults.tournamentId, plan.tournamentMoveIds)));
  }

  await tx
    .update(jackpotPayouts)
    .set({ playerId: plan.keep.id })
    .where(and(eq(jackpotPayouts.clubId, plan.clubId), eq(jackpotPayouts.playerId, plan.merge.id)));

  await renameNames(tx, plan);
  await mergeUsage(tx, plan);
  await mergePicture(tx, plan);

  if (plan.moveMembershipId !== null) {
    await tx
      .update(memberships)
      .set({ playerId: plan.keep.id })
      .where(and(eq(memberships.id, plan.moveMembershipId), eq(memberships.clubId, plan.clubId)));
  }
  if (plan.userId && plan.keep.userId !== plan.userId) {
    await tx.update(players).set({ userId: plan.userId }).where(and(eq(players.id, plan.keep.id), eq(players.clubId, plan.clubId)));
  }

  // Anything still pointing at the removed name would either block the delete or, where the
  // database cascades, drop a settle-up tick. Refuse instead of doing either.
  const [leftCash] = await tx.select({ total: count() }).from(sessionResults).where(eq(sessionResults.playerId, plan.merge.id));
  const [leftTournaments] = await tx.select({ total: count() }).from(tournamentResults).where(eq(tournamentResults.playerId, plan.merge.id));
  const [leftSettlements] = await tx.select({ total: count() }).from(nightSettlements).where(and(eq(nightSettlements.clubId, plan.clubId), eq(nightSettlements.playerId, plan.merge.id)));
  const [leftPayouts] = await tx.select({ total: count() }).from(jackpotPayouts).where(and(eq(jackpotPayouts.clubId, plan.clubId), eq(jackpotPayouts.playerId, plan.merge.id)));
  if (Number(leftCash?.total ?? 0) + Number(leftTournaments?.total ?? 0) + Number(leftSettlements?.total ?? 0) + Number(leftPayouts?.total ?? 0) > 0) {
    throw new MergeError("Those names overlap somewhere that couldn't be combined. Nothing was changed.", 409);
  }

  await tx.delete(players).where(and(eq(players.id, plan.merge.id), eq(players.clubId, plan.clubId)));
}

/** What a merge would move. Reads only. */
export async function previewPlayerMerge(clubId: number, keepName: string, mergeName: string): Promise<MergePreview> {
  return (await readPlan(db, clubId, keepName, mergeName, false)).preview;
}

/** Moves the merged name onto the kept one. Refuses, and changes nothing, when the two cannot be combined. */
export async function mergePlayers(clubId: number, keepName: string, mergeName: string): Promise<MergeResult> {
  try {
    const preview = await db.transaction(async (tx) => {
      const plan = await readPlan(tx, clubId, keepName, mergeName, true);
      await applyPlan(tx, plan);
      return plan.preview;
    });
    return { ...preview, merged: true };
  } catch (error) {
    if (error instanceof MergeError) throw error;
    if (isUniqueViolation(error)) {
      throw new MergeError("Those names overlap somewhere that couldn't be combined. Nothing was changed.", 409);
    }
    throw error;
  }
}
