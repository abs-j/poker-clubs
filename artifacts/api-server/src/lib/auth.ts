import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { authSessions, db, siteVisits } from "@workspace/db";
import { getDefaultClubId } from "./club-context";
import { isClubAdmin, resolveClubContext, type ClubRole } from "./club-access";

export type AuthRole = "member" | "admin";
export type AuthSession = {
  role: AuthRole;
  memberName: string | null;
  /** The club this session belongs to; null only for sessions created before clubs existed. */
  clubId: number | null;
  /** The person's role in that club; legacy access-code sessions are plain members. */
  clubRole?: ClubRole;
  /** Set for signed-in accounts; absent for legacy access-code sessions. */
  userId?: string;
  clubName?: string;
  expiresAt?: Date;
};

export const MEMBER_SESSION_COOKIE = "poker_member_session";
export const ADMIN_SESSION_COOKIE = "poker_admin_session";
const DAY_MS = 24 * 60 * 60 * 1000;
// Members stay signed in for a long time and the clock restarts whenever they open the site.
// Admin sessions stay short because they can change the club's data.
const MEMBER_SESSION_TTL_MS = 90 * DAY_MS;
const ADMIN_SESSION_TTL_MS = 7 * DAY_MS;
// Only rewrite the expiry when at least this much of the lifetime has been used.
const RENEW_AFTER_MS = DAY_MS;

const sessionTtlMs = (role: AuthRole) => (role === "member" ? MEMBER_SESSION_TTL_MS : ADMIN_SESSION_TTL_MS);

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be configured before starting the API server.");
}



function hashSessionToken(token: string): string {
  return createHash("sha256")
    .update(`${sessionSecret}:${token}`)
    .digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash);
}

function memberAccessCodes(): Array<{ memberName: string; code: string }> {
  // Access codes are the original club's legacy sign-in. Without them, only accounts sign in.
  const raw = process.env.MEMBER_ACCESS_CODES;
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MEMBER_ACCESS_CODES must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MEMBER_ACCESS_CODES must be a JSON object.");
  }

  const entries = Object.entries(parsed).filter(
    ([memberName, code]) =>
      memberName.trim().length > 0 &&
      typeof code === "string" &&
      code.trim().length > 0,
  );

  return entries.map(([memberName, code]) => ({
    memberName: memberName.trim(),
    code: code.trim(),
  }));
}

export function memberNameForCode(code: string): string | null {
  for (const entry of memberAccessCodes()) {
    if (safeEqual(entry.code, code)) return entry.memberName;
  }
  return null;
}

export function adminPasswordMatches(password: string): boolean {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  if (!configuredPassword) return false;
  return safeEqual(configuredPassword, password);
}

export function clientAddress(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Every member name that has an access code, for the admin members table. */
export function configuredMemberNames(): string[] {
  return memberAccessCodes().map((entry) => entry.memberName);
}

export async function createAuthSession(
  role: AuthRole,
  memberName: string | null,
): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  await db.insert(authSessions).values({
    clubId: await getDefaultClubId(),
    tokenHash: hashSessionToken(rawToken),
    role,
    memberName,
    expiresAt: new Date(Date.now() + sessionTtlMs(role)),
  });
  return rawToken;
}

