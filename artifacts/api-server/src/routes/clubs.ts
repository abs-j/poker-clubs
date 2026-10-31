import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, count, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { clubs, db, invites, memberships, players, sessionResults, tournamentResults, userAccounts, users } from "@workspace/db";
import { deleteClubData } from "../lib/club-delete";
import { isOriginalClub } from "../lib/club-settings";
import { adminClubId, requireAdminSession, requireMemberSession } from "../lib/auth";
import {
  identityUser,
  membershipsFor,
  newInviteCode,
  nameKey,
  normalizeInviteCode,
  pickActiveClub,
  setActiveClubCookie,
  uniqueClubSlug,
  ACTIVE_CLUB_COOKIE,
  type ClubRole,
  type IdentityUser,
} from "../lib/club-access";
import { googleSignInEnabled } from "../lib/identity";
import { trustedOrigin } from "../lib/origins";
import { emailMode, sendEmail } from "../lib/email";
import { inviteMessage } from "../lib/email-templates";

const router: IRouter = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const MAX_OWNED_CLUBS = 5;
const MAX_ACTIVE_INVITES = 25;

function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length >= min && text.length <= max ? text : null;
}

async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await identityUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }
  res.locals.identityUser = user;
  next();
}

const userOf = (res: Response) => res.locals.identityUser as IdentityUser;

// ----------------------------------------------------------------- who am I

/** Everything the sign-in screens need in one call: the account, its clubs, and what is on offer. */
router.get("/clubs/me", async (req, res): Promise<void> => {
  const user = await identityUser(req);
  const options = {
    googleSignIn: googleSignInEnabled,
    legacyAccessCodes: Boolean(process.env.MEMBER_ACCESS_CODES),
    // Whether the server can send email: password reset, email confirmation and emailed invites.
    email: emailMode() !== "off",
  };
  if (!user) {
    res.json({ user: null, clubs: [], active: null, options });
    return;
  }
  const all = await membershipsFor(user.id);
  const preferred = req.cookies?.[ACTIVE_CLUB_COOKIE];
  const active = pickActiveClub(all, typeof preferred === "string" ? preferred : undefined);
  const [credential] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(and(eq(userAccounts.userId, user.id), eq(userAccounts.providerId, "credential"), isNotNull(userAccounts.password)))
    .limit(1);
  res.json({
    user: { ...user, hasPassword: Boolean(credential) },
    clubs: all.map((club) => ({
      id: club.clubId,
      slug: club.clubSlug,
      name: club.clubName,
      role: club.role,
      playerName: club.memberName,
    })),
    active: active?.clubSlug ?? null,
    options,
  });
});

router.post("/clubs/active", requireUser, async (req, res): Promise<void> => {
  const slug = cleanText(req.body?.slug, 1, 64);
  const all = await membershipsFor(userOf(res).id);
  const target = all.find((club) => club.clubSlug === slug);
  if (!target) {
    res.status(404).json({ error: "You are not a member of that club." });
    return;
  }
  setActiveClubCookie(res, target.clubSlug);
  res.json({ active: target.clubSlug });
});

// ------------------------------------------------------------- create a club

router.post("/clubs", requireUser, async (req, res): Promise<void> => {
  const user = userOf(res);
  const name = cleanText(req.body?.name, 2, 60);
  if (!name) {
    res.status(400).json({ error: "Give the club a name between 2 and 60 characters." });
    return;
  }
  const playerName = cleanText(req.body?.playerName ?? user.name, 1, 40);
  if (!playerName) {
    res.status(400).json({ error: "Enter the name you play under (up to 40 characters)." });
    return;
  }
  const currency = typeof req.body?.currency === "string" && /^[A-Za-z]{3}$/.test(req.body.currency)
    ? req.body.currency.toUpperCase()
    : "AUD";

  const [owned] = await db
    .select({ total: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.role, "owner")));
  if ((owned?.total ?? 0) >= MAX_OWNED_CLUBS) {
    res.status(400).json({ error: `You can run up to ${MAX_OWNED_CLUBS} clubs.` });
    return;
  }

  const slug = await uniqueClubSlug(name);
  const club = await db.transaction(async (tx) => {
    const [created] = await tx.insert(clubs).values({ slug, name, currency }).returning();
    const [player] = await tx
      .insert(players)
      .values({ clubId: created.id, displayName: playerName, nameKey: nameKey(playerName), userId: user.id })
      .returning();
    await tx.insert(memberships).values({ clubId: created.id, userId: user.id, playerId: player.id, role: "owner" });
    // A link is ready to share straight away, so the first step after creating a club is one tap.
    await tx.insert(invites).values({ clubId: created.id, code: newInviteCode(), role: "member", createdBy: user.id });
    return created;
  });
  setActiveClubCookie(res, club.slug);
  res.status(201).json({ club: { id: club.id, slug: club.slug, name: club.name } });
});

