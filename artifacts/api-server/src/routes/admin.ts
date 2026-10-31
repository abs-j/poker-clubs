import { Router, type IRouter } from "express";
import {
  GetAdminLiveLedgerResetBackupResponse,
  ResetAdminLiveLedgerBody,
  ResetAdminLiveLedgerResponse,
} from "@workspace/api-zod";
import { adminClubId, requireAdminSession } from "../lib/auth";
import { recordAdminAction } from "../lib/admin-audit";
import { removeLiveNights } from "../lib/club-sessions";
import {
  getLiveActivityResetBackup,
  LiveActivityResetConflictError,
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