import { Router, type IRouter } from "express";
import {
  DeleteAdminLiveLedgerSessionBody,
  DeleteAdminLiveLedgerSessionParams,
  DeleteAdminLiveLedgerSessionResponse,
  GetAdminLiveLedgerSessionsResponse,
  GetAdminLiveLedgerResetBackupResponse,
  ResetAdminLiveLedgerBody,
  ResetAdminLiveLedgerResponse,
} from "@workspace/api-zod";
import { adminClubId, requireAdminSession } from "../lib/auth";
import { recordAdminAction } from "../lib/admin-audit";
import { removeLiveNights, removeNightsForLiveSession } from "../lib/club-sessions";
import {
  getLiveActivityResetBackup,
  getLiveActivityHistory,
  deleteLiveActivityLedgerSession,
  LiveActivityResetConflictError,
  LiveActivitySessionDeleteConflictError,
  LiveActivitySessionNotClosedError,
  LiveActivitySessionNotFoundError,
  resetLiveActivityLedger,
} from "../lib/live-activity";

const router: IRouter = Router();

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
  next();
});

router.get(
  "/admin/live-ledger/sessions",
  requireAdminSession,
  async (req, res): Promise<void> => {
    try {
      res.json(
        GetAdminLiveLedgerSessionsResponse.parse({
          sessions: await getLiveActivityHistory(adminClubId(res)),
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Unable to load closed live ledger sessions");
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to load closed live ledger sessions.",
      });
    }
  },
);

router.delete(
  "/admin/live-ledger/sessions/:sessionKey",
  requireAdminSession,
  async (req, res): Promise<void> => {
    const parsedParams = DeleteAdminLiveLedgerSessionParams.safeParse(req.params);
    const parsedBody = DeleteAdminLiveLedgerSessionBody.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      res.status(400).json({
        error: "Download a fresh backup and provide the session confirmation.",
      });
      return;
    }
    if (parsedBody.data.confirmation !== `DELETE ${parsedParams.data.sessionKey}`) {
      res.status(400).json({
        error: `Type DELETE ${parsedParams.data.sessionKey} exactly to confirm.`,
      });
      return;
    }

    try {
      const result = DeleteAdminLiveLedgerSessionResponse.parse(
        await deleteLiveActivityLedgerSession(
          parsedParams.data.sessionKey,
          parsedBody.data.backupId,
          adminClubId(res),
        ),
      );
      await removeNightsForLiveSession(adminClubId(res), result.sessionKey);
      req.log.info(
        {
          environment: result.environment,
          sessionKey: result.sessionKey,
          deletedEvents: result.deletedEvents,
          deletedComments: result.deletedComments,
          clearedSheetRows: result.clearedSheetRows,
        },
        "Admin deleted a closed live ledger session",
      );
      await recordAdminAction(
        "ledger_session_deleted",
        `Deleted closed session ${result.sessionKey} (${result.deletedEvents} entries, ${result.deletedComments} comments).`,
        req,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof LiveActivitySessionNotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (
        error instanceof LiveActivitySessionDeleteConflictError ||
        error instanceof LiveActivitySessionNotClosedError
      ) {
        res.status(409).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Unable to delete a closed live ledger session");
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to delete the closed live ledger session.",
      });
    }
  },
);

router.get(
  "/admin/live-ledger/backup",
  requireAdminSession,
  async (req, res): Promise<void> => {
    try {
      const backup = GetAdminLiveLedgerResetBackupResponse.parse(
        await getLiveActivityResetBackup(adminClubId(res)),
      );
      const date = backup.createdAt.toISOString().slice(0, 10);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="live-ledger-${backup.environment}-${date}.json"`,
      );
      await recordAdminAction("ledger_backup", `Downloaded a ledger backup (${backup.environment}).`, req);
      res.json(backup);
    } catch (error) {
      req.log.error({ err: error }, "Unable to prepare a live ledger backup");
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare a live ledger backup.",
      });
    }
  },
);

router.post(
  "/admin/live-ledger/reset",
  requireAdminSession,
  async (req, res): Promise<void> => {
    const parsed = ResetAdminLiveLedgerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Download a fresh backup and provide the exact reset confirmation.",
      });
      return;
    }

    try {
      const result = ResetAdminLiveLedgerResponse.parse(
        await resetLiveActivityLedger(parsed.data.backupId, adminClubId(res)),
      );
      await removeLiveNights(adminClubId(res));
      req.log.info(
        {
          environment: result.environment,
          deletedSessions: result.deletedSessions,
          deletedEvents: result.deletedEvents,
          deletedComments: result.deletedComments,
          clearedSheetRows: result.clearedSheetRows,
        },
        "Admin reset the live ledger",
      );
      await recordAdminAction(
        "ledger_reset",
        `Reset the live ledger (${result.deletedSessions} sessions, ${result.deletedEvents} entries removed).`,
        req,
      );
      res.json(result);
    } catch (error) {
      if (error instanceof LiveActivityResetConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "Unable to reset the live ledger");
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "Unable to reset the live ledger.",
      });
    }
  },
);

export default router;