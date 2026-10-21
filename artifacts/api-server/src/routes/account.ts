import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { clubs, db, memberships, userAccounts, users } from "@workspace/db";
import { ACTIVE_CLUB_COOKIE, identityUser, type IdentityUser } from "../lib/club-access";
import { deleteClubData } from "../lib/club-delete";
import { identity } from "../lib/identity";

const router: IRouter = Router();

router.use("/account", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await identityUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  res.locals.identityUser = user;
  next();
}

/**
 * Deletes the signed-in account. The login, email and sessions go; the results the person recorded
 * stay in their clubs under the player name, no longer linked to anyone. A club the person owns
 * must be handed on first unless they are its only member, in which case it goes with them.
 */
router.post("/account/delete", requireUser, async (req, res): Promise<void> => {
  const user = res.locals.identityUser as IdentityUser;
  const [credential] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, user.id), eq(userAccounts.providerId, "credential"), isNotNull(userAccounts.password)))
    .limit(1);

  if (credential) {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    try {
      await identity.api.verifyPassword({ body: { password }, headers: fromNodeHeaders(req.headers) });
    } catch {
      res.status(400).json({ error: "That password isn't right." });
      return;
    }
  } else if (String(req.body?.confirmEmail ?? "").trim().toLowerCase() !== user.email.toLowerCase()) {
    // Signed in with Google, so there is no password: typing the address confirms it.
    res.status(400).json({ error: "Type your email address to confirm." });
    return;
  }

  const owned = await db
    .select({ clubId: clubs.id, name: clubs.name })
    .from(memberships)
    .innerJoin(clubs, eq(clubs.id, memberships.clubId))
    .where(and(eq(memberships.userId, user.id), eq(memberships.role, "owner")));
  const alone: number[] = [];
  const blocking: string[] = [];
  for (const club of owned) {
    const [{ total }] = await db.select({ total: count() }).from(memberships).where(eq(memberships.clubId, club.clubId));
    if (total > 1) blocking.push(club.name);
    else alone.push(club.clubId);
  }
  if (blocking.length > 0) {
    res.status(409).json({
      error: `You own ${blocking.map((name) => `"${name}"`).join(" and ")}, which still ${blocking.length === 1 ? "has" : "have"} other members. Make someone else the owner, or delete the club, first.`,
    });
    return;
  }

  for (const clubId of alone) await deleteClubData(clubId);
  await db.delete(users).where(eq(users.id, user.id)); // sessions, accounts and memberships cascade; players are unlinked
  for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token", "better-auth.session_data", ACTIVE_CLUB_COOKIE, "poker_year"]) {
    res.clearCookie(name, { path: "/" });
  }
  res.status(204).end();
});

export default router;
