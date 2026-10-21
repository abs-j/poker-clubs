import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import clubsRouter from "./clubs";
import clubDataRouter from "./club-data";
import clubSettingsRouter from "./club-settings";
import devEmailRouter from "./dev-email";
import accountRouter from "./account";
import memberUsageRouter from "./member-usage";
import avatarsRouter from "./avatars";
import pokerRouter from "./poker";
import adminRouter from "./admin";
import adminInsightsRouter from "./admin-insights";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(clubsRouter);
router.use(clubDataRouter);
router.use(clubSettingsRouter);
router.use(devEmailRouter);
router.use(accountRouter);
router.use(memberUsageRouter);
router.use(avatarsRouter);
router.use(pokerRouter);
router.use(adminRouter);
router.use(adminInsightsRouter);

export default router;
