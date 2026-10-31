import { Router, type IRouter } from "express";
import { recordAccountVisit } from "../lib/auth";
import {
  ACTIVE_CLUB_COOKIE,
  identityUser,
  membershipsFor,
  pickActiveClub,
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

export default router;
