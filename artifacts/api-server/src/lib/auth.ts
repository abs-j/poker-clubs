import type { NextFunction, Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, siteVisits } from "@workspace/db";
import { isClubAdmin, resolveClubContext, type ClubRole } from "./club-access";

// Everyone signs in with an account (see identity.ts). Which club they act in, and as what, comes from
// their membership (club-access.ts), so a request's club is never a default and never taken from the client.

export type AuthSession = {
  role: "member" | "admin";
  memberName: string | null;
  clubId: number | null;
  /** The person's role in the club they are acting in. */
  clubRole?: ClubRole;
  userId?: string;
  clubName?: string;
};

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be configured before starting the API server.");
}

export async function requireMemberSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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
