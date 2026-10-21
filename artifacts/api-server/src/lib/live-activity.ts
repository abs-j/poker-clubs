import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ReplitConnectors } from "@replit/connectors-sdk";
import {
  db,
  liveActivityEventComments,
  liveActivityEvents,
  liveSessions,
} from "@workspace/db";
import { logger } from "./logger";
import { getDefaultClubId } from "./club-context";
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
  createLiveActivitySheetRollbackGuard,
  deleteLiveActivitySessionSafely,
} from "./live-ledger-deletion";

export {
  LiveActivitySessionDeleteConflictError,
  LiveActivitySessionNotClosedError,
  LiveActivitySessionNotFoundError,
} from "./live-ledger-deletion";

const SPREADSHEET_ID = "10COQnx6Rd_KzLNsxwZCqd6GDnUXy4GBGYPhRas_msyw";
const LIVE_ACTIVITY_SHEET_TITLE = "Live Activity";
const LIVE_ACTIVITY_SHEET_LOCK_NAME = "monash-live-activity-sheet-sync";
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

function isProductionLiveActivityEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}

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

let sheetSyncPromise: Promise<string> | null = null;
let sheetSyncRequestedWhileRunning = false;
let sheetSyncError: string | null = null;
let sheetSyncedAt: string | null = null;

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

function rowHash(event: {
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
  revision: number;
  comment?: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      event.eventId,
      event.sessionKey,
      event.sessionDate,
      event.memberName,
      event.action,
      event.amountCents,
      event.occurredAt.toISOString(),
      event.createdBy,
      event.createdAt.toISOString(),
      event.updatedBy,
      event.updatedAt.toISOString(),
      Boolean(event.deletedAt),
      event.revision,
      event.comment ?? null,
    ]))
    .digest("hex");
}

function rowForEvent(event: {
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
  revision: number;
  comment: string | null;
}): unknown[] {
  return [
    event.eventId,
    event.sessionKey,
    event.sessionDate,
    event.memberName,
    event.action,
    centsToAmount(event.amountCents),
    formatLiveLedgerTimestamp(event.occurredAt),
    event.createdBy,
    formatLiveLedgerTimestamp(event.createdAt),
    event.updatedBy,
    formatLiveLedgerTimestamp(event.updatedAt),
    event.deletedAt ? "TRUE" : "FALSE",
    event.revision,
    event.comment ?? "",
  ];
}

