import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// There are no migration files: the schema is applied with `pnpm --filter @workspace/db run push`.
// Check it was, at start-up, so a missed step is a clear message instead of a 500 on first sign-up.
const TABLES = ["users", "user_sessions", "clubs", "players", "memberships", "invites", "club_sessions", "session_results", "club_tournaments", "tournament_results", "live_sessions", "live_activity_events"];
// Columns added after the first release, so an out-of-date database is caught too.
const COLUMNS: Array<[string, string]> = [["clubs", "points_preset"], ["invites", "emailed_to"], ["admin_audit_log", "club_id"], ["users", "terms_accepted_at"], ["club_tournaments", "winner_keeps_bounty"], ["club_sessions", "jackpot_cents"], ["live_sessions", "balance_resolution"], ["live_sessions", "host_name"]];

export async function assertSchemaReady(): Promise<void> {
  try {
    for (const table of TABLES) await db.execute(sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`);
    for (const [table, column] of COLUMNS) await db.execute(sql`SELECT ${sql.identifier(column)} FROM ${sql.identifier(table)} LIMIT 1`);
  } catch (error) {
    // Drizzle wraps the database's own error, so look at both layers: 42P01 is a missing table, 42703 a missing column.
    const wrapped = error as { code?: string; cause?: { code?: string } };
    const code = wrapped.cause?.code ?? wrapped.code;
    if (code === "42P01" || code === "42703") {
      throw new Error("The database schema is missing or out of date. Run: pnpm --filter @workspace/db run push");
    }
    throw error;
  }
}
