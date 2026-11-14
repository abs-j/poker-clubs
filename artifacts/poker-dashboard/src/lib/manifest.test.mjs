import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const publicDir = new URL("../../public/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.webmanifest", publicDir), "utf8"));
const onDisk = (src) => existsSync(new URL(src.replace(/^\//, ""), publicDir));

test("every icon and screenshot in the manifest exists", () => {
  for (const entry of [...manifest.icons, ...manifest.screenshots]) assert.ok(onDisk(entry.src), `${entry.src} is missing`);
});

test("the maskable icon is its own padded file, not the plain icon", () => {
  const maskable = manifest.icons.filter((icon) => icon.purpose === "maskable");
  assert.equal(maskable.length, 1);
  assert.ok(!manifest.icons.some((icon) => icon.purpose === "any" && icon.src === maskable[0].src));
});

test("screenshots cover both form factors so Chrome shows the rich install dialog", () => {
  const factors = new Set(manifest.screenshots.map((shot) => shot.form_factor));
  assert.deepEqual([...factors].sort(), ["narrow", "wide"]);
});

test("the page stays pinch-zoomable", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(!/maximum-scale|user-scalable/.test(html));
});
