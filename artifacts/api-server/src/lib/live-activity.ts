import { createHash, randomUUID } from "node:crypto";
import { parseResolution } from "./night-balance";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  clubSessions,
  db,
  liveActivityEventComments,
  liveActivityEvents,
  liveSessions,
  memberships,
  players,
} from "@workspace/db";
import { logger } from "./logger";
import { nameKey } from "./club-access";
import { removeNightsForLiveSession, syncClosedLiveSessions } from "./club-sessions";
import {
  canEditEntry,
  canManageNight,
  hostOf,
  LedgerPermissionError,
  type LedgerActor,
} from "./ledger-permissions";
import { clubTimezone } from "./club-settings";
import {
  calculateLiveLedgerTotals,
  calculateLivePlayerTotals,
  formatLiveLedgerTimestamp,
  chooseLedgerDate,
  cleanNotesPlayers,
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

/**
 * The latest night for a date: one dated that day, or one closed that day. A night caught up for a past date
 * is closed today, and the Live tab should still show it as closed rather than as nothing.
 */
async function getLatestSessionForDate(clubId: number, sessionDate: string, timeZone: string) {
  const [session] = await db
    .select()
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.clubId, clubId),
        or(
          eq(liveSessions.sessionDate, sessionDate),
          and(
            isNotNull(liveSessions.endedAt),
            sql`to_char(${liveSessions.endedAt} AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') = ${sessionDate}`,
          ),
        ),
      ),
    )
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

async function getCurrentLiveSession(clubId: number, sessionDate: string, timeZone: string) {
  const openSession = await getOldestOpenSession(clubId);
  const sessionForToday = openSession ? null : await getLatestSessionForDate(clubId, sessionDate, timeZone);
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
  const timeZone = await clubTimezone(clubId);
  return snapshotForSession(await getCurrentLiveSession(clubId, liveLedgerSessionDate(new Date(), timeZone), timeZone));
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
  actor: LedgerActor;
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
    if (!canEditEntry(input.actor, hostOf(lockedSession), event.createdBy)) {
      throw new LedgerPermissionError("Only the person who logged this, the host, or an admin can change it.");
    }

    const playerName = input.attributedPlayer?.trim() || event.memberName;
    await tx.insert(liveActivityEventComments).values({
      eventId: input.eventId,
      action: "edit",
      comment,
      createdBy: input.actor.name,
      createdAt: now,
    });
    await tx
      .update(liveActivityEvents)
      .set({
        memberName: playerName,
        action: input.action,
        amountCents: Math.round(input.amount * 100),
        comment,
        updatedBy: input.actor.name,
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
  actor: LedgerActor,
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
    if (!canEditEntry(actor, hostOf(lockedSession), event.createdBy)) {
      throw new LedgerPermissionError("Only the person who logged this, the host, or an admin can change it.");
    }

    await tx.insert(liveActivityEventComments).values({
      eventId,
      action: "delete",
      comment: reason,
      createdBy: actor.name,
      createdAt: now,
    });
    await tx
      .update(liveActivityEvents)
      .set({
        deletedAt: now,
        deletedBy: actor.name,
        comment: reason,
        updatedBy: actor.name,
        updatedAt: now,
        revision: event.revision + 1,
        sheetHash: null,
      })
      .where(eq(liveActivityEvents.eventId, eventId));
    return lockedSession;
  });

  return snapshotForSession(session);
}

