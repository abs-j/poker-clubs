import { createHash, randomUUID } from "node:crypto";
import { parseResolution } from "./night-balance";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  liveActivityEventComments,
  liveActivityEvents,
  liveSessions,
} from "@workspace/db";
import { logger } from "./logger";
import { syncClosedLiveSessions } from "./club-sessions";
import { clubTimezone } from "./club-settings";
import {
  calculateLiveLedgerTotals,
  calculateLivePlayerTotals,
  formatLiveLedgerTimestamp,
  liveLedgerSessionDate,
  liveLedgerSheetRowRangesForSession,
  normalizeGoogleSheetsDate,
  parseMelbourneTimestamp,
  resolveCurrentLiveSession,
  shouldDiscardEmptyLiveSession,
} from "./live-ledger-utils";
import {
  assertLiveActivitySessionIsClosed,
  assertValidLiveActivityDeleteBackupId,
  deleteLiveActivitySessionSafely,
} from "./live-ledger-deletion";

export {
  LiveActivitySessionDeleteConflictError,
  LiveActivitySessionNotClosedError,
  LiveActivitySessionNotFoundError,
} from "./live-ledger-deletion";

const LIVE_ACTIVITY_HEADERS = [
  "event_id",
  "session_key",
  "session_date",
  "member_name",
  "action",
  "amount",
  "occurred_at",
  "created_by",
  "created_at",
  "updated_by",
  "updated_at",
  "deleted",
  "revision",
  "comment",
] as const;

export type LiveActivityAction = "buy_in" | "cash_out";
export type LiveActivityAuditAction = "entry" | "edit" | "delete";
export type LiveSyncStatus = "synced" | "pending" | "error";
export type LiveSessionStatus = "not_started" | "open" | "finalizing" | "ended";

type SheetMetadata = {
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
};

type SheetValueResponse = { values?: unknown[][] };
type ConnectorRequestInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

type ParsedSheetEvent = {
  eventId: string;
  sessionKey: string;
  sessionDate: string;
  memberName: string;
  action: LiveActivityAction;
  amountCents: number;
  occurredAt: Date;
  createdBy: string;
  createdAt: Date;
  updatedBy: string;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  revision: number;
  comment: string | null;
  sheetHash: string;
};

export type LiveActivityAuditComment = {
  action: LiveActivityAuditAction;
  comment: string;
  createdBy: string;
  createdAt: string;
};

export type LiveActivityEntry = {
  eventId: string;
  sessionKey: string;
  sessionDate: string;
  memberName: string;
  action: LiveActivityAction;
  amount: number;
  comment: string | null;
  auditComments: LiveActivityAuditComment[];
  occurredAt: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  deleted: boolean;
  revision: number;
};

export type LiveSessionCloseSummary = {
  buyIns: number;
  cashOuts: number;
  difference: number;
  balanceStatus: "balanced" | "unbalanced";
  closedAt: string;
};

export type LiveActivityHistoryRecord = {
  sessionKey: string;
  sessionDate: string;
  startedAt: string;
  endedAt: string;
  endedBy: string | null;
  totals: {
    buyIns: number;
    cashOuts: number;
    difference: number;
  };
  playerSummaries: LivePlayerSummary[];
  balanceStatus: "balanced" | "unbalanced";
  entries: LiveActivityEntry[];
};

export type LivePlayerSummary = {
  playerName: string;
  buyIns: number;
  cashOuts: number;
};

export type LiveActivitySnapshot = {
  sessionKey: string;
  sessionDate: string;
  entries: LiveActivityEntry[];
  hasRecordedActivity: boolean;
  playerSummaries: LivePlayerSummary[];
  totals: {
    buyIns: number;
    cashOuts: number;
    net: number;
  };
  syncStatus: LiveSyncStatus;
  syncMessage: string | null;
  lastSyncedAt: string | null;
  sessionStatus: LiveSessionStatus;
  startedBy: string | null;
  startedAt: string | null;
  endedBy: string | null;
  endedAt: string | null;
  closeSummary: LiveSessionCloseSummary | null;
};

export type LiveSessionEndResult = {
  outcome: "closed" | "discarded" | "already_closed";
  snapshot: LiveActivitySnapshot;
};

export class LiveActivitySyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveActivitySyncError";
  }
}


