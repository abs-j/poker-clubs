// The club points rules a club can choose: three presets, or its own numbers. Pure, so the
// bounds and presets can be unit tested. The website scores nights with whatever rules the
// club has; this file only decides which rules are allowed.

export type PointsRules = {
  /** Just for taking a seat. */
  turnUp: { cash: number; tournament: number };
  /** Top of the placement scale; scaled by how many played. */
  placementMax: number;
  /** A normal night is about `reference` players; bigger tables count for more, smaller for less. */
  size: { reference: number; min: number; max: number };
  /** Winning (first place and in profit): a flat amount plus `perPlayer` for each player. */
  win: { flat: number; perPlayer: number; minPlayers: number };
  podium: { second: number; third: number; minPlayers: number };
  inProfit: number;
  perKnockout: number;
  /** Nights with fewer real players than this are not scored. */
  minPlayersToCount: number;
  /** Fewer nights than this and the player is shown as provisional. */
  provisionalBelowNights: number;
};

export type PresetId = "standard" | "social" | "competitive";
export type PresetChoice = PresetId | "custom";

export const STANDARD_RULES: PointsRules = {
  turnUp: { cash: 6, tournament: 10 },
  placementMax: 24,
  size: { reference: 12, min: 0.6, max: 1.4 },
  win: { flat: 15, perPlayer: 1, minPlayers: 4 },
  podium: { second: 8, third: 4, minPlayers: 6 },
  inProfit: 4,
  perKnockout: 2,
  minPlayersToCount: 4,
  provisionalBelowNights: 3,
};

export const PRESETS: Record<PresetId, { label: string; description: string; rules: PointsRules }> = {
  standard: {
    label: "Standard",
    description: "Turning up and winning both matter. Bigger tables are worth more.",
    rules: STANDARD_RULES,
  },
  social: {
    label: "Social",
    description: "Rewards turning up. Wins still count, but a regular beats an occasional big winner.",
    rules: {
      ...STANDARD_RULES,
      turnUp: { cash: 10, tournament: 14 },
      placementMax: 14,
      win: { flat: 8, perPlayer: 1, minPlayers: 4 },
      podium: { second: 5, third: 3, minPlayers: 6 },
      inProfit: 3,
    },
  },
  competitive: {
    label: "Competitive",
    description: "Results first. Big rewards for winning and finishing on the podium.",
    rules: {
      ...STANDARD_RULES,
      turnUp: { cash: 3, tournament: 6 },
      placementMax: 30,
      win: { flat: 25, perPlayer: 2, minPlayers: 4 },
      podium: { second: 12, third: 6, minPlayers: 6 },
      inProfit: 5,
      perKnockout: 3,
    },
  },
};

type Bound = { min: number; max: number; integer?: boolean };
const POINTS: Bound = { min: 0, max: 100 };
const COUNT: Bound = { min: 2, max: 20, integer: true };

const BOUNDS: Array<{ path: string[]; label: string; bound: Bound }> = [
  { path: ["turnUp", "cash"], label: "Turn-up points (cash)", bound: POINTS },
  { path: ["turnUp", "tournament"], label: "Turn-up points (tournament)", bound: POINTS },
  { path: ["placementMax"], label: "Top placement points", bound: POINTS },
  { path: ["size", "reference"], label: "Normal table size", bound: { min: 4, max: 40, integer: true } },
  { path: ["size", "min"], label: "Smallest table weighting", bound: { min: 0.2, max: 1 } },
  { path: ["size", "max"], label: "Largest table weighting", bound: { min: 1, max: 3 } },
  { path: ["win", "flat"], label: "Win bonus", bound: POINTS },
  { path: ["win", "perPlayer"], label: "Win bonus per player", bound: { min: 0, max: 10 } },
  { path: ["win", "minPlayers"], label: "Players needed for a win bonus", bound: COUNT },
  { path: ["podium", "second"], label: "Second place bonus", bound: POINTS },
  { path: ["podium", "third"], label: "Third place bonus", bound: POINTS },
  { path: ["podium", "minPlayers"], label: "Players needed for podium bonuses", bound: COUNT },
  { path: ["inProfit"], label: "In-profit bonus", bound: POINTS },
  { path: ["perKnockout"], label: "Points per knockout", bound: { min: 0, max: 20 } },
  { path: ["minPlayersToCount"], label: "Players needed for a night to count", bound: COUNT },
  { path: ["provisionalBelowNights"], label: "Nights before a player is no longer provisional", bound: { min: 1, max: 20, integer: true } },
];

function read(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), source);
}

/** Checks a full custom rule set. Returns the cleaned rules, or the first thing that is wrong. */
export function validateRules(input: unknown): { rules: PointsRules } | { error: string } {
  const out = JSON.parse(JSON.stringify(STANDARD_RULES)) as PointsRules;
  for (const { path, label, bound } of BOUNDS) {
    const value = read(input, path);
    if (typeof value !== "number" || !Number.isFinite(value)) return { error: `${label} must be a number.` };
    if (value < bound.min || value > bound.max) return { error: `${label} must be between ${bound.min} and ${bound.max}.` };
    if (bound.integer && !Number.isInteger(value)) return { error: `${label} must be a whole number.` };
    let target: Record<string, unknown> = out as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[path[path.length - 1]] = Math.round(value * 100) / 100;
  }
  if (out.podium.third > out.podium.second) return { error: "Third place can't be worth more than second." };
  return { rules: out };
}

/** The rules a club actually plays by, whatever is stored. Falls back to Standard if stored data is bad. */
export function resolveRules(preset: string, custom: unknown): { preset: PresetChoice; rules: PointsRules } {
  if (preset === "custom") {
    const checked = validateRules(custom);
    if ("rules" in checked) return { preset: "custom", rules: checked.rules };
    return { preset: "standard", rules: STANDARD_RULES };
  }
  const known = (preset in PRESETS ? preset : "standard") as PresetId;
  return { preset: known, rules: PRESETS[known].rules };
}