// ------------------------------------------------------------- joining

/** What an invite code leads to. The code is the capability, so it may see unclaimed names. */
router.get("/invites/:code", async (req, res): Promise<void> => {
  const code = normalizeInviteCode(String(req.params.code ?? ""));
  const [row] = await db
    .select({ invite: invites, clubName: clubs.name, clubSlug: clubs.slug })
    .from(invites)
    .innerJoin(clubs, eq(clubs.id, invites.clubId))
    .where(eq(invites.code, code))
    .limit(1);
  if (!row || !inviteUsable(row.invite)) {
    res.status(404).json({ error: "This invite link is not valid any more. Ask the club for a new one." });
    return;
  }
  const claimable = await db
    .select({ id: players.id, displayName: players.displayName })
    .from(players)
    .where(and(eq(players.clubId, row.invite.clubId), isNull(players.userId)))
    .orderBy(asc(players.displayName));
  res.json({
    club: { name: row.clubName, slug: row.clubSlug },
    role: row.invite.role,
    claimable,
  });
});

function inviteUsable(invite: typeof invites.$inferSelect): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) return false;
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return false;
  return true;
}

class JoinError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

router.post("/invites/:code/accept", requireUser, async (req, res): Promise<void> => {
  const user = userOf(res);
  const code = normalizeInviteCode(String(req.params.code ?? ""));
  const claimPlayerId = Number.isInteger(req.body?.claimPlayerId) ? (req.body.claimPlayerId as number) : null;
  const newName = claimPlayerId === null ? cleanText(req.body?.name ?? user.name, 1, 40) : null;
  if (claimPlayerId === null && !newName) {
    res.status(400).json({ error: "Enter the name you play under (up to 40 characters)." });
    return;
  }

  try {
    const joined = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(invites).where(eq(invites.code, code)).limit(1).for("update");
      if (!invite || !inviteUsable(invite)) {
        throw new JoinError("This invite link is not valid any more. Ask the club for a new one.", 404);
      }
      const [club] = await tx.select().from(clubs).where(eq(clubs.id, invite.clubId)).limit(1);

      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.clubId, invite.clubId), eq(memberships.userId, user.id)))
        .limit(1);
      if (existing) return club; // Already in: opening the link again is harmless.

      let playerId: number;
      if (claimPlayerId !== null) {
        // Claim atomically: only a name nobody has claimed yet.
        const [claimed] = await tx
          .update(players)
          .set({ userId: user.id })
          .where(and(eq(players.id, claimPlayerId), eq(players.clubId, invite.clubId), isNull(players.userId)))
          .returning({ id: players.id });
        if (!claimed) throw new JoinError("That name has already been taken. Pick another or add a new one.", 409);
        playerId = claimed.id;
      } else {
        const key = nameKey(newName!);
        const [sameName] = await tx
          .select({ id: players.id, userId: players.userId })
          .from(players)
          .where(and(eq(players.clubId, invite.clubId), eq(players.nameKey, key)))
          .limit(1);
        if (sameName) {
          throw new JoinError(
            sameName.userId
              ? "Someone in this club already uses that name. Add a last initial or pick another."
              : "That name is in the club's history. Pick it from the list to claim it.",
            409,
          );
        }
        const [created] = await tx
          .insert(players)
          .values({ clubId: invite.clubId, displayName: newName!, nameKey: key, userId: user.id })
          .returning({ id: players.id });
        playerId = created.id;
      }

      await tx.insert(memberships).values({
        clubId: invite.clubId,
        userId: user.id,
        playerId,
        role: invite.role === "admin" ? "admin" : "member",
      });
      await tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.id, invite.id));
      return club;
    });
    setActiveClubCookie(res, joined.slug);
    res.json({ club: { id: joined.id, slug: joined.slug, name: joined.name } });
  } catch (error) {
    if (error instanceof JoinError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

// ------------------------------------------------------------- the current club

router.get("/clubs/current/members", requireMemberSession, async (_req, res): Promise<void> => {
  const session = res.locals.memberSession as { clubId: number; clubRole?: ClubRole };
  const isAdmin = session.clubRole === "owner" || session.clubRole === "admin";
  const rows = await db
    .select({
      playerId: players.id,
      name: players.displayName,
      userId: players.userId,
      role: memberships.role,
      email: users.email,
      joinedAt: memberships.createdAt,
    })
    .from(players)
    .leftJoin(memberships, eq(memberships.playerId, players.id))
    .leftJoin(users, eq(users.id, players.userId))
    .where(eq(players.clubId, session.clubId))
    .orderBy(asc(players.displayName));
  res.json({
    members: rows.map((row) => ({
      playerId: row.playerId,
      name: row.name,
      role: row.role,
      claimed: Boolean(row.userId),
      userId: isAdmin ? row.userId : undefined,
      email: isAdmin ? row.email : undefined,
      joinedAt: row.joinedAt?.toISOString() ?? null,
    })),
  });
});

/** Adds a name to the club roster without an account, so history can be attached before people join. */
router.post("/clubs/current/players", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const name = cleanText(req.body?.name, 1, 40);
  if (!name) {
    res.status(400).json({ error: "Enter a name up to 40 characters." });
    return;
  }
  const [created] = await db
    .insert(players)
    .values({ clubId, displayName: name, nameKey: nameKey(name) })
    .onConflictDoNothing({ target: [players.clubId, players.nameKey] })
    .returning({ id: players.id, displayName: players.displayName });
  if (!created) {
    res.status(409).json({ error: "That name is already on the roster." });
    return;
  }
  res.status(201).json({ player: created });
});

router.get("/clubs/current/invites", requireAdminSession, async (_req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const rows = await db
    .select()
    .from(invites)
    .where(and(eq(invites.clubId, clubId), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt));
  res.json({
    invites: rows.map((invite) => ({
      id: invite.id,
      code: invite.code,
      role: invite.role,
      uses: invite.uses,
      maxUses: invite.maxUses,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      usable: inviteUsable(invite),
      createdAt: invite.createdAt.toISOString(),
    })),
  });
});

router.post("/clubs/current/invites", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const session = res.locals.adminSession as { userId?: string; clubRole?: ClubRole };
  const role = req.body?.role === "admin" ? "admin" : "member";
  if (role === "admin" && session.clubRole !== "owner") {
    res.status(403).json({ error: "Only the club owner can create an admin invite." });
    return;
  }
  const days = Number.isInteger(req.body?.expiresInDays) ? (req.body.expiresInDays as number) : null;
  const maxUses = Number.isInteger(req.body?.maxUses) && req.body.maxUses > 0 ? (req.body.maxUses as number) : null;
  if (days !== null && (days < 1 || days > 365)) {
    res.status(400).json({ error: "Expiry must be between 1 and 365 days." });
    return;
  }

  const [active] = await db
    .select({ total: count() })
    .from(invites)
    .where(and(eq(invites.clubId, clubId), isNull(invites.revokedAt)));
  if ((active?.total ?? 0) >= MAX_ACTIVE_INVITES) {
    res.status(400).json({ error: "Revoke an old invite before creating another." });
    return;
  }

  const [invite] = await db
    .insert(invites)
    .values({
      clubId,
      code: newInviteCode(),
      role,
      createdBy: session.userId ?? null,
      maxUses,
      expiresAt: days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    })
    .returning();
  res.status(201).json({ invite: { id: invite.id, code: invite.code, role: invite.role } });
});