function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function amountToCents(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

function centsToAmount(cents: number): number {
  return roundMoney(cents / 100);
}

function validDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string") {
    const melbourneDate = parseMelbourneTimestamp(value);
    if (/^\d{1,2}\/\d{1,2}\/\d{4}(?:[ ,]+|$)/.test(value.trim())) return melbourneDate;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function legacySessionKeyForDate(sessionDate: string): string {
  return `live-${sessionDate}`;
}

function newSessionKeyForDate(sessionDate: string): string {
  return `${legacySessionKeyForDate(sessionDate)}-${randomUUID()}`;
}

function isAction(value: unknown): value is LiveActivityAction {
  return value === "buy_in" || value === "cash_out";
}

function toEntry(
  event: typeof liveActivityEvents.$inferSelect,
  auditComments: LiveActivityAuditComment[] = [],
): LiveActivityEntry {
  return {
    eventId: event.eventId,
    sessionKey: event.sessionKey,
    sessionDate: event.sessionDate,
    memberName: event.memberName,
    action: event.action as LiveActivityAction,
    amount: centsToAmount(event.amountCents),
    comment: event.comment,
    auditComments,
    occurredAt: event.occurredAt.toISOString(),
    createdBy: event.createdBy,
    createdAt: event.createdAt.toISOString(),
    updatedBy: event.updatedBy,
    updatedAt: event.updatedAt.toISOString(),
    deleted: Boolean(event.deletedAt),
    revision: event.revision,
  };
}

async function loadAuditComments(
  eventIds: string[],
): Promise<Map<string, LiveActivityAuditComment[]>> {
  if (eventIds.length === 0) return new Map();
  const records = await db
    .select()
    .from(liveActivityEventComments)
    .where(inArray(liveActivityEventComments.eventId, eventIds))
    .orderBy(asc(liveActivityEventComments.createdAt), asc(liveActivityEventComments.id));
  const byEventId = new Map<string, LiveActivityAuditComment[]>();
  for (const record of records) {
    const comments = byEventId.get(record.eventId) ?? [];
    comments.push({
      action: record.action as LiveActivityAuditAction,
      comment: record.comment,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
    });
    byEventId.set(record.eventId, comments);
  }
  return byEventId;
}

export class LiveActivityResetConflictError extends Error {
  constructor() {
    super("The live ledger changed after the backup was created. Download a fresh backup before resetting.");
    this.name = "LiveActivityResetConflictError";
  }
}

const liveActivityEnvironment = () => (process.env.NODE_ENV === "production" ? ("production" as const) : ("development" as const));

function buildLiveActivityResetBackup(
  sessionRows: (typeof liveSessions.$inferSelect)[],
  eventRows: (typeof liveActivityEvents.$inferSelect)[],
  commentRows: (typeof liveActivityEventComments.$inferSelect)[],
  environment: "development" | "production",
  sheetRows: string[][],
) {
  const normalizedSessions = sessionRows.map((session) => ({
    ...session,
    status: session.status as "open" | "finalizing" | "ended",
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    finalizedAt: session.finalizedAt?.toISOString() ?? null,
  }));
  const normalizedEvents = eventRows.map((event) => ({
    ...event,
    action: event.action as LiveActivityAction,
    occurredAt: event.occurredAt.toISOString(),
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    deletedAt: event.deletedAt?.toISOString() ?? null,
  }));
  const normalizedComments = commentRows.map((comment) => ({
    ...comment,
    action: comment.action as LiveActivityAuditAction,
    createdAt: comment.createdAt.toISOString(),
  }));
  const counts = {
    sessions: normalizedSessions.length,
    events: normalizedEvents.length,
    comments: normalizedComments.length,
    sheetRows: sheetRows
      .slice(1)
      .filter((row) => row.some((value) => value.trim() !== "")).length,
  };
  const backupContent = {
    environment,
    includesSharedSheet: environment === "production",
    counts,
    sessions: normalizedSessions,
    events: normalizedEvents,
    comments: normalizedComments,
    sheetRows,
  };
  const backupId = createHash("sha256")
    .update(JSON.stringify(backupContent))
    .digest("hex");

  return {
    ...backupContent,
    backupId,
    createdAt: new Date().toISOString(),
  };
}

/** Comments that belong to one club's entries. */
const clubEventIds = (clubId: number) =>
  db.select({ id: liveActivityEvents.eventId }).from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId));

