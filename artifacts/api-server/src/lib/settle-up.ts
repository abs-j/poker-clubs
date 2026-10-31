// Settle-up maths for a night: who owes, who is owed, and what is still open. Pure, so it can be tested on its own.
// Names are compared the way ledger-permissions.ts does (trim, collapse spaces, lower-case).

export type NightResult = { playerId: number; name: string; netCents: number };
export type SettledMark = { settledAt: Date; settledBy: string };

export type SettleLine = {
  playerId: number;
  name: string;
  /** Cash-out minus buy-in. Negative means the player pays in, positive means they are paid. */
  netCents: number;
  /** A player who broke even has nothing to settle and counts as settled. */
  settled: boolean;
  settledAt: string | null;
  settledBy: string | null;
};

export type NightSettlementState = "none" | "open" | "partial" | "settled";

const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function settleLines(results: NightResult[], marks: Map<number, SettledMark>): SettleLine[] {
  return results
    .map((result) => {
      const mark = marks.get(result.playerId);
      return {
        playerId: result.playerId,
        name: result.name,
        netCents: result.netCents,
        settled: result.netCents === 0 || !!mark,
        settledAt: mark ? mark.settledAt.toISOString() : null,
        settledBy: mark ? mark.settledBy : null,
      };
    })
    .sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name));
}

/** "none": nobody owes anything. "open": nothing ticked. "partial": some ticked. "settled": everyone with a balance ticked. */
export function nightState(lines: SettleLine[]): NightSettlementState {
  const owing = lines.filter((line) => line.netCents !== 0);
  if (owing.length === 0) return "none";
  const done = owing.filter((line) => line.settled).length;
  if (done === owing.length) return "settled";
  return done === 0 ? "open" : "partial";
}

export type MineEntry = { nightId: number; date: string; cents: number; bank: string | null };

/** What one person still owes or is still owed across tracked nights, newest night first. */
export function mineUnsettled(
  nights: Array<{ nightId: number; date: string; bank: string | null; lines: SettleLine[] }>,
  viewer: string,
): { owe: MineEntry[]; owed: MineEntry[]; oweCents: number; owedCents: number } {
  const key = nameKey(viewer);
  const owe: MineEntry[] = [];
  const owed: MineEntry[] = [];
  if (key) {
    for (const night of nights) {
      const line = night.lines.find((candidate) => nameKey(candidate.name) === key);
      if (!line || line.settled || line.netCents === 0) continue;
      const entry = { nightId: night.nightId, date: night.date, cents: Math.abs(line.netCents), bank: night.bank };
      (line.netCents < 0 ? owe : owed).push(entry);
    }
  }
  const newest = (a: MineEntry, b: MineEntry) => b.date.localeCompare(a.date) || b.nightId - a.nightId;
  owe.sort(newest);
  owed.sort(newest);
  return {
    owe,
    owed,
    oweCents: owe.reduce((sum, entry) => sum + entry.cents, 0),
    owedCents: owed.reduce((sum, entry) => sum + entry.cents, 0),
  };
}