const MAX_EMAILED_INVITES_PER_DAY = 20;
const INVITE_EMAIL_DAYS = 14;
const EMAIL_SHAPE = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[A-Za-z]{2,}$/;

/** The address people reach the app at, for links in email. Only an origin this app is served from is ever used. */
function publicOrigin(req: Request): string {
  const origin = req.get("origin");
  if (trustedOrigin(origin)) return origin;
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

/** Emails a one-use invite. The recipient is never told apart from a stranger: no account lookup happens here. */
router.post("/clubs/current/invites/email", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const session = res.locals.adminSession as { userId?: string; memberName?: string | null };
  if (emailMode() === "off") {
    res.status(400).json({ error: "Email isn't set up on this server, so share the invite link instead." });
    return;
  }
  const to = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!EMAIL_SHAPE.test(to)) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recent] = await db
    .select({ total: count() })
    .from(invites)
    .where(and(eq(invites.clubId, clubId), isNotNull(invites.emailedTo), gt(invites.createdAt, since)));
  if ((recent?.total ?? 0) >= MAX_EMAILED_INVITES_PER_DAY) {
    res.status(429).json({ error: `This club has emailed ${MAX_EMAILED_INVITES_PER_DAY} invites today. Share the link instead, or try again tomorrow.` });
    return;
  }

  const [club] = await db.select({ name: clubs.name }).from(clubs).where(eq(clubs.id, clubId)).limit(1);
  const [invite] = await db
    .insert(invites)
    .values({
      clubId,
      code: newInviteCode(),
      role: "member",
      createdBy: session.userId ?? null,
      emailedTo: to,
      maxUses: 1,
      expiresAt: new Date(Date.now() + INVITE_EMAIL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning();
  try {
    await sendEmail(
      inviteMessage({ to, clubName: club?.name ?? "the club", inviterName: session.memberName ?? "A club admin", url: `${publicOrigin(req)}/join/${invite.code}` }),
    );
  } catch (error) {
    // No email went out, so the invite shouldn't linger as if it had.
    await db.delete(invites).where(eq(invites.id, invite.id));
    req.log.error({ err: error }, "Could not send an invite email");
    res.status(502).json({ error: "Couldn't send that email. Try again, or share the invite link." });
    return;
  }
  res.status(201).json({ sent: true });
});

router.delete("/clubs/current/invites/:id", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid invite." });
    return;
  }
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, id), eq(invites.clubId, clubId)));
  res.status(204).end();
});

