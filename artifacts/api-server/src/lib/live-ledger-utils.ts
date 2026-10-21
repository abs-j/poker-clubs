export type LedgerBalanceEntry = {
  action: string;
  amountCents: number;
};

export type LiveLedgerTotals = {
  buyInsCents: number;
  cashOutsCents: number;
  differenceCents: number;
  balanceStatus: "balanced" | "unbalanced";
};

export type LivePlayerLedgerEntry = {
  sessionKey: string;
  memberName: string;
  action: string;
  amountCents: number;
  deleted: boolean;
};

export type LivePlayerLedgerTotals = {
  playerName: string;
  buyInsCents: number;
  cashOutsCents: number;
};

export const LIVE_LEDGER_TIME_ZONE = "Australia/Melbourne";

/** The calendar date of "tonight" in a club's timezone (Melbourne unless told otherwise). */
export function liveLedgerSessionDate(value = new Date(), timeZone = LIVE_LEDGER_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatLiveLedgerTimestamp(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LIVE_LEDGER_TIME_ZONE,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const offset = values.timeZoneName === "GMT"
    ? "+00:00"
    : values.timeZoneName.replace(/^GMT/, "");
  if (!/^[+-]\d{2}:\d{2}$/.test(offset)) {
    throw new Error("Unable to determine the Melbourne timezone offset.");
  }
  const milliseconds = String(value.getUTCMilliseconds()).padStart(3, "0");
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}.${milliseconds}${offset}`;
}

export function parseMelbourneTimestamp(value: string): Date | null {
  const match = value.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i,
  );
  if (!match) return null;

  const [, rawDay, rawMonth, rawYear, rawHour = "0", rawMinute = "0", rawSecond = "0", meridiem] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  let hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const requestedWallTime = Date.UTC(year, month - 1, day, hour, minute, second);
  const dateCheck = new Date(requestedWallTime);
  if (
    dateCheck.getUTCFullYear() !== year ||
    dateCheck.getUTCMonth() !== month - 1 ||
    dateCheck.getUTCDate() !== day
  ) {
    return null;
  }

  const formatParts = (date: Date) => Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: LIVE_LEDGER_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const probeParts = formatParts(new Date(requestedWallTime));
  const melbourneAsUtc = Date.UTC(
    Number(probeParts.year),
    Number(probeParts.month) - 1,
    Number(probeParts.day),
    Number(probeParts.hour),
    Number(probeParts.minute),
    Number(probeParts.second),
  );
  const offsetMilliseconds = melbourneAsUtc - requestedWallTime;
  const result = new Date(requestedWallTime - offsetMilliseconds);
  const resultParts = formatParts(result);

  if (
    Number(resultParts.year) !== year ||
    Number(resultParts.month) !== month ||
    Number(resultParts.day) !== day ||
    Number(resultParts.hour) !== hour ||
    Number(resultParts.minute) !== minute ||
    Number(resultParts.second) !== second
  ) {
    return null;
  }
  return result;
}

export function resolveCurrentLiveSession<T>(
  openSession: T | null,
  sessionForToday: T | null,
): T | null {
  return openSession ?? sessionForToday;
}

export function calculateLivePlayerTotals(
  entries: LivePlayerLedgerEntry[],
  sessionKey: string,
): LivePlayerLedgerTotals[] {
  const totalsByPlayer = new Map<string, LivePlayerLedgerTotals>();

  for (const entry of entries) {
    if (entry.sessionKey !== sessionKey || entry.deleted) continue;

    const playerName = entry.memberName.trim().replace(/\s+/g, " ");
    if (!playerName) throw new Error("A live ledger player name cannot be empty.");
    const playerKey = playerName.toLocaleLowerCase();
    const totals = totalsByPlayer.get(playerKey) ?? {
      playerName,
      buyInsCents: 0,
      cashOutsCents: 0,
    };

    if (entry.action === "buy_in") {
      totals.buyInsCents += entry.amountCents;
    } else if (entry.action === "cash_out") {
      totals.cashOutsCents += entry.amountCents;
    } else {
      throw new Error(`Unknown live ledger action: ${entry.action}`);
    }

    totalsByPlayer.set(playerKey, totals);
  }

  return [...totalsByPlayer.values()].sort((left, right) =>
    left.playerName.localeCompare(right.playerName),
  );
}

export function shouldDiscardEmptyLiveSession(
  activityRows: readonly { deletedAt: Date | null }[],
): boolean {
  return activityRows.length === 0;
}

export function normalizeGoogleSheetsDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text
      ? text
      : null;
  }

  const serialText = typeof value === "number" ? String(value) : text;
  if (!/^\d+(?:\.\d+)?$/.test(serialText)) return null;
  const serial = Number(serialText);
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;

  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function calculateLiveLedgerTotals(
  entries: LedgerBalanceEntry[],
): LiveLedgerTotals {
  let buyInsCents = 0;
  let cashOutsCents = 0;

  for (const entry of entries) {
    if (entry.action === "buy_in") {
      buyInsCents += entry.amountCents;
    } else if (entry.action === "cash_out") {
      cashOutsCents += entry.amountCents;
    } else {
      throw new Error(`Unknown live ledger action: ${entry.action}`);
    }
  }

  const differenceCents = buyInsCents - cashOutsCents;
  return {
    buyInsCents,
    cashOutsCents,
    differenceCents,
    balanceStatus: Math.abs(differenceCents) < 1 ? "balanced" : "unbalanced",
  };
}

export function liveLedgerSheetRowRangesForSession(
  rows: unknown[][],
  sessionKey: string,
  eventIds: ReadonlySet<string>,
): Array<[number, number]> {
  const rowNumbers = rows.slice(1).flatMap((row, index) => {
    const rowEventId = String(row[0] ?? "").trim();
    const rowSessionKey = String(row[1] ?? "").trim();
    return rowSessionKey === sessionKey || (rowEventId && eventIds.has(rowEventId))
      ? [index + 2]
      : [];
  });
  const ranges: Array<[number, number]> = [];

  for (const rowNumber of rowNumbers) {
    const previousRange = ranges.at(-1);
    if (previousRange && previousRange[1] === rowNumber - 1) {
      previousRange[1] = rowNumber;
    } else {
      ranges.push([rowNumber, rowNumber]);
    }
  }

  return ranges;
}