export async function getLiveActivityResetBackup(clubId: number) {
  const environment = liveActivityEnvironment();
  const [sessionRows, eventRows, commentRows] = await Promise.all([
    db.select().from(liveSessions).where(eq(liveSessions.clubId, clubId)).orderBy(asc(liveSessions.id)),
    db.select().from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId)).orderBy(asc(liveActivityEvents.id)),
    db
      .select()
      .from(liveActivityEventComments)
      .where(inArray(liveActivityEventComments.eventId, clubEventIds(clubId)))
      .orderBy(asc(liveActivityEventComments.id)),
  ]);

  return buildLiveActivityResetBackup(sessionRows, eventRows, commentRows, environment, []);
}

export async function resetLiveActivityLedger(backupId: string, clubId: number) {
  if (!/^[0-9a-f]{64}$/.test(backupId)) {
    throw new LiveActivityResetConflictError();
  }

  const environment = liveActivityEnvironment();

  {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(0, hashtext('live-session'))`,
      );
      await tx.select().from(liveSessions).where(eq(liveSessions.clubId, clubId)).for("update");
      await tx.select().from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId)).for("update");

      const [sessionRows, eventRows, commentRows] = await Promise.all([
        tx.select().from(liveSessions).where(eq(liveSessions.clubId, clubId)).orderBy(asc(liveSessions.id)),
        tx.select().from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId)).orderBy(asc(liveActivityEvents.id)),
        tx
          .select()
          .from(liveActivityEventComments)
          .where(inArray(liveActivityEventComments.eventId, clubEventIds(clubId)))
          .orderBy(asc(liveActivityEventComments.id)),
      ]);
      const backup = buildLiveActivityResetBackup(sessionRows, eventRows, commentRows, environment, []);
      if (backup.backupId !== backupId) {
        throw new LiveActivityResetConflictError();
      }

      await tx
        .delete(liveActivityEventComments)
        .where(inArray(liveActivityEventComments.eventId, clubEventIds(clubId)));
      await tx.delete(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId));
      await tx.delete(liveSessions).where(eq(liveSessions.clubId, clubId));

      const freshSessionDate = liveLedgerSessionDate(new Date(), await clubTimezone(clubId));
      const freshSessionKey = newSessionKeyForDate(freshSessionDate);
      const freshSessionStartedAt = new Date();
      await tx.insert(liveSessions).values({
        clubId,
        sessionKey: freshSessionKey,
        sessionDate: freshSessionDate,
        status: "open",
        startedBy: "Admin reset",
        startedAt: freshSessionStartedAt,
      });

      return {
        environment,
        deletedSessions: backup.counts.sessions,
        deletedEvents: backup.counts.events,
        deletedComments: backup.counts.comments,
        clearedSheetRows: backup.counts.sheetRows,
        freshSessionKey,
        freshSessionDate,
        freshSessionStartedAt: freshSessionStartedAt.toISOString(),
      };
    });
  }
}

async function listEventsForSession(sessionKey: string) {
  return db
    .select()
    .from(liveActivityEvents)
    .where(eq(liveActivityEvents.sessionKey, sessionKey))
    .orderBy(desc(liveActivityEvents.occurredAt));
}

async function getLatestSessionForDate(clubId: number, sessionDate: string) {
  const [session] = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.sessionDate, sessionDate)))
    .orderBy(desc(liveSessions.startedAt))
    .limit(1);
  return session ?? null;
}

async function getOldestOpenSession(clubId: number) {
  const [session] = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "open")))
    .orderBy(asc(liveSessions.startedAt))
    .limit(1);
  return session ?? null;
}

async function getCurrentLiveSession(clubId: number, sessionDate: string) {
  const openSession = await getOldestOpenSession(clubId);
  const sessionForToday = openSession ? null : await getLatestSessionForDate(clubId, sessionDate);
  return resolveCurrentLiveSession(openSession, sessionForToday);
}

function sessionState(session: typeof liveSessions.$inferSelect | null): {
  sessionStatus: LiveSessionStatus;
  startedBy: string | null;
  startedAt: string | null;
  endedBy: string | null;
  endedAt: string | null;
  closeSummary: LiveSessionCloseSummary | null;
} {
  if (!session) {
    return {
      sessionStatus: "not_started",
      startedBy: null,
      startedAt: null,
      endedBy: null,
      endedAt: null,
      closeSummary: null,
    };
  }

  return {
    sessionStatus: session.status as LiveSessionStatus,
    startedBy: session.startedBy,
    startedAt: session.startedAt.toISOString(),
    endedBy: session.endedBy,
    endedAt: session.endedAt?.toISOString() ?? null,
    closeSummary:
      session.status === "ended" &&
      session.endedAt &&
      session.totalBuyInCents !== null &&
      session.totalCashOutCents !== null &&
      session.balanceStatus
        ? {
            buyIns: centsToAmount(session.totalBuyInCents),
            cashOuts: centsToAmount(session.totalCashOutCents),
            difference: centsToAmount(
              session.totalBuyInCents - session.totalCashOutCents,
            ),
            balanceStatus: session.balanceStatus as "balanced" | "unbalanced",
            closedAt: session.endedAt.toISOString(),
          }
        : null,
  };
}

function snapshot(
  events: Array<typeof liveActivityEvents.$inferSelect>,
  session: typeof liveSessions.$inferSelect | null,
  auditCommentsByEventId: Map<string, LiveActivityAuditComment[]> = new Map(),
): LiveActivitySnapshot {
  const sessionDate = session?.sessionDate ?? liveLedgerSessionDate();
  const activeEvents = events.filter((event) => !event.deletedAt);
  const totals = calculateLiveLedgerTotals(activeEvents);

  return {
    sessionKey: session?.sessionKey ?? legacySessionKeyForDate(sessionDate),
    sessionDate,
    entries: activeEvents.map((event) =>
      toEntry(event, auditCommentsByEventId.get(event.eventId) ?? []),
    ),
    hasRecordedActivity: events.length > 0,
    playerSummaries: calculateLivePlayerTotals(
      events.map((event) => ({
        sessionKey: event.sessionKey,
        memberName: event.memberName,
        action: event.action,
        amountCents: event.amountCents,
        deleted: Boolean(event.deletedAt),
      })),
      session?.sessionKey ?? "",
    ).map((summary) => ({
      playerName: summary.playerName,
      buyIns: centsToAmount(summary.buyInsCents),
      cashOuts: centsToAmount(summary.cashOutsCents),
    })),
    totals: {
      buyIns: centsToAmount(totals.buyInsCents),
      cashOuts: centsToAmount(totals.cashOutsCents),
      net: centsToAmount(totals.buyInsCents - totals.cashOutsCents),
    },
    // There is no spreadsheet backup; the fields stay so the response shape is unchanged.
    syncStatus: "synced" as LiveSyncStatus,
    syncMessage: null,
    lastSyncedAt: null,
    ...sessionState(session),
  };
}

async function snapshotForSession(session: typeof liveSessions.$inferSelect | null) {
  const events = session ? await listEventsForSession(session.sessionKey) : [];
  const auditCommentsByEventId = await loadAuditComments(events.map((event) => event.eventId));
  return snapshot(events, session, auditCommentsByEventId);
}

export async function getLiveActivitySnapshot(clubId: number): Promise<LiveActivitySnapshot> {
  const sessionDate = liveLedgerSessionDate(new Date(), await clubTimezone(clubId));
  return snapshotForSession(await getCurrentLiveSession(clubId, sessionDate));
}

export async function deleteLiveActivityLedgerSession(
  sessionKey: string,
  backupId: string,
  clubId: number,
) {
  assertValidLiveActivityDeleteBackupId(backupId);

  const environment = liveActivityEnvironment();

  return (
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(0, hashtext('live-session'))`,
      );
      await tx.select().from(liveSessions).where(eq(liveSessions.clubId, clubId)).for("update");
      await tx.select().from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId)).for("update");

      const [sessionRows, eventRows, commentRows] = await Promise.all([
        tx.select().from(liveSessions).where(eq(liveSessions.clubId, clubId)).orderBy(asc(liveSessions.id)),
        tx.select().from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId)).orderBy(asc(liveActivityEvents.id)),
        tx
          .select()
          .from(liveActivityEventComments)
          .where(inArray(liveActivityEventComments.eventId, clubEventIds(clubId)))
          .orderBy(asc(liveActivityEventComments.id)),
      ]);
      const session = sessionRows.find((row) => row.sessionKey === sessionKey);
      assertLiveActivitySessionIsClosed(session);

      const backup = buildLiveActivityResetBackup(sessionRows, eventRows, commentRows, environment, []);
      const sessionEvents = eventRows.filter((event) => event.sessionKey === sessionKey);
      const eventIds = new Set(sessionEvents.map((event) => event.eventId));
      const sessionComments = commentRows.filter((comment) => eventIds.has(comment.eventId));
      const { clearedSheetRows } = await deleteLiveActivitySessionSafely({
        session,
        backupId,
        currentBackupId: backup.backupId,
        // No spreadsheet is involved: these hooks exist for the shared deletion helper and do nothing.
        environment: "development",
        rows: [],
        sessionKey,
        eventIds,
        selectRanges: () => [],
        onMutationStarted: () => undefined,
        clearRanges: async () => undefined,
        deleteEvents: async (eventIdsToDelete) => {
          await tx
            .delete(liveActivityEvents)
            .where(inArray(liveActivityEvents.eventId, [...eventIdsToDelete]));
        },
        deleteSession: async (sessionKeyToDelete) => {
          await tx
            .delete(liveSessions)
            .where(eq(liveSessions.sessionKey, sessionKeyToDelete));
        },
      });

      return {
        environment,
        sessionKey,
        sessionDate: session.sessionDate,
        deletedEvents: sessionEvents.length,
        deletedComments: sessionComments.length,
        clearedSheetRows,
      };
    })
  );
}

