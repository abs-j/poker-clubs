import type { Request } from "express";
import { adminAuditLog, db } from "@workspace/db";

export type AdminAuditAction =
  | "ledger_reset"
  | "ledger_backup"
  | "history_imported"
  | "history_import_undone"
  | "night_deleted"
  | "night_edited"
  | "settle_history"
  | "ledger_balanced"
  | "night_reopened"
  | "night_handed_over"
  | "tournament_deleted"
  | "tournament_edited"
  | "night_recorded"
  | "night_note_changed"
  | "ai_settings_updated"
  | "jackpot_paid"
  | "jackpot_changed"
  | "settings_updated"
  | "results_exported"
  | "tournaments_exported"
  | "players_merged";

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
