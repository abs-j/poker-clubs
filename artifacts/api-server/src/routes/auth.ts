import { Router, type IRouter } from "express";
import { count, desc, eq } from "drizzle-orm";
import { GetAdminVisitsResponse } from "@workspace/api-zod";
import { db, memberUsage, siteVisits } from "@workspace/db";
import { recordAccountVisit, requireAdminSession, adminClubId } from "../lib/auth";
import { isClubAdmin, resolveClubContext } from "../lib/club-access";

const router: IRouter = Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  next();
});

/** Who is signed in, and as what, for the club they are acting in. Sign-in itself lives under /api/identity. */
router.get("/auth/member/session", async (req, res): Promise<void> => {
  const context = await resolveClubContext(req);
  if (!context) {
    res.json({ authenticated: false });
    return;
  }
  await recordAccountVisit(context.clubId, context.memberName).catch(() => undefined);
  res.json({
    authenticated: true,
    memberName: context.memberName,
    club: { id: context.clubId, slug: context.clubSlug, name: context.clubName, role: context.role },
  });
});

router.get("/auth/admin/session", async (req, res): Promise<void> => {
  // Club owners and admins reach the admin area through their account.
  const context = await resolveClubContext(req);
  if (context && isClubAdmin(context.role)) {
    res.json({ authenticated: true, expiresAt: null, clubRole: context.role });
    return;
  }
  res.json({ authenticated: false });
});

router.get("/admin/visits", requireAdminSession, async (_req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const [totalResult, memberCounts, visits, usage] = await Promise.all([
    db.select({ total: count() }).from(siteVisits).where(eq(siteVisits.clubId, clubId)),
    db
      .select({ memberName: siteVisits.memberName, visits: count() })
      .from(siteVisits)
      .where(eq(siteVisits.clubId, clubId))
      .groupBy(siteVisits.memberName)
      .orderBy(desc(count())),
    db
      .select({
        id: siteVisits.id,
        memberName: siteVisits.memberName,
        visitedAt: siteVisits.visitedAt,
      })
      .from(siteVisits)
      .where(eq(siteVisits.clubId, clubId))
      .orderBy(desc(siteVisits.visitedAt))
      .limit(500),
    db
      .select({
        memberName: memberUsage.memberName,
        section: memberUsage.section,
        pageViews: memberUsage.pageViews,
        activeSeconds: memberUsage.activeSeconds,
        lastActiveAt: memberUsage.lastActiveAt,
      })
      .from(memberUsage)
      .where(eq(memberUsage.clubId, clubId))
      .orderBy(desc(memberUsage.lastActiveAt)),
  ]);

  res.json(GetAdminVisitsResponse.parse({
    totalVisits: totalResult[0]?.total ?? 0,
    uniqueMembers: memberCounts.length,
    memberCounts,
    visits: visits.map((visit) => ({
      ...visit,
      visitedAt: visit.visitedAt.toISOString(),
    })),
    usage: usage.map((entry) => ({
      ...entry,
      lastActiveAt: entry.lastActiveAt.toISOString(),
    })),
  }));
});

export default router;