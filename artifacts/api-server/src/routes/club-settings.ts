import { Router, type IRouter } from "express";
import { adminClubId, memberClubId, requireAdminSession, requireMemberSession } from "../lib/auth";
import { recordAdminAction } from "../lib/admin-audit";
import {
  cleanCurrency,
  cleanGuidelines,
  cleanName,
  cleanTimezone,
} from "../lib/club-settings-parse";
import { getClubSettings, presetList, updateClubSettings, type SettingsPatch } from "../lib/club-settings";
import { PRESETS } from "../lib/points-rules";

const router: IRouter = Router();

router.use("/clubs/current/settings", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

async function payload(clubId: number) {
  const settings = await getClubSettings(clubId);
  return { settings, presets: presetList() };
}

router.get("/clubs/current/settings", requireMemberSession, async (_req, res): Promise<void> => {
  res.json(await payload(memberClubId(res)));
});

router.put("/clubs/current/settings", requireAdminSession, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: SettingsPatch = {};
  const fail = (error: string) => res.status(400).json({ error });

  if ("name" in body) {
    const name = cleanName(body.name);
    if (!name) return void fail("Give the club a name between 2 and 60 characters.");
    patch.name = name;
  }
  if ("currency" in body) {
    const currency = cleanCurrency(body.currency);
    if (!currency) return void fail("Choose a valid currency.");
    patch.currency = currency;
  }
  if ("timezone" in body) {
    const timezone = cleanTimezone(body.timezone);
    if (!timezone) return void fail("Choose a valid timezone.");
    patch.timezone = timezone;
  }
  if ("guidelines" in body) {
    const guidelines = cleanGuidelines(body.guidelines);
    if (guidelines === undefined) return void fail("Keep the club rules under 8,000 characters.");
    patch.guidelines = guidelines;
  }
  if ("points" in body) {
    const points = (body.points ?? {}) as { preset?: unknown };
    if (typeof points.preset === "string" && points.preset in PRESETS) {
      patch.pointsPreset = points.preset;
      patch.pointsRules = null;
    } else {
      return void fail("Choose a points preset.");
    }
  }

  const clubId = adminClubId(res);
  await updateClubSettings(clubId, patch);
  await recordAdminAction("settings_updated", `Updated club settings (${Object.keys(patch).join(", ") || "no changes"}).`, req);
  res.json(await payload(clubId));
});

export default router;
