import { Router, type IRouter } from "express";
import {
  CreatePokerLiveActivityBody,
  CreatePokerLiveActivityResponse,
  DeletePokerLiveActivityBody,
  DeletePokerLiveActivityResponse,
  GetPokerDashboardResponse,
  GetPokerLiveActivityResponse,
  GetPokerLiveActivityHistoryResponse,
  GetPublicPokerSummaryResponse,
  EndPokerLiveSessionResponse,
  StartPokerLiveSessionResponse,
  SyncPokerLiveActivityResponse,
  UpdatePokerLiveActivityBody,
  UpdatePokerLiveActivityResponse,
} from "@workspace/api-zod";
import { fetchPokerDashboard, fetchPublicPokerSummary, PokerSheetSourceError } from "../lib/poker-sheet";
import { loadClubDashboard } from "../lib/club-sessions";
import { YEAR_COOKIE, yearCookie } from "./club-data";
import { memberClubId, requireMemberSession } from "../lib/auth";
import { legacyEnabled } from "../lib/club-context";
import { isOriginalClub as isOriginal } from "../lib/club-settings";
import { resolveAttributedPlayer } from "../lib/live-activity-player";
import {
  createLiveActivityEvent,
  deleteLiveActivityEvent,
  getLiveActivityHistory,
  getLiveActivitySnapshot,
  endLiveSession,
  retryLiveActivitySheetSync,
  startLiveSession,
  updateLiveActivityEvent,
} from "../lib/live-activity";

const router: IRouter = Router();

async function validateAttributedPlayer(
  attributedPlayer: string | undefined,
  memberName: string,
): Promise<string | undefined> {
  const value = attributedPlayer?.trim().replace(/\s+/g, " ");
  if (!value || value.toLocaleLowerCase() === memberName.trim().replace(/\s+/g, " ").toLocaleLowerCase()) {
    return undefined;
  }

  return resolveAttributedPlayer(value, memberName, []);
}

router.get("/poker/dashboard", requireMemberSession, async (req, res): Promise<void> => {
  try {
    const forceRefresh = req
      .get("cache-control")
      ?.split(",")
      .some((directive) => directive.trim().toLowerCase() === "no-cache");
    // The Google Sheet is the original club's history. Other clubs start with no history
    // until they record or import their own sessions.
    const clubId = memberClubId(res);
    const isOriginalClub = await isOriginal(clubId);
    const dashboard = isOriginalClub
      ? await fetchPokerDashboard({ forceRefresh })
      : await loadClubDashboard(clubId, res.locals.memberSession.clubName ?? "Your club", yearCookie(req.cookies?.[YEAR_COOKIE]));
    // The sheet changes slowly, so a short browser cache is fine. A club's own results change
    // the moment someone imports or closes a night, so those are never cached.
    res.set("Cache-Control", isOriginalClub ? "private, max-age=30" : "no-store");
    res.json(GetPokerDashboardResponse.parse(dashboard));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load poker dashboard");
    if (error instanceof PokerSheetSourceError) {
      res.status(502).json({
        error: error.message,
        code: "SOURCE_TAB_MISSING",
        sourceTab: error.sourceTab,
      });
      return;
    }

    res
      .status(502)
      .json({ error: "Unable to load the poker sheet right now." });
  }
});

router.get("/poker/public-summary", async (req, res): Promise<void> => {
  // The public snapshot is the original club's page; a general deployment has none.
  if (!legacyEnabled()) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  try {
    const forceRefresh = req
      .get("cache-control")
      ?.split(",")
      .some((directive) => directive.trim().toLowerCase() === "no-cache");
    const summary = await fetchPublicPokerSummary({ forceRefresh });
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
    res.json(GetPublicPokerSummaryResponse.parse(summary));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load public poker summary");
    if (error instanceof PokerSheetSourceError) {
      res.status(502).json({
        error: error.message,
        code: "SOURCE_TAB_MISSING",
        sourceTab: error.sourceTab,
      });
      return;
    }

    res
      .status(502)
      .json({ error: "Unable to load the public poker snapshot right now." });
  }
});

router.get("/poker/live-activity", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  try {
    res.json(GetPokerLiveActivityResponse.parse(await getLiveActivitySnapshot(memberClubId(res))));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load live poker activity");
    res.status(502).json({ error: "Unable to load live poker activity right now." });
  }
});

