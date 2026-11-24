// Renders the Google Play listing assets into android/store/.
//   phone-1..5.png  1080x1920 screenshots of the public DEMO build (fake data only)
//   feature-graphic.png  1024x500 from android/store/feature-graphic.html
// Needs puppeteer-core (not a repo dependency) and the demo running:
//   pnpm --filter @workspace/poker-dashboard run dev:demo     (http://localhost:5174/demo/)
//   NODE_PATH=<dir>/node_modules node scripts/android/render-store-assets.mjs
// Env: DEMO_URL (default http://localhost:5174/demo/), CHROME_PATH, ONLY=phone|feature
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../android/store");
const DEMO_URL = process.env.DEMO_URL || "http://localhost:5174/demo/";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ONLY = process.env.ONLY || "";
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
try {
  if (ONLY !== "feature") {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 540, height: 960, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    // Skip the guided tour and any cookie notice before the app boots.
    await page.evaluateOnNewDocument(() => {
      try { sessionStorage.setItem("riverside-demo-tour-seen", "1"); } catch {}
    });
    await page.goto(DEMO_URL, { waitUntil: "networkidle0" });
    // Hide the demo's floating "Take the tour" button; it is not part of the real app.
    await page.addStyleTag({ content: '[data-testid="button-demo-tour"]{display:none!important}' });
    await sleep(1500);

    const clickTid = async (tid) => {
      const ok = await page.evaluate((id) => {
        for (const n of document.querySelectorAll(`[data-testid="${id}"]`)) {
          const b = n.getBoundingClientRect();
          if (b.width > 0 && b.height > 0) { n.click(); return true; }
        }
        return false;
      }, tid);
      if (!ok) throw new Error(`no visible [data-testid=${tid}]`);
      await sleep(3500); // let podium and card animations finish
    };
    const shot = async (n) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(400);
      await page.screenshot({ path: path.join(out, `phone-${n}.png`) });
      console.log(`phone-${n}.png`);
    };

    await shot(1);                         // Home
    await clickTid("tab-months");  await shot(2);   // Leaderboard
    await clickTid("tab-sessions"); await shot(3);  // Games
    await clickTid("tab-live");    await shot(4);   // Record
    await clickTid("tab-account"); await shot(5); // Me
  }

  if (ONLY !== "phone") {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 500, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(out, "feature-graphic.html")).href, { waitUntil: "networkidle0" });
    await sleep(300);
    // omitBackground false keeps it opaque; the page paints its own background.
    await page.screenshot({ path: path.join(out, "feature-graphic.png"), omitBackground: false });
    console.log("feature-graphic.png");
  }
} finally {
  await browser.close();
}