router.patch("/clubs/current/members/:playerId", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const actor = res.locals.adminSession as { userId?: string; clubRole?: ClubRole };
  const playerId = Number(req.params.playerId);
  const role = req.body?.role;
  if (!Number.isInteger(playerId) || (role !== "admin" && role !== "member" && role !== "owner")) {
    res.status(400).json({ error: "Choose owner, admin or member." });
    return;
  }
  if (actor.clubRole !== "owner") {
    res.status(403).json({ error: "Only the club owner can change roles." });
    return;
  }
  const [target] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.clubId, clubId), eq(memberships.playerId, playerId)))
    .limit(1);
  if (!target) {
    res.status(404).json({ error: "That person is not a member." });
    return;
  }
  if (target.role === "owner") {
    res.status(400).json({ error: "The owner's role can't be changed." });
    return;
  }
  if (role === "owner") {
    // Handing the club over: the new owner takes the role and the previous owner steps down to admin.
    if (!actor.userId) {
      res.status(400).json({ error: "Only a signed-in owner can hand the club over." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.update(memberships).set({ role: "owner" }).where(eq(memberships.id, target.id));
      await tx
        .update(memberships)
        .set({ role: "admin" })
        .where(and(eq(memberships.clubId, clubId), eq(memberships.userId, actor.userId!)));
    });
    res.json({ playerId, role });
    return;
  }
  await db.update(memberships).set({ role }).where(eq(memberships.id, target.id));
  res.json({ playerId, role });
});

/** Permanently deletes the club and everything in it. Owner only, and the club's exact name must be typed. */
router.delete("/clubs/current", requireMemberSession, async (req, res): Promise<void> => {
  const session = res.locals.memberSession as { userId?: string; clubId: number; clubRole?: ClubRole };
  if (!session.userId || session.clubRole !== "owner") {
    res.status(403).json({ error: "Only the club owner can delete the club." });
    return;
  }
  if (await isOriginalClub(session.clubId)) {
    res.status(400).json({ error: "The original club can't be deleted from here." });
    return;
  }
  const [club] = await db.select({ name: clubs.name }).from(clubs).where(eq(clubs.id, session.clubId)).limit(1);
  const typed = typeof req.body?.confirmName === "string" ? req.body.confirmName.trim() : "";
  if (!club || typed !== club.name) {
    res.status(400).json({ error: "Type the club's name exactly to confirm." });
    return;
  }
  await deleteClubData(session.clubId);
  res.clearCookie(ACTIVE_CLUB_COOKIE, { path: "/" });
  res.status(204).end();
});

