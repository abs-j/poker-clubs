import { eq } from "drizzle-orm";
import { clubs, db } from "@workspace/db";
import { getDefaultClubId } from "./club-context";

/** True only for the legacy original club, and only when legacy mode is on. */
export async function isOriginalClub(clubId: number): Promise<boolean> {
  const original = await getDefaultClubId();
  return original !== null && clubId === original;
}
import { PRESETS, resolveRules, type PointsRules, type PresetChoice } from "./points-rules";

export type ClubSettings = {
  id: number;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  guidelines: string | null;
  /** The original club keeps its built-in rules text and its sheet. */
  isOriginal: boolean;
  points: { preset: PresetChoice; rules: PointsRules };
};

const TTL_MS = 30_000;
const cache = new Map<number, { at: number; value: ClubSettings }>();

export async function getClubSettings(clubId: number): Promise<ClubSettings> {
  const hit = cache.get(clubId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [row] = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
  if (!row) throw new Error("That club no longer exists.");
  const value: ClubSettings = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    timezone: row.timezone,
    guidelines: row.guidelines,
    isOriginal: await isOriginalClub(row.id),
    points: resolveRules(row.pointsPreset, row.pointsRules),
  };
  cache.set(clubId, { at: Date.now(), value });
  return value;
}

/** The IANA timezone that decides which calendar date "tonight" is for this club. */
export async function clubTimezone(clubId: number): Promise<string> {
  return (await getClubSettings(clubId)).timezone;
}

export type SettingsPatch = Partial<{
  name: string;
  currency: string;
  timezone: string;
  guidelines: string | null;
  pointsPreset: string;
  pointsRules: PointsRules | null;
}>;

export async function updateClubSettings(clubId: number, patch: SettingsPatch): Promise<ClubSettings> {
  if (Object.keys(patch).length > 0) await db.update(clubs).set(patch).where(eq(clubs.id, clubId));
  cache.delete(clubId);
  return getClubSettings(clubId);
}

export const presetList = () =>
  (Object.entries(PRESETS) as Array<[keyof typeof PRESETS, (typeof PRESETS)[keyof typeof PRESETS]]>).map(([id, preset]) => ({
    id,
    label: preset.label,
    description: preset.description,
    rules: preset.rules,
  }));