router.get("/poker/live-activity/history", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  try {
    res.json(
      GetPokerLiveActivityHistoryResponse.parse({
        sessions: await getLiveActivityHistory(memberClubId(res)),
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to load live ledger history");
    res.status(502).json({ error: "Unable to load live ledger history right now." });
  }
});

router.post("/poker/live-activity/sync", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  try {
    res.json(
      SyncPokerLiveActivityResponse.parse(await retryLiveActivitySheetSync(memberClubId(res))),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to retry live ledger sheet backup");
    res.status(502).json({ error: "Unable to retry the live ledger sheet backup." });
  }
});

router.post("/poker/live-activity", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  const parsed = CreatePokerLiveActivityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a positive amount and choose a valid activity type." });
    return;
  }

  try {
    const session = res.locals.memberSession as { memberName: string | null };
    if (!session.memberName) {
      res.status(401).json({ error: "Member authentication required." });
      return;
    }
    const attributedPlayer = await validateAttributedPlayer(
      parsed.data.attributedPlayer,
      session.memberName,
    );
    const snapshot = await createLiveActivityEvent({
      clubId: memberClubId(res),
      ...parsed.data,
      memberName: session.memberName,
        attributedPlayer,
    });
    res.status(201).json(CreatePokerLiveActivityResponse.parse(snapshot));
  } catch (error) {
    req.log.error({ err: error }, "Unable to create live poker activity");
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to save live poker activity.",
    });
  }
});

router.patch(
  "/poker/live-activity/:eventId",
  requireMemberSession,
  async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    res.removeHeader("ETag");
    res.removeHeader("Last-Modified");
    const parsed = UpdatePokerLiveActivityBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.comment.trim()) {
      res.status(400).json({
        error: "Enter a positive amount, choose a valid activity type, and provide an edit reason.",
      });
      return;
    }

    try {
      const session = res.locals.memberSession as { memberName: string | null };
      if (!session.memberName) {
        res.status(401).json({ error: "Member authentication required." });
        return;
      }
      const eventId =
        typeof req.params.eventId === "string"
          ? req.params.eventId
          : req.params.eventId?.[0];
      if (!eventId) {
        res.status(404).json({ error: "Activity entry not found." });
        return;
      }
      const requestedPlayer = parsed.data.attributedPlayer;
      const validatedPlayer = await validateAttributedPlayer(
        parsed.data.attributedPlayer,
        session.memberName,
      );
      const attributedPlayer =
        requestedPlayer === undefined ? undefined : validatedPlayer ?? session.memberName;
      const snapshot = await updateLiveActivityEvent({
        clubId: memberClubId(res),
        eventId,
        ...parsed.data,
        memberName: session.memberName,
        attributedPlayer,
      });
      res.json(UpdatePokerLiveActivityResponse.parse(snapshot));
    } catch (error) {
      req.log.error({ err: error }, "Unable to update live poker activity");
      const message = error instanceof Error ? error.message : "Unable to update live poker activity.";
      res.status(message.includes("no longer exists") ? 404 : 502).json({ error: message });
    }
  },
);

router.post("/poker/live-session/start", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  try {
    const session = res.locals.memberSession as { memberName: string | null };
    if (!session.memberName) {
      res.status(401).json({ error: "Member authentication required." });
      return;
    }
    res.status(201).json(
      StartPokerLiveSessionResponse.parse(await startLiveSession(session.memberName, memberClubId(res))),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to start live poker session");
    res.status(502).json({
      error: error instanceof Error ? error.message : "Unable to start live poker session.",
    });
  }
});

router.post("/poker/live-session/end", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  try {
    const session = res.locals.memberSession as { memberName: string | null };
    if (!session.memberName) {
      res.status(401).json({ error: "Member authentication required." });
      return;
    }
    res.json(EndPokerLiveSessionResponse.parse(await endLiveSession(session.memberName, memberClubId(res))));
  } catch (error) {
    req.log.error({ err: error }, "Unable to end live poker session");
    const message = error instanceof Error ? error.message : "Unable to end live poker session.";
    res.status(message.includes("Start the") || message.includes("Add at least") ? 400 : 502).json({
      error: message,
    });
  }
});

router.delete(
  "/poker/live-activity/:eventId",
  requireMemberSession,
  async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    res.removeHeader("ETag");
    res.removeHeader("Last-Modified");
    const parsed = DeletePokerLiveActivityBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.comment.trim()) {
      res.status(400).json({ error: "Provide a reason before deleting this entry." });
      return;
    }
    try {
      const session = res.locals.memberSession as { memberName: string | null };
      if (!session.memberName) {
        res.status(401).json({ error: "Member authentication required." });
        return;
      }
      const eventId =
        typeof req.params.eventId === "string"
          ? req.params.eventId
          : req.params.eventId?.[0];
      if (!eventId) {
        res.status(404).json({ error: "Activity entry not found." });
        return;
      }
      const snapshot = await deleteLiveActivityEvent(
        eventId,
        session.memberName,
        parsed.data.comment,
        memberClubId(res),
      );
      res.json(DeletePokerLiveActivityResponse.parse(snapshot));
    } catch (error) {
      req.log.error({ err: error }, "Unable to delete live poker activity");
      const message = error instanceof Error ? error.message : "Unable to delete live poker activity.";
      res.status(message.includes("no longer exists") ? 404 : 502).json({ error: message });
    }
  },
);

export default router;
