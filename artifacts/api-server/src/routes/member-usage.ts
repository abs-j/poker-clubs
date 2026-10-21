import { sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  RecordMemberUsageBody,
  RecordMemberUsageResponse,
} from "@workspace/api-zod";
import { db, memberUsage, memberUsageActivity } from "@workspace/db";
import { memberClubId, requireMemberSession } from "../lib/auth";

const router: IRouter = Router();
const MAX_TRACKED_USAGE_SECONDS = 60;
const ACTIVITY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const ACTIVITY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let nextActivityCleanupAt = 0;

router.post("/poker/usage", requireMemberSession, async (req, res): Promise<void> => {
  const memberName = res.locals.memberSession.memberName as string | null;
  if (!memberName) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  const clubId = memberClubId(res);

  const parsed = RecordMemberUsageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { section, pageView, activeSeconds } = parsed.data;
  if (
    !Number.isInteger(activeSeconds) ||
    activeSeconds < 0 ||
    activeSeconds > MAX_TRACKED_USAGE_SECONDS ||
    (!pageView && activeSeconds === 0)
  ) {
    res.status(400).json({ error: "Record a section view or valid visible time." });
    return;
  }

  const updatedAt = new Date();
  const bucketAt = new Date(Math.floor(updatedAt.getTime() / 60_000) * 60_000);
  await db.transaction(async (tx) => {
    await tx
      .insert(memberUsage)
      .values({
        clubId,
        memberName,
        section,
        pageViews: pageView ? 1 : 0,
        activeSeconds,
        lastActiveAt: updatedAt,
      })
      .onConflictDoUpdate({
        target: [memberUsage.clubId, memberUsage.memberName, memberUsage.section],
        set: {
          pageViews: sql`${memberUsage.pageViews} + ${pageView ? 1 : 0}`,
          activeSeconds: sql`${memberUsage.activeSeconds} + ${activeSeconds}`,
          lastActiveAt: updatedAt,
        },
      });
    await tx
      .insert(memberUsageActivity)
      .values({
        clubId,
        memberName,
        section,
        bucketAt,
        pageViews: pageView ? 1 : 0,
        activeSeconds,
      })
      .onConflictDoUpdate({
        target: [
          memberUsageActivity.clubId,
          memberUsageActivity.memberName,
          memberUsageActivity.section,
          memberUsageActivity.bucketAt,
        ],
        set: {
          pageViews: sql`${memberUsageActivity.pageViews} + ${pageView ? 1 : 0}`,
          activeSeconds: sql`${memberUsageActivity.activeSeconds} + ${activeSeconds}`,
        },
      });
  });

  if (updatedAt.getTime() >= nextActivityCleanupAt) {
    try {
      await db
        .delete(memberUsageActivity)
        .where(sql`${memberUsageActivity.bucketAt} < ${new Date(updatedAt.getTime() - ACTIVITY_RETENTION_MS)}`);
      nextActivityCleanupAt = updatedAt.getTime() + ACTIVITY_CLEANUP_INTERVAL_MS;
    } catch (error) {
      req.log.warn({ err: error }, "Could not prune expired member usage activity");
      nextActivityCleanupAt = updatedAt.getTime() + 5 * 60 * 1000;
    }
  }

  res
    .status(202)
    .json(RecordMemberUsageResponse.parse({ accepted: true }));
});

export default router;
