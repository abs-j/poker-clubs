// Renders the app icon SVG to the PNGs the Android wrapper and Play listing need:
//   public/icons/icon-maskable-192.png  (full-bleed square, the OS applies the mask)
//   android/store/icon-512.png          (512x512, rounded corners, transparent outside them)
//
// Run from a folder that has `puppeteer-core` installed (same as scripts/smoke/smoke.mjs):
//   CHROME_PATH=<chrome> node <repo>/scripts/android/render-icons.mjs
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(`${process.cwd()}/`);
const puppeteer = require("puppeteer-core");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SVG = readFileSync(resolve(ROOT, "artifacts/poker-dashboard/public/icons/icon.svg"), "utf8");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const targets = [
  { out: "artifacts/poker-dashboard/public/icons/icon-maskable-192.png", size: 192, radius: 0 },
  { out: "android/store/icon-512.png", size: 512, radius: 112 },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  for (const { out, size, radius } of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px;border-radius:${radius * size / 512}px;overflow:hidden}</style>${SVG}`,
    );
    const file = resolve(ROOT, out);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`wrote ${out} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