/** Starts a night for `date` (tonight when omitted; a past date catches a night up after the fact). */
export async function startLiveSession(memberName: string, clubId: number, date?: string): Promise<LiveActivitySnapshot> {
  const timeZone = await clubTimezone(clubId);
  const chosen = chooseLedgerDate(date, liveLedgerSessionDate(new Date(), timeZone));
  if ("error" in chosen) throw new LiveSessionInputError(chosen.error);
  const sessionDate = chosen.date;
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
        settleUp: true,
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

/**
 * Adds a night's worth of entries read from notes (name, buy-in, cash-out per player) to the open night, logged by
 * whoever is filling it in. The host or an admin only: it can add a lot of entries at once.
 */
export async function addEntriesFromNotes(actor: LedgerActor, clubId: number, rows: unknown): Promise<LiveActivitySnapshot> {
  const cleaned = cleanNotesPlayers(rows);
  if ("error" in cleaned) throw new LiveSessionInputError(cleaned.error);
  const session = await db.transaction(async (tx) => {
    const [open] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "open")))
      .orderBy(asc(liveSessions.startedAt))
      .limit(1)
      .for("update");
    if (!open) throw new LiveSessionInputError("Start the night before filling it from notes.");
    if (!canManageNight(actor, hostOf(open))) {
      throw new LedgerPermissionError("Only the host or an admin can fill the night from notes.");
    }
    const base = Date.now();
    let tick = 0;
    const events: Array<typeof liveActivityEvents.$inferInsert> = [];
    for (const player of cleaned.players) {
      for (const [action, amountCents] of [["buy_in", player.buyInCents], ["cash_out", player.cashOutCents]] as const) {
        if (amountCents <= 0) continue;
        const at = new Date(base + tick++);
        events.push({
          clubId,
          eventId: randomUUID(),
          sessionKey: open.sessionKey,
          sessionDate: open.sessionDate,
          memberName: player.name,
          action,
          amountCents,
          comment: "From notes",
          occurredAt: at,
          createdBy: actor.name,
          createdAt: at,
          updatedBy: actor.name,
          updatedAt: at,
          revision: 1,
        });
      }
    }
    await tx.insert(liveActivityEvents).values(events);
    await tx.insert(liveActivityEventComments).values(
      events.map((event) => ({ eventId: event.eventId, action: "entry", comment: "From notes", createdBy: actor.name, createdAt: event.createdAt })),
    );
    return open;
  });
  return snapshotForSession(session);
}

export async function endLiveSession(actor: LedgerActor, clubId: number): Promise<LiveSessionEndResult> {
  const timeZone = await clubTimezone(clubId);
  const result = await db.transaction(async (tx) => {
    let [session] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "open")))
      .orderBy(desc(liveSessions.startedAt))
      .limit(1)
      .for("update");
    if (!session) {
      const today = liveLedgerSessionDate(new Date(), timeZone);
      [session] = await tx
        .select()
        .from(liveSessions)
        .where(
          and(
            eq(liveSessions.clubId, clubId),
            or(
              eq(liveSessions.sessionDate, today),
              and(isNotNull(liveSessions.endedAt), sql`to_char(${liveSessions.endedAt} AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') = ${today}`),
            ),
          ),
        )
        .orderBy(desc(liveSessions.startedAt))
        .limit(1)
        .for("update");
    }
    if (!session) throw new Error("Start the live session before ending it.");
    if (!canManageNight(actor, hostOf(session))) {
      throw new LedgerPermissionError("Only the host or an admin can close this night.");
    }
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
      throw new Error(`This ledger is out by ${gap}. The host or an admin needs to choose how to balance it before it closes.`);
    }
    const closedAt = new Date();
    const [closedSession] = await tx
      .update(liveSessions)
      .set({
        status: "ended",
        endedBy: actor.name,
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
      { sessionKey: result.discardedSessionKey, memberName: actor.name },
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

const ACTIVE_STATUSES = ["open", "finalizing"] as const;

/** A bad request to start or fill a night (a future date, a name that is too long), as opposed to a server fault. */
export class LiveSessionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveSessionInputError";
  }
}

export type LiveSessionRole = {
  hostName: string | null;
  bankName: string | null;
  canManage: boolean;
  status: "open" | "ended" | "none";
  /** The recorded night of the latest closed session, once it has been recorded. Used for settle-up. */
  nightId: number | null;
};

/** The open night, or failing that the latest closed one. */
async function currentSession(clubId: number) {
  const [active] = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.clubId, clubId), inArray(liveSessions.status, [...ACTIVE_STATUSES])))
    .orderBy(asc(liveSessions.startedAt))
    .limit(1);
  if (active) return { session: active, status: "open" as const };
  const [ended] = await db
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "ended"), isNotNull(liveSessions.endedAt)))
    .orderBy(desc(liveSessions.endedAt), desc(liveSessions.startedAt))
    .limit(1);
  return ended ? { session: ended, status: "ended" as const } : null;
}

export async function liveSessionRole(actor: LedgerActor, clubId: number): Promise<LiveSessionRole> {
  const current = await currentSession(clubId);
  // An admin can record a tournament or a jackpot payout even before the club's first night.
  if (!current) return { hostName: null, bankName: null, canManage: actor.isAdmin, status: "none", nightId: null };
  const { session, status } = current;
  const hostName = hostOf(session);
  let nightId: number | null = null;
  if (status === "ended" && session.settleUp) {
    const [night] = await db
      .select({ id: clubSessions.id })
      .from(clubSessions)
      .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.liveSessionKey, session.sessionKey)))
      .limit(1);
    nightId = night?.id ?? null;
  }
  return {
    hostName,
    bankName: session.bankName ?? null,
    canManage: canManageNight(actor, hostName),
    status,
    nightId,
  };
}

