// Links from a club's old website arrive as /join/<code>?from=<old-site>&next=live.
// "from" asks for a one-time "this club lives here now" card; "next=live" opens the live ledger after joining
// (old printed QR codes). Only these two values are read, so the join page can never redirect elsewhere.

const MOVED_KEY = "moved-from";
const FROM_PATTERN = /^[a-z0-9-]{1,40}$/;

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function movedFromParam(search: string): string | null {
  const value = new URLSearchParams(search).get("from")?.trim().toLowerCase() ?? "";
  return FROM_PATTERN.test(value) ? value : null;
}

/** Where to go once the person is in the club. */
export function afterJoinPath(search: string): string {
  return new URLSearchParams(search).get("next") === "live" ? "/dashboard?view=live" : "/dashboard";
}

/** The part of the join link worth keeping through sign-up (email confirmation, Google), as "?…" or "". */
export function joinCarrySearch(search: string): string {
  const params = new URLSearchParams();
  const from = movedFromParam(search);
  if (from) params.set("from", from);
  if (new URLSearchParams(search).get("next") === "live") params.set("next", "live");
  const text = params.toString();
  return text ? `?${text}` : "";
}

function defaultStore(): KeyStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberMovedFrom(from: string, store: KeyStore | null = defaultStore()): void {
  try {
    store?.setItem(MOVED_KEY, from);
  } catch {
    // Storage blocked: the card just won't show.
  }
}

export function readMovedFrom(store: KeyStore | null = defaultStore()): string | null {
  try {
    const value = store?.getItem(MOVED_KEY) ?? "";
    return FROM_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearMovedFrom(store: KeyStore | null = defaultStore()): void {
  try {
    store?.removeItem(MOVED_KEY);
  } catch {
    // Nothing to clear.
  }
}
