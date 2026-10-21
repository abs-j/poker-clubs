export class LiveActivitySessionDeleteConflictError extends Error {
  constructor() {
    super("The live ledger changed after the backup was downloaded. Download a fresh backup before deleting this session.");
    this.name = "LiveActivitySessionDeleteConflictError";
  }
}

export class LiveActivitySessionNotFoundError extends Error {
  constructor() {
    super("The closed live ledger session was not found.");
    this.name = "LiveActivitySessionNotFoundError";
  }
}

export class LiveActivitySessionNotClosedError extends Error {
  constructor() {
    super("Only closed live ledger sessions can be deleted.");
    this.name = "LiveActivitySessionNotClosedError";
  }
}

export function assertValidLiveActivityDeleteBackupId(backupId: string): void {
  if (!/^[0-9a-f]{64}$/.test(backupId)) {
    throw new LiveActivitySessionDeleteConflictError();
  }
}

export function assertLiveActivitySessionIsClosed(
  session: { status: string } | null | undefined,
): asserts session is { status: string } {
  if (!session) throw new LiveActivitySessionNotFoundError();
  if (session.status !== "ended") throw new LiveActivitySessionNotClosedError();
}

export function assertLiveActivityDeleteBackupIsFresh(
  requestedBackupId: string,
  currentBackupId: string,
): void {
  if (requestedBackupId !== currentBackupId) {
    throw new LiveActivitySessionDeleteConflictError();
  }
}

export type LiveActivitySheetRollbackGuard = {
  markMutationStarted(
    rows: readonly string[][],
    restoreRows: (rows: string[][]) => Promise<void>,
  ): void;
  run<T>(operation: () => Promise<T>): Promise<T>;
};

export function createLiveActivitySheetRollbackGuard(
  onRestoreFailure: (error: unknown) => void,
): LiveActivitySheetRollbackGuard {
  let restoreSnapshot: (() => Promise<void>) | undefined;

  return {
    markMutationStarted(rows, restoreRows) {
      const snapshot = rows.map((row) => [...row]);
      restoreSnapshot = () => restoreRows(snapshot);
    },
    async run<T>(operation: () => Promise<T>) {
      try {
        return await operation();
      } catch (error) {
        if (restoreSnapshot) {
          try {
            await restoreSnapshot();
          } catch (restoreError) {
            onRestoreFailure(restoreError);
          }
        }
        throw error;
      }
    },
  };
}

export async function clearLiveActivitySessionSheetRows(options: {
  environment: "development" | "production";
  rows: string[][];
  sessionKey: string;
  eventIds: ReadonlySet<string>;
  selectRanges: (
    rows: unknown[][],
    sessionKey: string,
    eventIds: ReadonlySet<string>,
  ) => Array<[number, number]>;
  onMutationStarted: () => void;
  clearRanges: (ranges: Array<[number, number]>) => Promise<void>;
}): Promise<number> {
  if (options.environment !== "production") return 0;

  const ranges = options.selectRanges(
    options.rows,
    options.sessionKey,
    options.eventIds,
  );
  if (ranges.length === 0) return 0;

  // Set the restoration point before the request: Sheets may apply a clear and
  // then fail to return a valid response.
  options.onMutationStarted();
  await options.clearRanges(ranges);

  return ranges.reduce(
    (count, [startRow, endRow]) => count + endRow - startRow + 1,
    0,
  );
}

export async function deleteLiveActivitySessionSafely<T>(options: {
  session: { status: string } | null | undefined;
  backupId: string;
  currentBackupId: string;
  environment: "development" | "production";
  rows: string[][];
  sessionKey: string;
  eventIds: ReadonlySet<string>;
  selectRanges: (
    rows: unknown[][],
    sessionKey: string,
    eventIds: ReadonlySet<string>,
  ) => Array<[number, number]>;
  onMutationStarted: () => void;
  clearRanges: (ranges: Array<[number, number]>) => Promise<void>;
  deleteEvents: (eventIds: ReadonlySet<string>) => Promise<void>;
  deleteSession: (sessionKey: string) => Promise<void>;
}): Promise<{ clearedSheetRows: number }> {
  assertValidLiveActivityDeleteBackupId(options.backupId);
  assertLiveActivitySessionIsClosed(options.session);
  assertLiveActivityDeleteBackupIsFresh(options.backupId, options.currentBackupId);

  const clearedSheetRows = await clearLiveActivitySessionSheetRows({
    environment: options.environment,
    rows: options.rows,
    sessionKey: options.sessionKey,
    eventIds: options.eventIds,
    selectRanges: options.selectRanges,
    onMutationStarted: options.onMutationStarted,
    clearRanges: options.clearRanges,
  });
  if (options.eventIds.size > 0) {
    await options.deleteEvents(options.eventIds);
  }
  await options.deleteSession(options.sessionKey);

  return { clearedSheetRows };
}