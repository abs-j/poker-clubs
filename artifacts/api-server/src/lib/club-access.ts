import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { asc, eq } from "drizzle-orm";
import { clubs, db, memberships, players } from "@workspace/db";
import { identity } from "./identity";

export const ACTIVE_CLUB_COOKIE = "poker_active_club";

export type ClubRole = "owner" | "admin" | "member";

export type IdentityUser = { id: string; name: string; email: string; emailVerified: boolean };

export type ClubContext = {
  userId: string;
  clubId: number;
  clubSlug: string;
  clubName: string;
  role: ClubRole;
  playerId: number;
  /** The name this person plays under in this club. */
  memberName: string;
};

export const isClubAdmin = (role: ClubRole) => role === "owner" || role === "admin";

export async function identityUser(req: Request): Promise<IdentityUser | null> {
  try {
    const session = await identity.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return null;
    return { id: session.user.id, name: session.user.name, email: session.user.email, emailVerified: Boolean(session.user.emailVerified) };
  } catch {
    return null;
  }
}

export async function membershipsFor(userId: string): Promise<ClubContext[]> {
  const rows = await db
    .select({
      clubId: clubs.id,
      clubSlug: clubs.slug,
      clubName: clubs.name,
      role: memberships.role,
      playerId: players.id,
      memberName: players.displayName,
    })
    .from(memberships)
    .innerJoin(clubs, eq(clubs.id, memberships.clubId))
    .innerJoin(players, eq(players.id, memberships.playerId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((row) => ({ ...row, userId, role: row.role as ClubRole }));
}

/** The club this person is acting in: the one they picked last, else their first. */
export function pickActiveClub(all: ClubContext[], preferredSlug: string | undefined): ClubContext | null {
  return all.find((club) => club.clubSlug === preferredSlug) ?? all[0] ?? null;
}

export async function resolveClubContext(req: Request): Promise<ClubContext | null> {
  const user = await identityUser(req);
  if (!user) return null;
  const all = await membershipsFor(user.id);
  const preferred = req.cookies?.[ACTIVE_CLUB_COOKIE];
  return pickActiveClub(all, typeof preferred === "string" ? preferred : undefined);
}

export function setActiveClubCookie(res: Response, slug: string): void {
  res.cookie(ACTIVE_CLUB_COOKIE, slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "club";
}

export async function uniqueClubSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.slug, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

// No 0/O/1/I so a code read out loud or typed from a screenshot is hard to get wrong.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newInviteCode(length = 10): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

