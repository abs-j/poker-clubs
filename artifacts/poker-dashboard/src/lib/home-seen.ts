// Whether the "your last game" card on Home is still on its first viewing day.
// Flags live in localStorage, per club, per member and per device. Nothing is written to the server.

import { normalizeName } from "./club-charts.ts";

export const HOME_SEEN_KEY = "pc.homeSeen.v1";

export type SeenRecord = { id: string; day: string };

/** Keyed by "club scope + member". One remembered game each. */
export type SeenStore = Record<string, SeenRecord>;

/** Local calendar day, YYYY-MM-DD. Not UTC, so a late-night game is still "today" on the device. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const storeKey = (scope: string, member: string) => `${scope}|${normalizeName(member)}`;

export function readSeenStore(raw: string | null): SeenStore {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const store: SeenStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const { id, day } = value as { id?: unknown; day?: unknown };
      if (typeof id === "string" && id && typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) store[key] = { id, day };
    }
    return store;
  } catch {
    return {};
  }
}

export function seenRecord(store: SeenStore, scope: string, member: string): SeenRecord | null {
  return store[storeKey(scope, member)] ?? null;
}

/**
 * Visible when this id has never been seen, or was first seen earlier today.
 * A different id (a newer game) shows again. An empty id never shows.
 */
export function isFirstViewDay(record: SeenRecord | null, id: string, today: string): boolean {
  if (!id) return false;
  if (!record || record.id !== id) return true;
  return record.day === today;
}

/** Remember the first day this id was seen. A repeat view on a later day does not move that day. */
export function withSeen(store: SeenStore, scope: string, member: string, id: string, today: string): SeenStore {
  if (!id) return store;
  const key = storeKey(scope, member);
  if (store[key]?.id === id) return store;
  return { ...store, [key]: { id, day: today } };
}

/** Stable id for the "your last game" card. */
export function nightSeenId(last: { sessionNumber: number; date: string; isTournament: boolean; net: number }): string {
  return last.isTournament ? `tournament:${last.date}:${last.net}` : `cash:${last.sessionNumber}:${last.date}`;
}

export function loadHomeSeen(): SeenStore {
  try {
    return readSeenStore(window.localStorage.getItem(HOME_SEEN_KEY));
  } catch {
    return {};
  }
}

export function saveHomeSeen(store: SeenStore): void {
  try {
    window.localStorage.setItem(HOME_SEEN_KEY, JSON.stringify(store));
  } catch {
    // Storage blocked: the card stays visible next visit. Fail open.
  }
}