export async function getLiveActivityHistory(clubId: number): Promise<LiveActivityHistoryRecord[]> {
  const sessions = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "ended")))
    .orderBy(desc(liveSessions.startedAt));
  if (sessions.length === 0) return [];

  const sessionKeys = sessions.map((session) => session.sessionKey);
  const events = await db
    .select()
    .from(liveActivityEvents)
    .where(and(inArray(liveActivityEvents.sessionKey, sessionKeys), isNull(liveActivityEvents.deletedAt)))
    .orderBy(desc(liveActivityEvents.occurredAt));
  const eventsBySession = new Map<string, typeof events>();
  const auditCommentsByEventId = await loadAuditComments(events.map((event) => event.eventId));
  for (const event of events) {
    const sessionEvents = eventsBySession.get(event.sessionKey) ?? [];
    sessionEvents.push(event);
    eventsBySession.set(event.sessionKey, sessionEvents);
  }

  return sessions.map((session) => {
    const sessionEvents = eventsBySession.get(session.sessionKey) ?? [];
    const totals = calculateLiveLedgerTotals(sessionEvents);
    return {
      sessionKey: session.sessionKey,
      sessionDate: session.sessionDate,
      startedAt: session.startedAt.toISOString(),
      endedAt: (session.endedAt ?? session.finalizedAt ?? session.startedAt).toISOString(),
      endedBy: session.endedBy,
      totals: {
        buyIns: centsToAmount(totals.buyInsCents),
        cashOuts: centsToAmount(totals.cashOutsCents),
        difference: centsToAmount(totals.differenceCents),
      },
      playerSummaries: calculateLivePlayerTotals(
        sessionEvents.map((event) => ({
          sessionKey: event.sessionKey,
          memberName: event.memberName,
          action: event.action,
          amountCents: event.amountCents,
          deleted: Boolean(event.deletedAt),
        })),
        session.sessionKey,
      ).map((summary) => ({
        playerName: summary.playerName,
        buyIns: centsToAmount(summary.buyInsCents),
        cashOuts: centsToAmount(summary.cashOutsCents),
      })),
      balanceStatus: totals.balanceStatus,
      entries: sessionEvents.map((event) =>
        toEntry(event, auditCommentsByEventId.get(event.eventId) ?? []),
      ),
    };
  });
}

