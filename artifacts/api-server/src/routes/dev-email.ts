import { Router, type IRouter } from "express";
import { devOutbox, emailMode } from "../lib/email";

const router: IRouter = Router();

// Lets a developer (or the smoke test) read the emails the app "sent" while no mail provider is
// configured. It exists only in log mode, which can never be on in production.
if (emailMode() === "log" && process.env.NODE_ENV !== "production") {
  router.get("/dev/emails", (_req, res): void => {
    res.set("Cache-Control", "no-store");
    res.json({ emails: devOutbox });
  });
}

export default router;
