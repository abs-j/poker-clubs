// Small per-device settings. Storage can be blocked, so every call is wrapped and falls back.

const BADGE_POPUPS_KEY = "pref:badge-popups";

export function getBadgePopups(): boolean {
  try {
    return window.localStorage.getItem(BADGE_POPUPS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setBadgePopups(enabled: boolean): void {
  try {
    window.localStorage.setItem(BADGE_POPUPS_KEY, enabled ? "on" : "off");
  } catch {
    // Not saved; the switch still works for this visit.
  }
}

const VISITS_KEY = "pref:visits";
const VISIT_COUNTED_KEY = "pref:visit-counted";

/** Counts this browser session once and returns how many sessions this device has had. */
export function recordVisit(): number {
  try {
    const current = Number(window.localStorage.getItem(VISITS_KEY)) || 0;
    if (window.sessionStorage.getItem(VISIT_COUNTED_KEY)) return current;
    window.sessionStorage.setItem(VISIT_COUNTED_KEY, "1");
    window.localStorage.setItem(VISITS_KEY, String(current + 1));
    return current + 1;
  } catch {
    return 0;
  }
}
