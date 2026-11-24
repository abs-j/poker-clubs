import { Router, type IRouter } from "express";
import { assetLinks } from "../lib/assetlinks";

const router: IRouter = Router();

// Lets the Android app (Trusted Web Activity) verify it may open this site without a browser bar.
router.get("/.well-known/assetlinks.json", (_req, res) => {
  const links = assetLinks(process.env);
  if (!links) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.set("Cache-Control", "public, max-age=3600");
  res.json(links);
});

export default router;
