import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, max, sql } from "drizzle-orm";
import { adminAuditLog, db, memberAvatars, memberUsage, memberUsageActivity, players, siteVisits } from "@workspace/db";
import { adminClubId, requireAdminSession } from "../lib/auth";
import { recentAdminActions } from "../lib/admin-audit";
import { isOriginalClub } from "../lib/club-settings";
import { getLiveActivitySnapshot } from "../lib/live-activity";
import { fetchPokerDashboard } from "../lib/poker-sheet";

const router: IRouter = Router();
const key = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

router.use("/admin", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// One row per member, including people who have never signed in.
router.get("/admin/members", requireAdminSession, async (_req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentUsageSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const [visitRows, recentRows, usageRows, recentUsageRows, avatarRows] = await Promise.all([
    db.select({ name: siteVisits.memberName, total: count(), last: max(siteVisits.visitedAt) }).from(siteVisits).where(eq(siteVisits.clubId, clubId)).groupBy(siteVisits.memberName),
    db.select({ name: siteVisits.memberName, total: count() }).from(siteVisits).where(and(eq(siteVisits.clubId, clubId), gte(siteVisits.visitedAt, since))).groupBy(siteVisits.memberName),
    db
      .select({
        name: memberUsage.memberName,
        seconds: sql<number>`coalesce(sum(${memberUsage.activeSeconds}), 0)`.mapWith(Number),
        last: max(memberUsage.lastActiveAt),
      })
      .from(memberUsage)
      .where(eq(memberUsage.clubId, clubId))
      .groupBy(memberUsage.memberName),
    db
      .select({
        name: memberUsageActivity.memberName,
        seconds: sql<number>`coalesce(sum(${memberUsageActivity.activeSeconds}), 0)`.mapWith(Number),
      })
      .from(memberUsageActivity)
      .where(and(eq(memberUsageActivity.clubId, clubId), gte(memberUsageActivity.bucketAt, recentUsageSince)))
      .groupBy(memberUsageActivity.memberName),
    db.select({ key: memberAvatars.memberKey, kind: memberAvatars.kind }).from(memberAvatars).where(eq(memberAvatars.clubId, clubId)),
  ]);

  const members = new Map<string, { name: string; signIns: number; signInsLast30: number; activeSeconds: number; recentActiveSeconds: number; lastSeenAt: Date | null; picture: "none" | "preset" | "upload" }>();
  const ensure = (name: string) => {
    const k = key(name);
    if (!members.has(k)) members.set(k, { name: name.trim(), signIns: 0, signInsLast30: 0, activeSeconds: 0, recentActiveSeconds: 0, lastSeenAt: null, picture: "none" });
    return members.get(k)!;
  };
  const rosterRows = await db.select({ name: players.displayName }).from(players).where(eq(players.clubId, clubId));
  for (const row of rosterRows) ensure(row.name);
  const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a ?? b);
  for (const row of visitRows) {
    const m = ensure(row.name);
    m.signIns = row.total;
    m.lastSeenAt = later(m.lastSeenAt, row.last);
  }
  for (const row of recentRows) ensure(row.name).signInsLast30 = row.total;
  for (const row of usageRows) {
    const m = ensure(row.name);
    m.activeSeconds = row.seconds;
    m.lastSeenAt = later(m.lastSeenAt, row.last);
  }
  for (const row of recentUsageRows) ensure(row.name).recentActiveSeconds = row.seconds;
  for (const row of avatarRows) {
    const m = members.get(row.key);
    if (m) m.picture = row.kind === "upload" ? "upload" : "preset";
  }

  res.json({
    members: [...members.values()]
      .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0) || a.name.localeCompare(b.name))
      .map((m) => ({ ...m, lastSeenAt: m.lastSeenAt?.toISOString() ?? null })),
  });
});

router.get("/admin/audit", requireAdminSession, async (_req, res): Promise<void> => {
  const rows = await recentAdminActions(adminClubId(res), 50);
  res.json({
    entries: rows.map((row) => ({
      id: row.id,
      action: row.action,
      detail: row.detail,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

// A few facts an admin checks before anything else: is the sheet fresh, is a game live,
// is the ledger backed up.
router.get("/admin/health", requireAdminSession, async (_req, res): Promise<void> => {
  const clubId = adminClubId(res);
  // The sheet belongs to the original club; other clubs have none linked.
  const sheetLinked = await isOriginalClub(clubId);
  const noSheet = Promise.reject(new Error("No Google Sheet is linked to this club."));
  noSheet.catch(() => undefined);
  const [sheet, live, lastBackup, lastLogin, tournaments] = await Promise.all([
    (sheetLinked ? fetchPokerDashboard() : noSheet)
      .then((dashboard) => ({ ok: true as const, lastUpdated: dashboard.lastUpdated ?? null, isStale: Boolean(dashboard.isStale) }))
      .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : "Unavailable" })),
    getLiveActivitySnapshot(clubId)
      .then((snapshot) => ({
        ok: true as const,
        sessionStatus: snapshot.sessionStatus,
        syncStatus: snapshot.syncStatus,
        lastSyncedAt: snapshot.lastSyncedAt,
        entries: snapshot.entries.length,
      }))
      .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : "Unavailable" })),
    db.select({ at: adminAuditLog.createdAt }).from(adminAuditLog).where(and(eq(adminAuditLog.clubId, clubId), eq(adminAuditLog.action, "ledger_backup"))).orderBy(desc(adminAuditLog.createdAt)).limit(1),
    db.select({ at: siteVisits.visitedAt }).from(siteVisits).where(eq(siteVisits.clubId, clubId)).orderBy(desc(siteVisits.visitedAt)).limit(1),
    // How many tournaments the site read, and how many the sheet itself flagged.
    (sheetLinked ? fetchPokerDashboard() : noSheet)
      .then((dashboard) => ({
        count: dashboard.tournaments.length,
        flagged: dashboard.tournaments
          .filter((event) => event.dataCheck && !/ok/i.test(event.dataCheck))
          .map((event) => event.date),
      }))
      .catch(() => ({ count: 0, flagged: [] as string[] })),
  ]);
  res.json({
    sheet,
    live,
    tournaments,
    lastBackupAt: lastBackup[0]?.at.toISOString() ?? null,
    lastMemberSignInAt: lastLogin[0]?.at.toISOString() ?? null,
  });
});

export default router;
