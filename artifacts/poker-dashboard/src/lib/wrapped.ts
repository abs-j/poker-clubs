// When Poker Wrapped may pop up.
// Dismissals live in localStorage. The dev date override is applied by the caller
// only when the build is a dev build; this module just honours the flag it is given.

import { normalizeName } from "./club-charts.ts";

export const WRAPPED_DISMISSED_KEY = "pc.wrappedDismissed.v1";

/** Above the player selector (80), toasts (100) and the bottom tab bar (40). */
export const WRAPPED_Z_INDEX = 200;

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function calendarMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthTitle(key: string): string {
  const match = MONTH_KEY.exec(key);
  if (!match) return key;
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** Noon local time, or null when the string is not a real calendar day. */
export function parseLocalDate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * The clock Wrapped uses. `asOf=YYYY-MM-DD` is honoured only when `isDev` is true.
 * Production callers pass false and always get `now`.
 */
export function resolveAsOf(search: string, isDev: boolean, now = new Date()): Date {
  if (!isDev) return now;
  const value = new URLSearchParams(search).get("asOf");
  if (!value) return now;
  return parseLocalDate(value) ?? now;
}

/** Months that appear in the dates and are strictly before the local calendar month of `asOf`. Newest first. */
export function completedMonthKeys(dates: readonly string[], asOf: Date): string[] {
  const current = calendarMonthKey(asOf);
  const keys = new Set<string>();
  for (const date of dates) {
    const key = date.slice(0, 7);
    if (MONTH_KEY.test(key) && key < current) keys.add(key);
  }
  return [...keys].sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
}

export type DismissedMap = Record<string, string[]>;

export function readDismissedMap(raw: string | null): DismissedMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: DismissedMap = {};
    for (const [member, months] of Object.entries(parsed)) {
      if (!Array.isArray(months)) continue;
      const kept = months.filter((month): month is string => typeof month === "string" && MONTH_KEY.test(month));
      if (kept.length) map[member] = kept;
    }
    return map;
  } catch {
    return {};
  }
}

export function dismissedFor(map: DismissedMap, member: string): string[] {
  return map[normalizeName(member)] ?? [];
}

export function dismissMonth(months: readonly string[], month: string): string[] {
  if (!MONTH_KEY.test(month) || months.includes(month)) return [...months];
  return [...months, month];
}

export function loadDismissed(member: string): string[] {
  try {
    return dismissedFor(readDismissedMap(window.localStorage.getItem(WRAPPED_DISMISSED_KEY)), member);
  } catch {
    return [];
  }
}

export function saveDismissed(member: string, months: readonly string[]): void {
  try {
    const map = readDismissedMap(window.localStorage.getItem(WRAPPED_DISMISSED_KEY));
    const key = normalizeName(member);
    const next = months.filter((month) => MONTH_KEY.test(month));
    if (next.length) map[key] = next;
    else delete map[key];
    window.localStorage.setItem(WRAPPED_DISMISSED_KEY, JSON.stringify(map));
  } catch {
    // The popup may appear again on this device. That is safer than a server write.
  }
}