function parseSheetEvent(row: unknown[]): ParsedSheetEvent | null {
  const eventId = String(row[0] ?? "").trim();
  const sessionDate = normalizeGoogleSheetsDate(row[2]);
  const memberName = String(row[3] ?? "").trim();
  const action = row[4];
  const occurredAt = validDate(row[6]);
  const createdAt = validDate(row[8]) ?? occurredAt;
  const updatedAt = validDate(row[10]) ?? createdAt;
  const amountCents = amountToCents(row[5]);

  if (
    !eventId ||
    !sessionDate ||
    !memberName ||
    !isAction(action) ||
    amountCents <= 0 ||
    !occurredAt ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  const deleted = String(row[11] ?? "").trim().toLowerCase() === "true";
  const revision = Math.max(1, Number(row[12]) || 1);
  const event = {
    eventId,
    sessionKey:
      String(row[1] ?? "").trim() || legacySessionKeyForDate(sessionDate),
    sessionDate,
    memberName,
    action,
    amountCents,
    occurredAt,
    createdBy: String(row[7] ?? "").trim() || "Google Sheets editor",
    createdAt,
    updatedBy: String(row[9] ?? "").trim() || "Google Sheets editor",
    updatedAt,
    deletedAt: deleted ? updatedAt : null,
    deletedBy: deleted ? String(row[9] ?? "").trim() || "Google Sheets editor" : null,
    revision,
    comment: String(row[13] ?? "").trim() || null,
  };

  return { ...event, sheetHash: rowHash(event) };
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

async function requestJson(
  connectors: ReplitConnectors,
  path: string,
  init: ConnectorRequestInit,
): Promise<Record<string, unknown>> {
  const response = await connectors.proxy("google-sheet", path, init);
  if (!response.ok) {
    throw new LiveActivitySyncError(
      `Google Sheets returned ${response.status} for live activity synchronization.`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

async function ensureLiveActivitySheet(connectors: ReplitConnectors): Promise<string> {
  const metadataPath =
    `/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(title,sheetId))`;
  let metadata = (await requestJson(connectors, metadataPath, { method: "GET" })) as SheetMetadata;
  let existing = metadata.sheets?.find(
    (sheet) => sheet.properties?.title === LIVE_ACTIVITY_SHEET_TITLE,
  )?.properties?.title;

  if (!existing) {
    await requestJson(connectors, `/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: LIVE_ACTIVITY_SHEET_TITLE } } }],
      }),
    });
    metadata = (await requestJson(connectors, metadataPath, { method: "GET" })) as SheetMetadata;
    existing = metadata.sheets?.find(
      (sheet) => sheet.properties?.title === LIVE_ACTIVITY_SHEET_TITLE,
    )?.properties?.title;
  }

  if (!existing) {
    throw new LiveActivitySyncError("The Live Activity sheet could not be created.");
  }

  const headerRange = encodeURIComponent(`'${existing}'!A1:N1`);
  const headerResponse = (await requestJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${headerRange}?valueRenderOption=FORMATTED_VALUE`,
    { method: "GET" },
  )) as SheetValueResponse;
  const headers = headerResponse.values?.[0] ?? [];
  if (headers.length === 0) {
    await requestJson(
      connectors,
      `/v4/spreadsheets/${SPREADSHEET_ID}/values/${headerRange}?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: [LIVE_ACTIVITY_HEADERS] }),
      },
    );
  } else {
    const legacyHeadersMatch = LIVE_ACTIVITY_HEADERS.slice(0, 13).every(
      (header, index) => String(headers[index] ?? "").trim() === header,
    );
    if (!legacyHeadersMatch || (headers.length > 13 && String(headers[13] ?? "").trim() !== "comment")) {
      throw new LiveActivitySyncError(
        "The Live Activity sheet exists but its header row does not match the expected format.",
      );
    }
    if (headers.length === 13) {
      await requestJson(
        connectors,
        `/v4/spreadsheets/${SPREADSHEET_ID}/values/${headerRange}?valueInputOption=RAW`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: [LIVE_ACTIVITY_HEADERS] }),
        },
      );
    }
  }

  return existing;
}

async function readLiveActivityRows(
  connectors: ReplitConnectors,
  sheetTitle: string,
): Promise<unknown[][]> {
  const range = encodeURIComponent(`'${sheetTitle}'!A1:O10000`);
  const payload = (await requestJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
    { method: "GET" },
  )) as SheetValueResponse;
  return payload.values ?? [];
}

async function writeLiveActivityRow(
  connectors: ReplitConnectors,
  sheetTitle: string,
  rowNumber: number,
  row: unknown[],
): Promise<void> {
  const range = encodeURIComponent(`'${sheetTitle}'!A${rowNumber}:N${rowNumber}`);
  const result = await requestJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
  const returnedRange =
    typeof result["updatedRange"] === "string"
      ? result["updatedRange"].split("!").at(-1)?.replaceAll("$", "").toUpperCase()
      : undefined;
  const expectedRange = `A${rowNumber}:N${rowNumber}`;
  if (returnedRange !== expectedRange) {
    throw new LiveActivitySyncError(
      `Google Sheets wrote to ${returnedRange ?? "an unreported range"} instead of ${expectedRange}.`,
    );
  }
}

async function clearLiveActivityRows(
  connectors: ReplitConnectors,
  sheetTitle: string,
): Promise<void> {
  const range = encodeURIComponent(`'${sheetTitle}'!A2:O10000`);
  await requestJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}:clear`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );
}

async function clearLiveActivitySheetRanges(
  connectors: ReplitConnectors,
  sheetTitle: string,
  ranges: string[],
): Promise<void> {
  if (ranges.length === 0) return;
  const requestedRanges = ranges.map((range) => `'${sheetTitle}'!${range}`);
  const result = await requestJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values:batchClear`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ranges: requestedRanges }),
    },
  );
  const clearedRanges = result["clearedRanges"];
  const normalizeRange = (value: unknown) =>
    typeof value === "string"
      ? value.split("!").at(-1)?.replaceAll("$", "").toUpperCase()
      : undefined;
  const expectedRanges = ranges.map((range) => range.replaceAll("$", "").toUpperCase());
  const actualRanges = Array.isArray(clearedRanges)
    ? clearedRanges.map(normalizeRange)
    : [];
  if (
    actualRanges.length !== expectedRanges.length ||
    expectedRanges.some((range) => !actualRanges.includes(range))
  ) {
    throw new LiveActivitySyncError(
      "Google Sheets did not confirm clearing exactly the selected live-ledger rows.",
    );
  }
}

async function restoreLiveActivityRows(
  connectors: ReplitConnectors,
  sheetTitle: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  const range = encodeURIComponent(`'${sheetTitle}'!A1:O${rows.length}`);
  await requestJson(
    connectors,
    `/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    },
  );
}

async function syncLiveActivitySheet(options: { preferLocal?: boolean } = {}): Promise<string> {
  if (!isProductionLiveActivityEnvironment()) return new Date().toISOString();

  // The production sheet mirror belongs to the original club only, so it does nothing elsewhere.
  const clubId = await getDefaultClubId();
  if (clubId === null) return new Date().toISOString();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(0, hashtext(${LIVE_ACTIVITY_SHEET_LOCK_NAME}))`,
    );
    const connectors = new ReplitConnectors();
    const sheetTitle = await ensureLiveActivitySheet(connectors);
    const rows = await readLiveActivityRows(connectors, sheetTitle);
    const parsedRows: Array<{ rowNumber: number; event: ParsedSheetEvent }> = [];
    const seenEventIds = new Set<string>();
    const duplicateEventIds = new Set<string>();
    let invalidRows = 0;

    for (const [index, row] of rows.slice(1).entries()) {
      const parsed = parseSheetEvent(row);
      if (!parsed && row.some((value) => String(value ?? "").trim() !== "")) {
        invalidRows += 1;
      }
      if (parsed) {
        if (seenEventIds.has(parsed.eventId)) duplicateEventIds.add(parsed.eventId);
        seenEventIds.add(parsed.eventId);
        parsedRows.push({ rowNumber: index + 2, event: parsed });
      }
    }

    if (invalidRows > 0) {
      throw new LiveActivitySyncError(
        `${invalidRows} live activity row(s) have invalid values. Correct them in the Live Activity tab.`,
      );
    }
    if (duplicateEventIds.size > 0) {
      throw new LiveActivitySyncError(
        `${duplicateEventIds.size} duplicate live activity event ID(s) were found. Correct the Live Activity tab before syncing.`,
      );
    }

    const dbEvents = await tx.select().from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId));
    const dbByEventId = new Map(dbEvents.map((event) => [event.eventId, event]));
    const sheetRowsByEventId = new Map<
      string,
      { rowNumber: number; event: ParsedSheetEvent }
    >();
    const conflicts: string[] = [];

    for (const row of parsedRows) {
      const { event: parsed } = row;
      sheetRowsByEventId.set(parsed.eventId, row);
      const existing = dbByEventId.get(parsed.eventId);
      if (!existing) {
        await tx.insert(liveActivityEvents).values({
          clubId,
          eventId: parsed.eventId,
          sessionKey: parsed.sessionKey,
          sessionDate: parsed.sessionDate,
          memberName: parsed.memberName,
          action: parsed.action,
          amountCents: parsed.amountCents,
          occurredAt: parsed.occurredAt,
          createdBy: parsed.createdBy,
          createdAt: parsed.createdAt,
          updatedBy: parsed.updatedBy,
          updatedAt: parsed.updatedAt,
          deletedAt: parsed.deletedAt,
          deletedBy: parsed.deletedBy,
          revision: parsed.revision,
          comment: parsed.comment,
          sheetHash: parsed.sheetHash,
        });
      } else if (existing.sheetHash === null && existing.sheetHash !== parsed.sheetHash) {
        // A null hash marks an app write that still needs to reach the sheet.
        // Keep the local revision authoritative only when the app explicitly
        // requested a write. A plain refresh surfaces the unresolved conflict.
        if (!options.preferLocal) conflicts.push(parsed.eventId);
      } else if (existing.sheetHash !== parsed.sheetHash) {
        await tx
          .update(liveActivityEvents)
          .set({
            sessionKey: parsed.sessionKey,
            sessionDate: parsed.sessionDate,
            memberName: parsed.memberName,
            action: parsed.action,
            amountCents: parsed.amountCents,
            occurredAt: parsed.occurredAt,
            createdBy: parsed.createdBy,
            createdAt: parsed.createdAt,
            updatedBy: parsed.updatedBy,
            updatedAt: parsed.updatedAt,
            deletedAt: parsed.deletedAt,
            deletedBy: parsed.deletedBy,
            revision: parsed.revision,
            comment: parsed.comment,
            sheetHash: parsed.sheetHash,
          })
          .where(
            and(
              eq(liveActivityEvents.eventId, parsed.eventId),
              eq(liveActivityEvents.revision, existing.revision),
              eq(liveActivityEvents.sheetHash, existing.sheetHash),
            ),
          );
      }
    }

    let nextRowNumber = rows.length + 1;
    for (const event of dbEvents) {
      const row = rowForEvent({ ...event, action: event.action as LiveActivityAction });
      const parsedEvent = {
        eventId: event.eventId,
        sessionKey: event.sessionKey,
        sessionDate: event.sessionDate,
        memberName: event.memberName,
        action: event.action as LiveActivityAction,
        amountCents: event.amountCents,
        occurredAt: event.occurredAt,
        createdBy: event.createdBy,
        createdAt: event.createdAt,
        updatedBy: event.updatedBy,
        updatedAt: event.updatedAt,
        deletedAt: event.deletedAt,
        revision: event.revision,
        comment: event.comment,
      };
      const expectedHash = rowHash(parsedEvent);
      const sheetRow = sheetRowsByEventId.get(event.eventId);
      if (!sheetRow) {
        await writeLiveActivityRow(connectors, sheetTitle, nextRowNumber++, row);
        await tx
          .update(liveActivityEvents)
          .set({ sheetHash: expectedHash })
          .where(
            and(
              eq(liveActivityEvents.eventId, event.eventId),
              eq(liveActivityEvents.revision, event.revision),
            ),
          );
      } else if (
        event.sheetHash === null &&
        (options.preferLocal || !conflicts.includes(event.eventId))
      ) {
        await writeLiveActivityRow(connectors, sheetTitle, sheetRow.rowNumber, row);
        await tx
          .update(liveActivityEvents)
          .set({ sheetHash: expectedHash })
          .where(
            and(
              eq(liveActivityEvents.eventId, event.eventId),
              eq(liveActivityEvents.revision, event.revision),
            ),
          );
      }
    }

    if (conflicts.length > 0) {
      throw new LiveActivitySyncError(
        `Unresolved sheet edit for ${conflicts.length} live activity row(s). Edit the entry in the app to choose the correct value.`,
      );
    }

    return new Date().toISOString();
  });
}

async function runLiveActivitySheetSync(): Promise<string> {
  if (!isProductionLiveActivityEnvironment()) return new Date().toISOString();
  if (sheetSyncPromise) {
    sheetSyncRequestedWhileRunning = true;
    return sheetSyncPromise;
  }

  sheetSyncPromise = syncLiveActivitySheet({ preferLocal: true })
    .then((syncedAt) => {
      sheetSyncError = null;
      sheetSyncedAt = syncedAt;
      logger.info({ syncedAt }, "Live activity sheet backup synchronized");
      return syncedAt;
    })
    .catch((error: unknown) => {
      sheetSyncError =
        error instanceof Error ? error.message : "Google Sheets backup is unavailable.";
      logger.warn({ err: error }, "Live activity sheet backup failed");
      throw error;
    })
    .finally(() => {
      sheetSyncPromise = null;
      if (sheetSyncRequestedWhileRunning) {
        sheetSyncRequestedWhileRunning = false;
        scheduleLiveActivitySheetSync();
      }
    });

  return sheetSyncPromise;
}

function scheduleLiveActivitySheetSync(): void {
  if (!isProductionLiveActivityEnvironment()) return;
  void runLiveActivitySheetSync().catch(() => undefined);
}

export function startLiveActivitySheetSync(): void {
  if (!isProductionLiveActivityEnvironment()) return;
  scheduleLiveActivitySheetSync();
  const retryTimer = setInterval(scheduleLiveActivitySheetSync, 60_000);
  retryTimer.unref();
}

export class LiveActivityResetConflictError extends Error {
  constructor() {
    super("The live ledger changed after the backup was created. Download a fresh backup before resetting.");
    this.name = "LiveActivityResetConflictError";
  }
}

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

/** The production sheet mirrors one club's ledger only: the original (default) club. */
async function usesLiveActivitySheet(clubId: number): Promise<boolean> {
  if (!isProductionLiveActivityEnvironment()) return false;
  const original = await getDefaultClubId();
  return original !== null && clubId === original;
}

export async function getLiveActivityResetBackup(clubId: number) {
  const environment = isProductionLiveActivityEnvironment()
    ? ("production" as const)
    : ("development" as const);
  const [sessionRows, eventRows, commentRows] = await Promise.all([
    db.select().from(liveSessions).where(eq(liveSessions.clubId, clubId)).orderBy(asc(liveSessions.id)),
    db.select().from(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId)).orderBy(asc(liveActivityEvents.id)),
    db
      .select()
      .from(liveActivityEventComments)
      .where(inArray(liveActivityEventComments.eventId, clubEventIds(clubId)))
      .orderBy(asc(liveActivityEventComments.id)),
  ]);

  let sheetRows: string[][] = [];
  if (await usesLiveActivitySheet(clubId)) {
    const connectors = new ReplitConnectors();
    const sheetTitle = await ensureLiveActivitySheet(connectors);
    const values = await readLiveActivityRows(connectors, sheetTitle);
    sheetRows = values.map((row) =>
      Array.from({ length: 15 }, (_, index) => String(row[index] ?? "")),
    );
  }

  return buildLiveActivityResetBackup(
    sessionRows,
    eventRows,
    commentRows,
    environment,
    sheetRows,
  );
}

export async function resetLiveActivityLedger(backupId: string, clubId: number) {
  if (!/^[0-9a-f]{64}$/.test(backupId)) {
    throw new LiveActivityResetConflictError();
  }

  const environment = isProductionLiveActivityEnvironment()
    ? ("production" as const)
    : ("development" as const);
  const connectors = (await usesLiveActivitySheet(clubId)) ? new ReplitConnectors() : null;
  let sheetTitle: string | null = null;
  let sheetRowsBeforeReset: string[][] = [];
  let sheetWasCleared = false;

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(0, hashtext('monash-live-session'))`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(0, hashtext(${LIVE_ACTIVITY_SHEET_LOCK_NAME}))`,
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
      let sheetRows: string[][] = [];
      if (environment === "production" && connectors) {
        const currentSheetTitle = await ensureLiveActivitySheet(connectors);
        const values = await readLiveActivityRows(connectors, currentSheetTitle);
        sheetRows = values.map((row) =>
          Array.from({ length: 15 }, (_, index) => String(row[index] ?? "")),
        );
      }
      const backup = buildLiveActivityResetBackup(
        sessionRows,
        eventRows,
        commentRows,
        environment,
        sheetRows,
      );
      if (backup.backupId !== backupId) {
        throw new LiveActivityResetConflictError();
      }

      sheetRowsBeforeReset = backup.sheetRows;
      if (environment === "production" && connectors) {
        sheetTitle = LIVE_ACTIVITY_SHEET_TITLE;
        await clearLiveActivityRows(connectors, sheetTitle);
        sheetWasCleared = true;
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
  } catch (error) {
    if (sheetWasCleared && connectors && sheetTitle) {
      try {
        await restoreLiveActivityRows(connectors, sheetTitle, sheetRowsBeforeReset);
      } catch (restoreError) {
        logger.error(
          { err: restoreError },
          "Live Activity sheet could not be restored after a failed ledger reset",
        );
        throw new Error(
          "The database reset did not complete, and automatic sheet restoration failed. Use the downloaded backup to restore the Live Activity sheet before retrying.",
        );
      }
    }
    throw error;
  }
}

export async function retryLiveActivitySheetSync(clubId: number): Promise<LiveActivitySnapshot> {
  try {
    await runLiveActivitySheetSync();
  } catch {
    // The database-backed ledger remains available when the sheet mirror fails.
  }
  return getLiveActivitySnapshot(clubId);
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
  const hasPendingChanges = events.some((event) => event.sheetHash === null);
  const syncStatus: LiveSyncStatus = sheetSyncError
    ? "error"
    : hasPendingChanges || !sheetSyncedAt
      ? "pending"
      : "synced";

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
    syncStatus,
    syncMessage:
      sheetSyncError ??
      (syncStatus === "pending"
        ? "Saved to the live ledger; the Google Sheets backup is pending."
        : null),
    lastSyncedAt: sheetSyncedAt,
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

  const environment = isProductionLiveActivityEnvironment()
    ? ("production" as const)
    : ("development" as const);
  const sheetBacked = await usesLiveActivitySheet(clubId);
  const connectors = sheetBacked ? new ReplitConnectors() : null;
  const sheetRollback = createLiveActivitySheetRollbackGuard((restoreError) => {
    logger.error(
      { err: restoreError, sessionKey },
      "Unable to restore Live Activity rows after a failed session deletion",
    );
  });

  return sheetRollback.run(() =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(0, hashtext('monash-live-session'))`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(0, hashtext(${LIVE_ACTIVITY_SHEET_LOCK_NAME}))`,
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

      let sheetRows: string[][] = [];
      let sheetTitle: string | null = null;
      if (environment === "production" && connectors) {
        sheetTitle = await ensureLiveActivitySheet(connectors);
        const values = await readLiveActivityRows(connectors, sheetTitle);
        sheetRows = values.map((row) =>
          Array.from({ length: 15 }, (_, index) => String(row[index] ?? "")),
        );
      }

      const backup = buildLiveActivityResetBackup(
        sessionRows,
        eventRows,
        commentRows,
        environment,
        sheetRows,
      );
      const sessionEvents = eventRows.filter((event) => event.sessionKey === sessionKey);
      const eventIds = new Set(sessionEvents.map((event) => event.eventId));
      const sessionComments = commentRows.filter((comment) => eventIds.has(comment.eventId));
      const { clearedSheetRows } = await deleteLiveActivitySessionSafely({
        session,
        backupId,
        currentBackupId: backup.backupId,
        environment: sheetBacked ? environment : ("development" as const),
        rows: backup.sheetRows,
        sessionKey,
        eventIds,
        selectRanges: liveLedgerSheetRowRangesForSession,
        onMutationStarted: () => {
          if (!connectors || !sheetTitle) {
            throw new Error("The production Live Activity sheet is unavailable.");
          }
          sheetRollback.markMutationStarted(backup.sheetRows, (rows) =>
            restoreLiveActivityRows(connectors, sheetTitle!, rows),
          );
        },
        clearRanges: async (ranges) => {
          if (!connectors || !sheetTitle) {
            throw new Error("The production Live Activity sheet is unavailable.");
          }
          const sheetRanges = ranges.map(
            ([startRow, endRow]) => `A${startRow}:N${endRow}`,
          );
          await clearLiveActivitySheetRanges(connectors, sheetTitle, sheetRanges);
        },
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
    }),
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

  if (result.created) scheduleLiveActivitySheetSync();
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

  scheduleLiveActivitySheetSync();
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

  scheduleLiveActivitySheetSync();
  return snapshotForSession(session);
}

export async function startLiveSession(memberName: string, clubId: number): Promise<LiveActivitySnapshot> {
  const sessionDate = liveLedgerSessionDate(new Date(), await clubTimezone(clubId));
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(0, hashtext('monash-live-session'))`);
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

  scheduleLiveActivitySheetSync();
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
    scheduleLiveActivitySheetSync();
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