export async function createLiveActivityEvent(input: {
  clubId: number;
  action: LiveActivityAction;
  amount: number;
  eventId?: string;
  memberName: string;
  attributedPlayer?: string;
  comment?: string;
}): Promise<LiveActivitySnapshot> {
  if (input.amount <= 0 || !Number.isFinite(input.amount)) {
    throw new Error("Enter a positive amount.");
  }

  const eventId = input.eventId ?? randomUUID();
  const now = new Date();
  const playerName = input.attributedPlayer?.trim() || input.memberName;
  const clubId = input.clubId;
  const result = await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "open")))
      .orderBy(asc(liveSessions.startedAt))
      .limit(1)
      .for("update");
    if (!session || session.status !== "open") {
      throw new Error("Start the live session before adding activity.");
    }

    const [existing] = await tx
      .select()
      .from(liveActivityEvents)
      .where(eq(liveActivityEvents.eventId, eventId))
      .limit(1);
    if (existing) return { session, created: false };

    await tx.insert(liveActivityEvents).values({
      clubId,
      eventId,
      sessionKey: session.sessionKey,
      sessionDate: session.sessionDate,
      memberName: playerName,
      action: input.action,
      amountCents: Math.round(input.amount * 100),
      comment: input.comment?.trim() || null,
      occurredAt: now,
      createdBy: input.memberName,
      createdAt: now,
      updatedBy: input.memberName,
      updatedAt: now,
      revision: 1,
    });
    const initialComment = input.comment?.trim();
    if (initialComment) {
      await tx.insert(liveActivityEventComments).values({
        eventId,
        action: "entry",
        comment: initialComment,
        createdBy: input.memberName,
        createdAt: now,
      });
    }
    return { session, created: true };
  });

  return snapshotForSession(result.session);
}