async function removeMembership(clubId: number, membershipId: number, playerId: number) {
  await db.transaction(async (tx) => {
    await tx.delete(memberships).where(eq(memberships.id, membershipId));
    // The name and its history stay; the name can be claimed again by someone with an invite.
    await tx.update(players).set({ userId: null }).where(and(eq(players.id, playerId), eq(players.clubId, clubId)));
  });
}

router.delete("/clubs/current/members/:playerId", requireAdminSession, async (req, res): Promise<void> => {
  const clubId = adminClubId(res);
  const actor = res.locals.adminSession as { clubRole?: ClubRole };
  const playerId = Number(req.params.playerId);
  const [target] = Number.isInteger(playerId)
    ? await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.clubId, clubId), eq(memberships.playerId, playerId)))
        .limit(1)
    : [];
  if (!target) {
    res.status(404).json({ error: "That person is not a member." });
    return;
  }
  if (target.role === "owner") {
    res.status(400).json({ error: "The owner can't be removed." });
    return;
  }
  if (target.role === "admin" && actor.clubRole !== "owner") {
    res.status(403).json({ error: "Only the owner can remove an admin." });
    return;
  }
  await removeMembership(clubId, target.id, playerId);
  res.status(204).end();
});

/**
 * "That name in the history is me." Points my membership at an unclaimed name, so history
 * recorded before I joined becomes mine. Only allowed while my current name has no results.
 */
router.post("/clubs/current/claim", requireMemberSession, async (req, res): Promise<void> => {
  const session = res.locals.memberSession as { userId?: string; clubId: number };
  const targetId = Number.isInteger(req.body?.playerId) ? (req.body.playerId as number) : null;
  if (!session.userId || targetId === null) {
    res.status(400).json({ error: "Choose a name from the club's list." });
    return;
  }
  try {
    const claimed = await db.transaction(async (tx) => {
      const [mine] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.clubId, session.clubId), eq(memberships.userId, session.userId!)))
        .limit(1)
        .for("update");
      if (!mine) throw new JoinError("You are not a member of this club.", 403);
      if (mine.playerId === targetId) return null;

      const [{ cash }] = await tx.select({ cash: count() }).from(sessionResults).where(eq(sessionResults.playerId, mine.playerId));
      const [{ tournaments }] = await tx.select({ tournaments: count() }).from(tournamentResults).where(eq(tournamentResults.playerId, mine.playerId));
      if (cash + tournaments > 0) {
        throw new JoinError("Your current name already has results, so it can't be swapped. Ask a club admin to remove it from the roster first.", 409);
      }
      const [target] = await tx
        .update(players)
        .set({ userId: session.userId! })
        .where(and(eq(players.id, targetId), eq(players.clubId, session.clubId), isNull(players.userId)))
        .returning({ id: players.id, name: players.displayName });
      if (!target) throw new JoinError("That name has already been taken.", 409);

      await tx.update(memberships).set({ playerId: target.id }).where(eq(memberships.id, mine.id));
      // The name I am leaving was only ever mine and has no history, so it goes.
      await tx.delete(players).where(eq(players.id, mine.playerId));
      return target;
    });
    res.json({ playerName: claimed?.name ?? null });
  } catch (error) {
    if (error instanceof JoinError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
});

router.delete("/clubs/current/membership", requireMemberSession, async (_req, res): Promise<void> => {
  const session = res.locals.memberSession as { userId?: string; clubId: number; clubRole?: ClubRole };
  if (!session.userId) {
    res.status(400).json({ error: "Only signed-in accounts can leave a club." });
    return;
  }
  if (session.clubRole === "owner") {
    res.status(400).json({ error: "The owner can't leave. Hand the club to someone else first." });
    return;
  }
  const [mine] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.clubId, session.clubId), eq(memberships.userId, session.userId)))
    .limit(1);
  if (mine) await removeMembership(session.clubId, mine.id, mine.playerId);
  res.clearCookie(ACTIVE_CLUB_COOKIE, { path: "/" });
  res.status(204).end();
});

export default router;
