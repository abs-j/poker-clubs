// A night balances when everyone's buy-ins equal everyone's cash-outs. When a ledger closes out by a
// few dollars, the admin picks what to do with the gap instead of letting it skew the leaderboard.

export type BalancePlayer = { name: string; buyInCents: number; cashOutCents: number };

/**
 * What to do with a gap at close time. Stored as the admin's intent, not an amount, so editing the
 * ledger afterwards never leaves a stale figure behind.
 * - jackpot: buy-ins exceed cash-outs; the surplus goes into the bad beat jackpot.
 * - player:  cash-outs exceed buy-ins; the shortfall comes off one player's cash-out.
 * - split:   cash-outs exceed buy-ins; the shortfall is shared across everyone who cashed out.
 * - none:    close anyway and leave the night out by the gap.
 */
export type BalanceResolution =
  | { mode: "jackpot" }
  | { mode: "player"; name: string }
  | { mode: "split" }
  | { mode: "none" };

export type Gap = { direction: "balanced" | "over" | "under"; cents: number };

const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** "over": money left on the table (buy-ins > cash-outs). "under": more paid out than put in. */
export function gapOf(players: BalancePlayer[]): Gap {
  const diff = players.reduce((sum, player) => sum + player.buyInCents - player.cashOutCents, 0);
  if (diff === 0) return { direction: "balanced", cents: 0 };
  return { direction: diff > 0 ? "over" : "under", cents: Math.abs(diff) };
}

export type BalanceOutcome = {
  players: BalancePlayer[];
  /** Added to the bad beat jackpot (never negative). */
  jackpotCents: number;
  /** Taken off players' cash-outs, with who paid how much. */
  deductions: Array<{ name: string; cents: number }>;
  /** What is still out after the resolution (0 when it fully balanced). */
  remainingCents: number;
};

/** Shares `total` cents across the players' cash-outs as evenly as possible, never taking more than a player has. */
function share(players: BalancePlayer[], total: number): Map<string, number> {
  const taken = new Map<string, number>();
  let left = total;
  let open = players.filter((player) => player.cashOutCents > 0);
  while (left > 0 && open.length > 0) {
    const each = Math.floor(left / open.length);
    const extra = left - each * open.length;
    let progressed = 0;
    open = open.filter((player, index) => {
      const room = player.cashOutCents - (taken.get(player.name) ?? 0);
      const want = each + (index < extra ? 1 : 0);
      const take = Math.min(room, want);
      taken.set(player.name, (taken.get(player.name) ?? 0) + take);
      progressed += take;
      return room - take > 0;
    });
    left -= progressed;
    if (progressed === 0) break;
  }
  return taken;
}

/**
 * Applies the admin's choice to a night. A resolution that no longer fits the gap (say it was chosen,
 * then the ledger was corrected) does nothing rather than guessing.
 */
export function resolveBalance(players: BalancePlayer[], resolution: BalanceResolution | null): BalanceOutcome {
  const gap = gapOf(players);
  const untouched: BalanceOutcome = { players, jackpotCents: 0, deductions: [], remainingCents: gap.cents };
  if (!resolution || resolution.mode === "none" || gap.direction === "balanced") return untouched;

  if (resolution.mode === "jackpot") {
    if (gap.direction !== "over") return untouched;
    return { players, jackpotCents: gap.cents, deductions: [], remainingCents: 0 };
  }
  if (gap.direction !== "under") return untouched;

  const taken =
    resolution.mode === "player"
      ? new Map(
          players
            .filter((player) => key(player.name) === key(resolution.name))
            .map((player) => [player.name, Math.min(player.cashOutCents, gap.cents)] as const),
        )
      : share(players, gap.cents);
  const deductions = [...taken.entries()].filter(([, cents]) => cents > 0).map(([name, cents]) => ({ name, cents }));
  const total = deductions.reduce((sum, row) => sum + row.cents, 0);
  const adjusted = players.map((player) => ({
    ...player,
    cashOutCents: player.cashOutCents - (taken.get(player.name) ?? 0),
  }));
  return { players: adjusted, jackpotCents: 0, deductions, remainingCents: gap.cents - total };
}

/** Whether a choice can be saved for this ledger, and if not why. */
export function checkResolution(players: BalancePlayer[], resolution: BalanceResolution): string | null {
  const gap = gapOf(players);
  if (resolution.mode === "none") return null;
  if (gap.direction === "balanced") return "This ledger is already balanced.";
  if (resolution.mode === "jackpot") return gap.direction === "over" ? null : "Only a surplus can go into the jackpot.";
  if (gap.direction !== "under") return "Only a shortfall can be taken from players.";
  if (resolution.mode === "split") {
    return resolveBalance(players, resolution).remainingCents === 0 ? null : "Not enough cash-outs to share the shortfall.";
  }
  const person = players.find((player) => key(player.name) === key(resolution.name));
  if (!person) return "Choose a player from tonight's ledger.";
  return person.cashOutCents >= gap.cents ? null : `${person.name} cashed out less than the shortfall.`;
}

/** Reads a stored or submitted resolution, or null when it isn't one. */
export function parseResolution(value: unknown): BalanceResolution | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { mode?: unknown; name?: unknown };
  if (raw.mode === "jackpot" || raw.mode === "split" || raw.mode === "none") return { mode: raw.mode };
  if (raw.mode === "player" && typeof raw.name === "string" && raw.name.trim()) return { mode: "player", name: raw.name.trim().slice(0, 80) };
  return null;
}
