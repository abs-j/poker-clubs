import type { Request } from "express";
import { desc, eq } from "drizzle-orm";
import { adminAuditLog, db } from "@workspace/db";

export type AdminAuditAction =
  | "admin_login"
  | "admin_login_failed"
  | "ledger_reset"
  | "ledger_session_deleted"
  | "ledger_backup"
  | "avatar_updated"
  | "avatar_removed"
  | "history_imported"
  | "history_import_undone"
  | "night_deleted"
  | "ledger_balanced"
  | "night_reopened"
  | "night_handed_over"
  | "tournament_deleted"
  | "night_recorded"
  | "jackpot_paid"
  | "settings_updated"
  | "results_exported";

/** Never throws: a logging problem must not block the action being recorded. */
export async function recordAdminAction(action: AdminAuditAction, detail: string, req: Request): Promise<void> {
  try {
    // The club is the one the signed-in person is acting in. Admin routes set adminSession;
    // a host who is not an admin only has a member session.
    const adminClub = (req.res?.locals.adminSession as { clubId?: number | null } | undefined)?.clubId;
    const memberClub = (req.res?.locals.memberSession as { clubId?: number | null } | undefined)?.clubId;
    const clubId = adminClub ?? memberClub ?? null;
    await db.insert(adminAuditLog).values({ action, detail: detail.slice(0, 500), ip: req.ip ?? null, clubId });
  } catch (error) {
    req.log?.warn({ err: error, action }, "Could not write the admin audit log");
  }
}

export async function recentAdminActions(clubId: number, limit = 50) {
  return db
    .select()
    .from(adminAuditLog)
    .where(eq(adminAuditLog.clubId, clubId))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit);
}
