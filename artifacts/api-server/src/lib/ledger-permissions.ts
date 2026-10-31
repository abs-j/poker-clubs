// Who may change a night. Names match nameKey in club-access.ts (trim, collapse spaces, lower-case).
// Kept local so this module does not open the database and its tests can run on their own.

export type LedgerActor = { name: string; isAdmin: boolean };

export class LedgerPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerPermissionError";
  }
}

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function samePerson(a: string, b: string): boolean {
  const left = nameKey(a);
  const right = nameKey(b);
  return left.length > 0 && left === right;
}

/** The night's host: an explicit hand-over, otherwise whoever started it. */
export function hostOf(session: { hostName?: string | null; startedBy: string }): string {
  const named = session.hostName?.trim();
  return named || session.startedBy;
}

/** Close, discard, hand over, reopen, and the balance choice: the host or an admin. */
export function canManageNight(actor: LedgerActor, hostName: string): boolean {
  return actor.isAdmin || samePerson(actor.name, hostName);
}

/** Edit or delete one entry: whoever logged it, the host, or an admin. */
export function canEditEntry(actor: LedgerActor, hostName: string, createdBy: string): boolean {
  return canManageNight(actor, hostName) || samePerson(actor.name, createdBy);
}

/** Tick or untick who has settled: the host, the bank, or an admin. */
export function canSettle(actor: LedgerActor, hostName: string, bankName: string | null | undefined): boolean {
  return canManageNight(actor, hostName) || (!!bankName && samePerson(actor.name, bankName));
}