export async function findAuthSession(
  req: Request,
  cookieName: string,
): Promise<AuthSession | null> {
  const token = req.cookies?.[cookieName];
  if (typeof token !== "string" || token.length === 0) return null;

  const [session] = await db
    .select({ role: authSessions.role, memberName: authSessions.memberName, clubId: authSessions.clubId, expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .where(
      and(
        eq(authSessions.tokenHash, hashSessionToken(token)),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!session || (session.role !== "member" && session.role !== "admin")) {
    return null;
  }

  return { role: session.role, memberName: session.memberName, clubId: session.clubId, expiresAt: session.expiresAt };
}

export async function deleteAuthSession(
  req: Request,
  cookieName: string,
): Promise<void> {
  const token = req.cookies?.[cookieName];
  if (typeof token !== "string" || token.length === 0) return;
  await db
    .delete(authSessions)
    .where(eq(authSessions.tokenHash, hashSessionToken(token)));
}

export function setSessionCookie(
  res: Response,
  cookieName: string,
  token: string,
  role: AuthRole = "member",
): void {
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionTtlMs(role),
    path: "/",
  });
}

/**
 * Restarts the session clock for a signed-in browser, so people who keep using the site are
 * never signed out. Writes at most about once a day per session.
 */
export async function renewAuthSession(
  req: Request,
  res: Response,
  cookieName: string,
  role: AuthRole,
): Promise<void> {
  const token = req.cookies?.[cookieName];
  if (typeof token !== "string" || token.length === 0) return;
  const ttl = sessionTtlMs(role);
  const tokenHash = hashSessionToken(token);

  const [row] = await db
    .select({ expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return;

  const remaining = row.expiresAt.getTime() - Date.now();
  if (remaining > ttl - RENEW_AFTER_MS) return;

  await db
    .update(authSessions)
    .set({ expiresAt: new Date(Date.now() + ttl) })
    .where(eq(authSessions.tokenHash, tokenHash));
  setSessionCookie(res, cookieName, token, role);
}

export function clearSessionCookie(res: Response, cookieName: string): void {
  res.clearCookie(cookieName, { httpOnly: true, sameSite: "lax", path: "/" });
}

export async function requireMemberSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Legacy access-code session (the original club only).
  const legacy = await findAuthSession(req, MEMBER_SESSION_COOKIE);
  if (legacy && legacy.role === "member") {
    res.locals.memberSession = {
      ...legacy,
      clubId: legacy.clubId ?? (await getDefaultClubId()),
      clubRole: "member" as const,
    } satisfies AuthSession;
    next();
    return;
  }

  // A signed-in account acting in one of its clubs.
  const context = await resolveClubContext(req);
  if (context) {
    res.locals.memberSession = {
      role: "member",
      memberName: context.memberName,
      clubId: context.clubId,
      clubName: context.clubName,
      clubRole: context.role,
      userId: context.userId,
    } satisfies AuthSession;
    next();
    return;
  }

  res.status(401).json({ error: "Member authentication required." });
}

export async function requireAdminSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Legacy admin password session (the original club only).
  const legacy = await findAuthSession(req, ADMIN_SESSION_COOKIE);
  if (legacy && legacy.role === "admin") {
    res.locals.adminSession = { ...legacy, clubId: legacy.clubId ?? (await getDefaultClubId()) };
    next();
    return;
  }

  // Club owners and admins.
  const context = await resolveClubContext(req);
  if (context && isClubAdmin(context.role)) {
    res.locals.adminSession = {
      role: "admin",
      memberName: context.memberName,
      clubId: context.clubId,
      clubRole: context.role,
      userId: context.userId,
    } satisfies AuthSession;
    next();
    return;
  }

  res.status(401).json({ error: "Admin authentication required." });
}

/** The club a signed-in member request acts in. Only valid after requireMemberSession. */
export function memberClubId(res: Response): number {
  return (res.locals.memberSession as AuthSession).clubId as number;
}

/** The club an admin request acts in. Only valid after requireAdminSession. */
export function adminClubId(res: Response): number {
  return (res.locals.adminSession as AuthSession).clubId as number;
}

export async function recordVisit(memberName: string): Promise<void> {
  await db.insert(siteVisits).values({ clubId: await getDefaultClubId(), memberName });
}

/** Accounts have no sign-in event of their own here, so count a visit when none was seen lately. */
export async function recordAccountVisit(clubId: number, memberName: string): Promise<void> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const [recent] = await db
    .select({ id: siteVisits.id })
    .from(siteVisits)
    .where(and(eq(siteVisits.clubId, clubId), eq(siteVisits.memberName, memberName), gt(siteVisits.visitedAt, since)))
    .limit(1);
  if (recent) return;
  await db.insert(siteVisits).values({ clubId, memberName });
}

export async function removeExpiredSessions(): Promise<void> {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}