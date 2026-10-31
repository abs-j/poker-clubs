import { Router, type IRouter } from "express";
import { recordAccountVisit } from "../lib/auth";
import {
  ACTIVE_CLUB_COOKIE,
  identityUser,
  isClubAdmin,
  membershipsFor,
  pickActiveClub,
  resolveClubContext,
} from "../lib/club-access";
import { isPlatformAdminEmail } from "../lib/platform-admin";

const router: IRouter = Router();
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
  next();
});

/** Who is signed in, and as what, for the club they are acting in. Sign-in itself lives under /api/identity. */
router.get("/auth/member/session", async (req, res): Promise<void> => {
  const user = await identityUser(req);
  if (!user) {
    res.json({ authenticated: false, platformAdmin: false });
    return;
  }
  const platformAdmin = isPlatformAdminEmail(user.email);
  const preferred = req.cookies?.[ACTIVE_CLUB_COOKIE];
  const context = pickActiveClub(await membershipsFor(user.id), typeof preferred === "string" ? preferred : undefined);
  if (!context) {
    res.json({ authenticated: false, platformAdmin });
    return;
  }
  await recordAccountVisit(context.clubId, context.memberName).catch(() => undefined);
  res.json({
    authenticated: true,
    memberName: context.memberName,
    platformAdmin,
    club: { id: context.clubId, slug: context.clubSlug, name: context.clubName, role: context.role },
  });
});

router.get("/auth/admin/session", async (req, res): Promise<void> => {
  // Club owners and admins. This does not grant the platform usage page.
  const context = await resolveClubContext(req);
  if (context && isClubAdmin(context.role)) {
    res.json({ authenticated: true, expiresAt: null, clubRole: context.role });
    return;
  }
  res.json({ authenticated: false });
});

export default router;
