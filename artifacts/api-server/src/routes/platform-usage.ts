import { Router, type IRouter } from "express";
import { asc, count, max } from "drizzle-orm";
import { clubs, db, memberUsage, siteVisits } from "@workspace/db";
import { requirePlatformAdmin } from "../lib/platform-admin";

const router: IRouter = Router();

function stamp(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function later(current: string | null, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  return next > current ? next : current;
}

type MemberUsage = {
  name: string;
  signIns: number;
  lastSignInAt: string | null;
  activeSeconds: number;
  lastActiveAt: string | null;
  sections: { section: string; pageViews: number; activeSeconds: number; lastActiveAt: string }[];
};

// The one read that is not limited to the caller's club. The caller is the site owner
// (an email on PLATFORM_ADMIN_EMAILS), and this handler only reads.
router.get("/platform/usage", requirePlatformAdmin, async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const [clubRows, visitRows, usageRows] = await Promise.all([
    db.select({ id: clubs.id, name: clubs.name, slug: clubs.slug }).from(clubs).orderBy(asc(clubs.name), asc(clubs.id)),
    db
      .select({
        clubId: siteVisits.clubId,
        name: siteVisits.memberName,
        signIns: count(),
        lastSignInAt: max(siteVisits.visitedAt),
      })
      .from(siteVisits)
      .groupBy(siteVisits.clubId, siteVisits.memberName),
    db
      .select({
        clubId: memberUsage.clubId,
        name: memberUsage.memberName,
        section: memberUsage.section,
        pageViews: memberUsage.pageViews,
        activeSeconds: memberUsage.activeSeconds,
        lastActiveAt: memberUsage.lastActiveAt,
      })
      .from(memberUsage),
  ]);

  const byClub = new Map<number, Map<string, MemberUsage>>();
  const ensure = (clubId: number | null, name: string): MemberUsage | null => {
    if (clubId == null) return null;
    const key = name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (!key) return null;
    let members = byClub.get(clubId);
    if (!members) {
      members = new Map();
      byClub.set(clubId, members);
    }
    let member = members.get(key);
    if (!member) {
      member = {
        name: name.trim().replace(/\s+/g, " "),
        signIns: 0,
        lastSignInAt: null,
        activeSeconds: 0,
        lastActiveAt: null,
        sections: [],
      };
      members.set(key, member);
    }
    return member;
  };

  for (const row of visitRows) {
    const member = ensure(row.clubId, row.name);
    if (!member) continue;
    member.signIns += Number(row.signIns);
    member.lastSignInAt = later(member.lastSignInAt, stamp(row.lastSignInAt));
  }
  for (const row of usageRows) {
    const member = ensure(row.clubId, row.name);
    if (!member || !row.section) continue;
    const at = stamp(row.lastActiveAt);
    member.activeSeconds += Number(row.activeSeconds);
    member.lastActiveAt = later(member.lastActiveAt, at);
    if (at) {
      member.sections.push({
        section: row.section,
        pageViews: Number(row.pageViews),
        activeSeconds: Number(row.activeSeconds),
        lastActiveAt: at,
      });
    }
  }

  res.json({
    clubs: clubRows.map((club) => {
      const members = [...(byClub.get(club.id)?.values() ?? [])]
        .map((member) => ({
          ...member,
          sections: member.sections.slice().sort((a, b) => b.activeSeconds - a.activeSeconds || a.section.localeCompare(b.section)),
        }))
        .sort((a, b) => b.activeSeconds - a.activeSeconds || b.signIns - a.signIns || a.name.localeCompare(b.name));
      return {
        id: club.id,
        name: club.name,
        slug: club.slug,
        signIns: members.reduce((sum, member) => sum + member.signIns, 0),
        lastSignInAt: members.reduce<string | null>((latest, member) => later(latest, member.lastSignInAt), null),
        activeSeconds: members.reduce((sum, member) => sum + member.activeSeconds, 0),
        members,
      };
    }),
  });
});

export default router;
