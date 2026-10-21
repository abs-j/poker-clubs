import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { count, desc, eq } from "drizzle-orm";
import {
  GetAdminVisitsResponse,
} from "@workspace/api-zod";
import { authSessions, db, memberUsage, siteVisits } from "@workspace/db";
import {
  ADMIN_SESSION_COOKIE,
  clearSessionCookie,
  createAuthSession,
  deleteAuthSession,
  findAuthSession,
  clientAddress,
  memberNameForCode,
  adminPasswordMatches,
  recordVisit,
  recordAccountVisit,
  requireAdminSession,
  adminClubId,
  setSessionCookie,
  MEMBER_SESSION_COOKIE,
  renewAuthSession,
} from "../lib/auth";
import { recordAdminAction } from "../lib/admin-audit";
import { isClubAdmin, resolveClubContext } from "../lib/club-access";
import {
  ADMIN_LIMITS,
  MEMBER_LIMITS,
  clearFailures,
  describeWait,
  recordFailure,
  retryAfterSeconds,
} from "../lib/login-throttle";

const router: IRouter = Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  next();
});


const DEVICE_COOKIE = "poker_device";

/** A random id per browser, so one phone's typos are counted apart from the whole network's. */
function deviceId(req: Request, res: Response): string {
  const existing = req.cookies?.[DEVICE_COOKIE];
  if (typeof existing === "string" && /^[a-f0-9]{32}$/.test(existing)) return existing;
  const fresh = randomBytes(16).toString("hex");
  res.cookie(DEVICE_COOKIE, fresh, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  return fresh;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readCredential(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

router.post("/auth/member/login", async (req, res): Promise<void> => {
  const device = deviceId(req, res);
  const keys = [`member:ip:${clientAddress(req)}`, `member:dev:${device}`];
  const retryAfter = await retryAfterSeconds(keys);
  if (retryAfter > 0) {
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: `Too many attempts. Try again in ${describeWait(retryAfter)}.`, retryAfterSeconds: retryAfter });
    return;
  }

  const code = readCredential(req.body?.code);
  const memberName = code ? memberNameForCode(code) : null;
  if (!memberName) {
    const [, deviceFailures] = await recordFailure([
      { key: keys[0], limit: MEMBER_LIMITS.network },
      { key: keys[1], limit: MEMBER_LIMITS.device },
    ]);
    // A short pause that grows with this device's own misses, not the whole network's.
    await sleep(Math.min(deviceFailures, 5) * 250);
    res.status(401).json({ error: "That access code is not recognised." });
    return;
  }

  await clearFailures([keys[1]]);
  const token = await createAuthSession("member", memberName);
  await recordVisit(memberName);
  setSessionCookie(res, MEMBER_SESSION_COOKIE, token, "member");
  res.json({ authenticated: true, memberName });
});

router.get("/auth/member/session", async (req, res): Promise<void> => {
  const session = await findAuthSession(req, MEMBER_SESSION_COOKIE);
  if (session && session.role === "member") {
    // Opening the site counts as use: restart the sign-in clock.
    await renewAuthSession(req, res, MEMBER_SESSION_COOKIE, "member").catch(() => undefined);
    res.json({ authenticated: true, memberName: session.memberName });
    return;
  }

  // A signed-in account that belongs to a club.
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

router.post("/auth/member/logout", async (req, res): Promise<void> => {
  await deleteAuthSession(req, MEMBER_SESSION_COOKIE);
  clearSessionCookie(res, MEMBER_SESSION_COOKIE);
  res.status(204).end();
});

router.post("/auth/admin/login", async (req, res): Promise<void> => {
  const device = deviceId(req, res);
  const keys = [`admin:ip:${clientAddress(req)}`, `admin:dev:${device}`];
  const retryAfter = await retryAfterSeconds(keys);
  if (retryAfter > 0) {
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ error: `Too many attempts. Try again in ${describeWait(retryAfter)}.`, retryAfterSeconds: retryAfter });
    return;
  }

  const password = readCredential(req.body?.password);
  if (!password || !adminPasswordMatches(password)) {
    const [, deviceFailures] = await recordFailure([
      { key: keys[0], limit: ADMIN_LIMITS.network },
      { key: keys[1], limit: ADMIN_LIMITS.device },
    ]);
    await recordAdminAction("admin_login_failed", `Failed admin sign-in (attempt ${deviceFailures} from this device).`, req);
    await sleep(Math.min(deviceFailures, 5) * 500);
    res.status(401).json({ error: "That admin password is not recognised." });
    return;
  }

  await clearFailures(keys);
  const token = await createAuthSession("admin", null);
  setSessionCookie(res, ADMIN_SESSION_COOKIE, token, "admin");
  await recordAdminAction("admin_login", "Signed in to the admin area.", req);
  res.json({ authenticated: true });
});

router.get("/auth/admin/session", async (req, res): Promise<void> => {
  const session = await findAuthSession(req, ADMIN_SESSION_COOKIE);
  if (session && session.role === "admin") {
    res.json({ authenticated: true, expiresAt: session.expiresAt?.toISOString() ?? null });
    return;
  }
  // Club owners and admins reach the admin area through their account.
  const context = await resolveClubContext(req);
  if (context && isClubAdmin(context.role)) {
    res.json({ authenticated: true, expiresAt: null, clubRole: context.role });
    return;
  }
  res.json({ authenticated: false });
});

router.post("/auth/admin/logout", async (req, res): Promise<void> => {
  await deleteAuthSession(req, ADMIN_SESSION_COOKIE);
  clearSessionCookie(res, ADMIN_SESSION_COOKIE);
  res.status(204).end();
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