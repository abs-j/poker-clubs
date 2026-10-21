import { sql } from "drizzle-orm";
import { db } from "./index";
import { clubs, type Club } from "./schema";

/** Same normalisation the leaderboard and avatars already use to match names. */
export function normalizeNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export const DEFAULT_CLUB = {
  slug: process.env.DEFAULT_CLUB_SLUG?.trim() || "monash",
  name: process.env.DEFAULT_CLUB_NAME?.trim() || "Monash Poker Society",
} as const;

/** Tables that gain a nullable club_id in Phase 1 and are stamped with the default club. */
const TENANT_TABLES = [
  "live_sessions",
  "live_activity_events",
  "member_avatars",
  "member_usage",
  "member_usage_activity",
  "site_visits",
  "auth_sessions",
  "admin_audit_log",
] as const;

/**
 * Makes sure the original club exists, stamps every un-owned row with it, and registers each
 * known name as a player. Safe to run on every start: it only touches rows still missing a club.
 */
export async function ensureDefaultClub(): Promise<Club> {
  await db
    .insert(clubs)
    .values({ slug: DEFAULT_CLUB.slug, name: DEFAULT_CLUB.name })
    .onConflictDoNothing({ target: clubs.slug });
  const [club] = await db.select().from(clubs).where(sql`${clubs.slug} = ${DEFAULT_CLUB.slug}`).limit(1);
  if (!club) throw new Error(`Default club "${DEFAULT_CLUB.slug}" could not be created.`);

  for (const table of TENANT_TABLES) {
    await db.execute(sql`UPDATE ${sql.identifier(table)} SET club_id = ${club.id} WHERE club_id IS NULL`);
  }

  // Players are the club-scoped identity for every name already in the data. The display name
  // is the tidied spelling, preferring one with capitals ("Raju") over an all-lowercase key.
  await db.execute(sql`
    INSERT INTO players (club_id, display_name, name_key)
    SELECT DISTINCT ON (key) ${club.id}, name, key FROM (
      SELECT btrim(regexp_replace(member_name, '\s+', ' ', 'g')) AS name,
             lower(btrim(regexp_replace(member_name, '\s+', ' ', 'g'))) AS key
        FROM (
          SELECT member_name FROM live_activity_events WHERE club_id = ${club.id}
          UNION ALL SELECT member_name FROM member_avatars WHERE club_id = ${club.id}
          UNION ALL SELECT member_name FROM member_usage WHERE club_id = ${club.id}
        ) raw
    ) names
    WHERE key <> ''
    ORDER BY key, (name <> lower(name)) DESC, name
    ON CONFLICT (club_id, name_key) DO NOTHING
  `);

  return club;
}
