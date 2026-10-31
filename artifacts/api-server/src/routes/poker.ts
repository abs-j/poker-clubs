import { Router, type IRouter } from "express";
import {
  CreatePokerLiveActivityBody,
  CreatePokerLiveActivityResponse,
  DeletePokerLiveActivityBody,
  DeletePokerLiveActivityResponse,
  GetPokerDashboardResponse,
  GetPokerLiveActivityResponse,
  GetPokerLiveActivityHistoryResponse,
  EndPokerLiveSessionResponse,
  StartPokerLiveSessionResponse,
  UpdatePokerLiveActivityBody,
  UpdatePokerLiveActivityResponse,
} from "@workspace/api-zod";
import { loadClubDashboard } from "../lib/club-sessions";
import { memberClubId, requireMemberSession, type AuthSession } from "../lib/auth";
import { isClubAdmin } from "../lib/club-access";
import { recordAdminAction } from "../lib/admin-audit";
import { LedgerPermissionError, type LedgerActor } from "../lib/ledger-permissions";
import { resolveAttributedPlayer } from "../lib/live-activity-player";
import {
  createLiveActivityEvent,
  deleteLiveActivityEvent,
  getLiveActivityHistory,
  getLiveActivitySnapshot,
  endLiveSession,
  liveSessionRole,
  reopenLiveSession,
  setLiveSessionHost,
  startLiveSession,
  updateLiveActivityEvent,
} from "../lib/live-activity";

const router: IRouter = Router();

function ledgerActor(res: { locals: { memberSession?: AuthSession } }): LedgerActor | null {
  const session = res.locals.memberSession;
  if (!session?.memberName) return null;
  return { name: session.memberName, isAdmin: isClubAdmin(session.clubRole ?? "member") };
}

function refused(error: unknown): number | null {
  return error instanceof LedgerPermissionError ? 403 : null;
}

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
    const dashboard = await loadClubDashboard(memberClubId(res), res.locals.memberSession.clubName ?? "Your club");
    // A club's results change the moment someone imports or closes a night, so they are never cached.
    res.set("Cache-Control", "no-store");
    res.json(GetPokerDashboardResponse.parse(dashboard));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load poker dashboard");
    res.status(502).json({ error: "Unable to load the club's results right now." });
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
      const actor = ledgerActor(res);
      if (!actor) {
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
        actor.name,
      );
      const attributedPlayer =
        requestedPlayer === undefined ? undefined : validatedPlayer ?? actor.name;
      const snapshot = await updateLiveActivityEvent({
        clubId: memberClubId(res),
        eventId,
        ...parsed.data,
        actor,
        attributedPlayer,
      });
      res.json(UpdatePokerLiveActivityResponse.parse(snapshot));
    } catch (error) {
      req.log.error({ err: error }, "Unable to update live poker activity");
      const message = error instanceof Error ? error.message : "Unable to update live poker activity.";
      res.status(refused(error) ?? (message.includes("no longer exists") ? 404 : 502)).json({ error: message });
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
    const actor = ledgerActor(res);
    if (!actor) {
      res.status(401).json({ error: "Member authentication required." });
      return;
    }
    res.json(EndPokerLiveSessionResponse.parse(await endLiveSession(actor, memberClubId(res))));
  } catch (error) {
    req.log.error({ err: error }, "Unable to end live poker session");
    const message = error instanceof Error ? error.message : "Unable to end live poker session.";
    const status = refused(error) ?? (message.includes("Start the") || message.includes("Add at least") ? 400 : message.includes("out by") ? 409 : 502);
    res.status(status).json({ error: message });
  }
});

router.get("/poker/live-session/role", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  try {
    res.json(await liveSessionRole(actor, memberClubId(res)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to load the live session role");
    res.status(502).json({ error: "Unable to load who is hosting right now." });
  }
});

router.post("/poker/live-session/host", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 80) {
    res.status(400).json({ error: "Choose a member to host this night." });
    return;
  }
  try {
    const role = await setLiveSessionHost(actor, memberClubId(res), name);
    await recordAdminAction("night_handed_over", `Handed the open night to ${role.hostName}.`, req);
    res.json(role);
  } catch (error) {
    req.log.error({ err: error }, "Unable to hand over the live session");
    const message = error instanceof Error ? error.message : "Unable to hand this night over.";
    const status = refused(error) ?? (message.includes("not a member") || message.includes("Choose a member") || message.includes("Start a night") ? 400 : 502);
    res.status(status).json({ error: message });
  }
});

router.post("/poker/live-session/reopen", requireMemberSession, async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const actor = ledgerActor(res);
  if (!actor) {
    res.status(401).json({ error: "Member authentication required." });
    return;
  }
  try {
    const snapshot = await reopenLiveSession(actor, memberClubId(res));
    await recordAdminAction("night_reopened", `Reopened live night ${snapshot.sessionKey}.`, req);
    res.json(StartPokerLiveSessionResponse.parse(snapshot));
  } catch (error) {
    req.log.error({ err: error }, "Unable to reopen the live session");
    const message = error instanceof Error ? error.message : "Unable to reopen this night.";
    const status = refused(error) ?? (message.includes("Close the open") ? 409 : message.includes("no closed night") ? 400 : 502);
    res.status(status).json({ error: message });
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
      const actor = ledgerActor(res);
      if (!actor) {
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
        actor,
        parsed.data.comment,
        memberClubId(res),
      );
      res.json(DeletePokerLiveActivityResponse.parse(snapshot));
    } catch (error) {
      req.log.error({ err: error }, "Unable to delete live poker activity");
      const message = error instanceof Error ? error.message : "Unable to delete live poker activity.";
      res.status(refused(error) ?? (message.includes("no longer exists") ? 404 : 502)).json({ error: message });
    }
  },
);

export default router;
