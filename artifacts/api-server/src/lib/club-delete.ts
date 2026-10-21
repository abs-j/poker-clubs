import { eq } from "drizzle-orm";
import {
  adminAuditLog,
  authSessions,
  clubSessions,
  clubTournaments,
  clubs,
  db,
  liveActivityEvents,
  liveSessions,
  memberAvatars,
  memberUsage,
  memberUsageActivity,
  siteVisits,
} from "@workspace/db";

/**
 * Permanently removes a club and everything in it. The newer tables cascade from the club row; the
 * older per-club tables don't, so they are cleared here first, all in one transaction.
 */
export async function deleteClubData(clubId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(clubSessions).where(eq(clubSessions.clubId, clubId)); // results cascade
    await tx.delete(clubTournaments).where(eq(clubTournaments.clubId, clubId)); // results cascade
    await tx.delete(liveActivityEvents).where(eq(liveActivityEvents.clubId, clubId)); // audit comments cascade
    await tx.delete(liveSessions).where(eq(liveSessions.clubId, clubId));
    await tx.delete(memberAvatars).where(eq(memberAvatars.clubId, clubId));
    await tx.delete(memberUsage).where(eq(memberUsage.clubId, clubId));
    await tx.delete(memberUsageActivity).where(eq(memberUsageActivity.clubId, clubId));
    await tx.delete(siteVisits).where(eq(siteVisits.clubId, clubId));
    await tx.delete(authSessions).where(eq(authSessions.clubId, clubId));
    await tx.delete(adminAuditLog).where(eq(adminAuditLog.clubId, clubId));
    await tx.delete(clubs).where(eq(clubs.id, clubId)); // players, memberships and invites cascade
  });
}
