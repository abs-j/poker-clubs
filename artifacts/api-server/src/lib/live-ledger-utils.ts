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

/**
 * The date a night is started for. Empty means tonight. A past date is fine (catching up a night after the fact);
 * a future date or something that is not a real calendar day is refused.
 */
export function chooseLedgerDate(raw: unknown, today: string): { date: string } | { error: string } {
  if (raw === undefined || raw === null || raw === "") return { date: today };
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "Choose the date of the night." };
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return { error: "That is not a real date." };
  if (raw > today) return { error: "A night cannot be in the future." };
  if (raw < "2000-01-01") return { error: "That date is too far back." };
  return { date: raw };
}

export type NotesPlayer = { name: string; buyInCents: number; cashOutCents: number };

/**
 * Checks the players read from someone's notes before they become ledger entries. A name listed twice is one
 * person with more money in or out; a player with no money at all is dropped.
 */
export function cleanNotesPlayers(raw: unknown): { players: NotesPlayer[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Add at least one player with a buy-in or cash-out." };
  if (raw.length > 100) return { error: "That is more than 100 players for one night." };
  const merged = new Map<string, NotesPlayer>();
  for (const row of raw) {
    const entry = (row ?? {}) as { name?: unknown; buyIn?: unknown; cashOut?: unknown };
    const name = typeof entry.name === "string" ? entry.name.trim().replace(/\s+/g, " ") : "";
    if (!name) continue;
    const buyIn = entry.buyIn === undefined || entry.buyIn === "" ? 0 : Number(entry.buyIn);
    const cashOut = entry.cashOut === undefined || entry.cashOut === "" ? 0 : Number(entry.cashOut);
    if (name.length > 80 || !Number.isFinite(buyIn) || !Number.isFinite(cashOut) || buyIn < 0 || cashOut < 0 || buyIn > 100_000 || cashOut > 100_000) {
      return { error: `Check the amounts for ${name || "a player"}.` };
    }
    const key = name.toLocaleLowerCase();
    const existing = merged.get(key);
    const buyInCents = Math.round(buyIn * 100);
    const cashOutCents = Math.round(cashOut * 100);
    if (existing) {
      existing.buyInCents += buyInCents;
      existing.cashOutCents += cashOutCents;
    } else {
      merged.set(key, { name, buyInCents, cashOutCents });
    }
  }
  const players = [...merged.values()].filter((player) => player.buyInCents > 0 || player.cashOutCents > 0);
  return players.length > 0 ? { players } : { error: "Add at least one player with a buy-in or cash-out." };
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