export async function updateLiveActivityEvent(input: {
  clubId: number;
  eventId: string;
  action: LiveActivityAction;
  amount: number;
  memberName: string;
  attributedPlayer?: string;
  comment: string;
}): Promise<LiveActivitySnapshot> {
  if (input.amount <= 0 || !Number.isFinite(input.amount)) {
    throw new Error("Enter a positive amount.");
  }
  const comment = input.comment.trim();
  if (!comment || comment.length > 500) {
    throw new Error("Enter a reason between 1 and 500 characters.");
  }

  const now = new Date();
  const session = await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(liveActivityEvents)
      .where(eq(liveActivityEvents.eventId, input.eventId))
      .limit(1);
    if (!event || event.deletedAt || event.clubId !== input.clubId) {
      throw new Error("That live activity entry no longer exists.");
    }

    const [lockedSession] = await tx
      .select()
      .from(liveSessions)
      .where(eq(liveSessions.sessionKey, event.sessionKey))
      .for("update");
    if (!lockedSession || lockedSession.status !== "open") {
      throw new Error("Only an open live session can be edited.");
    }

    const playerName = input.attributedPlayer?.trim() || event.memberName;
    await tx.insert(liveActivityEventComments).values({
      eventId: input.eventId,
      action: "edit",
      comment,
      createdBy: input.memberName,
      createdAt: now,
    });
    await tx
      .update(liveActivityEvents)
      .set({
        memberName: playerName,
        action: input.action,
        amountCents: Math.round(input.amount * 100),
        comment,
        updatedBy: input.memberName,
        updatedAt: now,
        revision: event.revision + 1,
        sheetHash: null,
      })
      .where(eq(liveActivityEvents.eventId, input.eventId));
    return lockedSession;
  });

  return snapshotForSession(session);
}

export async function deleteLiveActivityEvent(
  eventId: string,
  memberName: string,
  comment: string,
  clubId: number,
): Promise<LiveActivitySnapshot> {
  const reason = comment.trim();
  if (!reason || reason.length > 500) {
    throw new Error("Enter a reason between 1 and 500 characters.");
  }
  const now = new Date();
  const session = await db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(liveActivityEvents)
      .where(eq(liveActivityEvents.eventId, eventId))
      .limit(1);
    if (!event || event.deletedAt || event.clubId !== clubId) {
      throw new Error("That live activity entry no longer exists.");
    }

    const [lockedSession] = await tx
      .select()
      .from(liveSessions)
      .where(eq(liveSessions.sessionKey, event.sessionKey))
      .for("update");
    if (!lockedSession || lockedSession.status !== "open") {
      throw new Error("Only an open live session can be edited.");
    }

    await tx.insert(liveActivityEventComments).values({
      eventId,
      action: "delete",
      comment: reason,
      createdBy: memberName,
      createdAt: now,
    });
    await tx
      .update(liveActivityEvents)
      .set({
        deletedAt: now,
        deletedBy: memberName,
        comment: reason,
        updatedBy: memberName,
        updatedAt: now,
        revision: event.revision + 1,
        sheetHash: null,
      })
      .where(eq(liveActivityEvents.eventId, eventId));
    return lockedSession;
  });

  return snapshotForSession(session);
}