/**
 * Chooses who holds the cash for the night (or clears it). Works on the open night, and on the latest
 * closed one so a host who forgot can still say who the bank was. The host or an admin; the bank is a player on the club's roster.
 */
export async function setLiveSessionBank(actor: LedgerActor, clubId: number, name: string | null): Promise<LiveSessionRole> {
  const current = await currentSession(clubId);
  if (!current) throw new Error("Start a night before choosing a bank.");
  if (!canManageNight(actor, hostOf(current.session))) {
    throw new LedgerPermissionError("Only the host or an admin can choose the bank.");
  }
  let bankName: string | null = null;
  if (name !== null) {
    const key = nameKey(name);
    const [player] = key
      ? await db
          .select({ displayName: players.displayName })
          .from(players)
          .where(and(eq(players.clubId, clubId), eq(players.nameKey, key)))
          .limit(1)
      : [];
    // Someone typed into tonight's ledger who has not been recorded yet counts too.
    const [entered] = key && !player
      ? await db
          .select({ name: liveActivityEvents.memberName })
          .from(liveActivityEvents)
          .where(and(
            eq(liveActivityEvents.clubId, clubId),
            eq(liveActivityEvents.sessionKey, current.session.sessionKey),
            isNull(liveActivityEvents.deletedAt),
            sql`lower(regexp_replace(btrim(${liveActivityEvents.memberName}), '\s+', ' ', 'g')) = ${key}`,
          ))
          .limit(1)
      : [];
    const chosen = player?.displayName ?? entered?.name.trim().replace(/\s+/g, " ");
    if (!chosen) throw new Error("That person is not on this club's roster or in tonight's ledger.");
    bankName = chosen;
  }
  await db
    .update(liveSessions)
    .set({ bankName })
    .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.sessionKey, current.session.sessionKey)));
  return liveSessionRole(actor, clubId);
}

/** Hands the open night to another member. The target has to already belong to the club. */
export async function setLiveSessionHost(actor: LedgerActor, clubId: number, name: string): Promise<LiveSessionRole> {
  const key = nameKey(name);
  if (!key) throw new Error("Choose a member to host this night.");
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), inArray(liveSessions.status, [...ACTIVE_STATUSES])))
      .orderBy(asc(liveSessions.startedAt))
      .limit(1)
      .for("update");
    if (!session) throw new Error("Start a night before handing it over.");
    if (!canManageNight(actor, hostOf(session))) {
      throw new LedgerPermissionError("Only the host or an admin can hand this night over.");
    }
    const [member] = await tx
      .select({ displayName: players.displayName })
      .from(memberships)
      .innerJoin(players, eq(players.id, memberships.playerId))
      .where(and(eq(memberships.clubId, clubId), eq(players.clubId, clubId), eq(players.nameKey, key)))
      .limit(1);
    if (!member) throw new Error("That person is not a member of this club.");
    await tx.update(liveSessions).set({ hostName: member.displayName }).where(eq(liveSessions.sessionKey, session.sessionKey));
    return { hostName: member.displayName, bankName: session.bankName ?? null, canManage: canManageNight(actor, member.displayName), status: "open", nightId: null };
  });
}

/**
 * Puts the latest closed night back to open and removes the result it produced,
 * so closing it again records that night once.
 */
export async function reopenLiveSession(actor: LedgerActor, clubId: number): Promise<LiveActivitySnapshot> {
  const session = await db.transaction(async (tx) => {
    const active = await tx
      .select({ id: liveSessions.id })
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), inArray(liveSessions.status, [...ACTIVE_STATUSES])))
      .for("update");
    if (active.length > 0) throw new Error("Close the open night before reopening another.");

    const [ended] = await tx
      .select()
      .from(liveSessions)
      .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "ended"), isNotNull(liveSessions.endedAt)))
      .orderBy(desc(liveSessions.endedAt), desc(liveSessions.startedAt))
      .limit(1)
      .for("update");
    if (!ended) throw new Error("There is no closed night to reopen.");
    if (!canManageNight(actor, hostOf(ended))) {
      throw new LedgerPermissionError("Only the host or an admin can reopen this night.");
    }
    await removeNightsForLiveSession(clubId, ended.sessionKey, tx);
    const [reopened] = await tx
      .update(liveSessions)
      .set({ status: "open", endedBy: null, endedAt: null, balanceResolution: null })
      .where(eq(liveSessions.sessionKey, ended.sessionKey))
      .returning();
    return reopened ?? ended;
  });
  return snapshotForSession(session);
}