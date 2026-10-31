import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, memberAvatars } from "@workspace/db";
import { memberClubId, requireMemberSession } from "../lib/auth";
import { normalizeMemberKey, parseAvatarInput } from "../lib/avatar-image";

const router: IRouter = Router();

// The list carries no image bytes, so it stays small. Uploaded pictures are fetched one by
// one from the image route below and cached by the browser until their version changes.
router.get("/poker/avatars", requireMemberSession, async (_req, res): Promise<void> => {
  const clubId = memberClubId(res);
  const rows = await db
    .select({
      key: memberAvatars.memberKey,
      name: memberAvatars.memberName,
      kind: memberAvatars.kind,
      preset: memberAvatars.preset,
      version: memberAvatars.version,
    })
    .from(memberAvatars)
    .where(eq(memberAvatars.clubId, clubId));
  res.setHeader("Cache-Control", "private, no-cache");
  res.json({ avatars: rows });
});

router.get("/poker/avatars/image/:key", requireMemberSession, async (req, res): Promise<void> => {
  const clubId = memberClubId(res);
  const key = normalizeMemberKey(String(req.params.key ?? ""));
  const [row] = await db
    .select({ image: memberAvatars.imageBase64, contentType: memberAvatars.contentType, kind: memberAvatars.kind })
    .from(memberAvatars)
    .where(and(eq(memberAvatars.clubId, clubId), eq(memberAvatars.memberKey, key)))
    .limit(1);
  if (!row || row.kind !== "upload" || !row.image || !row.contentType) {
    res.status(404).json({ error: "No picture." });
    return;
  }
  res.setHeader("Content-Type", row.contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  // The page adds ?v=<version>, so a changed picture always gets a new URL.
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.send(Buffer.from(row.image, "base64"));
});

router.put("/poker/avatars/me", requireMemberSession, async (req, res): Promise<void> => {
  const clubId = memberClubId(res);
  const memberName = res.locals.memberSession?.memberName as string | null | undefined;
  if (!memberName) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  const parsed = parseAvatarInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const memberKey = normalizeMemberKey(memberName);
  const values =
    parsed.kind === "preset"
      ? { kind: "preset", preset: parsed.preset, imageBase64: null, contentType: null }
      : { kind: "upload", preset: null, imageBase64: parsed.imageBase64, contentType: parsed.contentType };
  const now = new Date();

  const [existing] = await db
    .select({ version: memberAvatars.version })
    .from(memberAvatars)
    .where(and(eq(memberAvatars.clubId, clubId), eq(memberAvatars.memberKey, memberKey)))
    .limit(1);
  const version = (existing?.version ?? 0) + 1;

  await db
    .insert(memberAvatars)
    .values({ clubId, memberKey, memberName, ...values, version, updatedAt: now })
    .onConflictDoUpdate({
      target: [memberAvatars.clubId, memberAvatars.memberKey],
      set: { memberName, ...values, version, updatedAt: now },
    });

  res.json({ key: memberKey, name: memberName, kind: parsed.kind, preset: values.preset, version });
});

router.delete("/poker/avatars/me", requireMemberSession, async (_req, res): Promise<void> => {
  const clubId = memberClubId(res);
  const memberName = res.locals.memberSession?.memberName as string | null | undefined;
  if (!memberName) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  await db.delete(memberAvatars).where(and(eq(memberAvatars.clubId, clubId), eq(memberAvatars.memberKey, normalizeMemberKey(memberName))));
  res.status(204).end();
});

export default router;