export async function startLiveSession(memberName: string, clubId: number): Promise<LiveActivitySnapshot> {
  const sessionDate = liveLedgerSessionDate(new Date(), await clubTimezone(clubId));
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(0, hashtext('live-session'))`);
    const [openSession] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "open")))
      .orderBy(asc(liveSessions.startedAt))
      .limit(1)
      .for("update");

    if (openSession) return;

    const [existing] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.sessionDate, sessionDate)))
      .orderBy(desc(liveSessions.startedAt))
      .limit(1)
      .for("update");

    if (!existing || existing.status === "ended") {
      await tx.insert(liveSessions).values({
        clubId,
        sessionKey: newSessionKeyForDate(sessionDate),
        sessionDate,
        status: "open",
        startedBy: memberName,
      });
    } else if (existing.status === "finalizing") {
      // Recover sessions left mid-close by the older sheet-finalization flow.
      await tx
        .update(liveSessions)
        .set({ status: "open", endedBy: null, endedAt: null })
        .where(eq(liveSessions.sessionKey, existing.sessionKey));
    }
  });

  return getLiveActivitySnapshot(clubId);
}

export async function endLiveSession(memberName: string, clubId: number): Promise<LiveSessionEndResult> {
  const sessionDate = liveLedgerSessionDate(new Date(), await clubTimezone(clubId));
  const result = await db.transaction(async (tx) => {
    let [session] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "open")))
      .orderBy(desc(liveSessions.startedAt))
      .limit(1)
      .for("update");
    if (!session) {
      [session] = await tx
        .select()
        .from(liveSessions)
        .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.sessionDate, sessionDate)))
        .orderBy(desc(liveSessions.startedAt))
        .limit(1)
        .for("update");
    }
    if (!session) throw new Error("Start the live session before ending it.");
    if (session.status === "ended") {
      return { session, outcome: "already_closed" as const };
    }
    if (session.status !== "open" && session.status !== "finalizing") {
      throw new Error("This live session cannot be closed right now.");
    }

    const allEvents = await tx
      .select()
      .from(liveActivityEvents)
      .where(eq(liveActivityEvents.sessionKey, session.sessionKey))
      .orderBy(desc(liveActivityEvents.occurredAt));
    if (shouldDiscardEmptyLiveSession(allEvents)) {
      await tx
        .delete(liveSessions)
        .where(eq(liveSessions.sessionKey, session.sessionKey));
      const [previousSession] = await tx
        .select()
        .from(liveSessions)
        .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.sessionDate, session.sessionDate)))
        .orderBy(desc(liveSessions.startedAt))
        .limit(1);
      return {
        session: previousSession ?? null,
        outcome: "discarded" as const,
        discardedSessionKey: session.sessionKey,
      };
    }

    const events = allEvents.filter((event) => !event.deletedAt);
    const totals = calculateLiveLedgerTotals(events);
    // A gap would otherwise land on the leaderboard as it is, so someone must say what to do with it first.
    if (totals.balanceStatus === "unbalanced" && !parseResolution(session.balanceResolution)) {
      const gap = (Math.abs(totals.differenceCents) / 100).toFixed(2);
      throw new Error(`This ledger is out by ${gap}. A club admin needs to choose how to balance it before it closes.`);
    }
    const closedAt = new Date();
    const [closedSession] = await tx
      .update(liveSessions)
      .set({
        status: "ended",
        endedBy: memberName,
        endedAt: closedAt,
        totalBuyInCents: totals.buyInsCents,
        totalCashOutCents: totals.cashOutsCents,
        balanceDifferenceCents: totals.differenceCents,
        balanceStatus: totals.balanceStatus,
      })
      .where(eq(liveSessions.sessionKey, session.sessionKey))
      .returning();
    return { session: closedSession, outcome: "closed" as const };
  });

  if (result.outcome === "discarded") {
    logger.info(
      { sessionKey: result.discardedSessionKey, memberName },
      "Empty live session discarded",
    );
  }
  if (result.outcome === "closed") {
    // The night joins the club's results so leaderboards and points include it right away.
    await syncClosedLiveSessions(clubId).catch((error: unknown) => {
      logger.error({ err: error, clubId }, "Could not record the closed live session as a night");
    });
  }
  return {
    outcome: result.outcome,
    snapshot: await snapshotForSession(result.session),
  };
}