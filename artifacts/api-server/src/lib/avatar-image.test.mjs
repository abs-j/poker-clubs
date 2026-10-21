import assert from "node:assert/strict";
import test from "node:test";

import { AVATAR_PRESETS, MAX_AVATAR_BYTES, normalizeMemberKey, parseAvatarInput, sniffImage } from "./avatar-image.ts";

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webpBytes = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const dataUrl = (type, bytes) => `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;

test("member keys ignore case and spacing", () => {
  assert.equal(normalizeMemberKey("  Ben   Ch "), "ben ch");
});

test("presets are accepted by name only", () => {
  assert.deepEqual(parseAvatarInput({ kind: "preset", preset: "shark" }), { ok: true, kind: "preset", preset: "shark" });
  assert.equal(parseAvatarInput({ kind: "preset", preset: "../../etc" }).ok, false);
  assert.ok(AVATAR_PRESETS.includes("fish") && AVATAR_PRESETS.includes("whale"));
});

test("uploads must be real jpeg, png or webp data", () => {
  assert.equal(parseAvatarInput({ kind: "upload", imageDataUrl: dataUrl("jpeg", jpegBytes) }).contentType, "image/jpeg");
  assert.equal(parseAvatarInput({ kind: "upload", imageDataUrl: dataUrl("png", pngBytes) }).contentType, "image/png");
  assert.equal(parseAvatarInput({ kind: "upload", imageDataUrl: dataUrl("webp", webpBytes) }).contentType, "image/webp");
  // Claims to be a jpeg but the bytes are text.
  const fake = parseAvatarInput({ kind: "upload", imageDataUrl: dataUrl("jpeg", Buffer.from("<script>alert(1)</script>")) });
  assert.equal(fake.ok, false);
  assert.equal(parseAvatarInput({ kind: "upload", imageDataUrl: "data:text/html;base64,AAAA" }).ok, false);
  assert.equal(parseAvatarInput({ kind: "upload", imageDataUrl: "https://example.com/a.png" }).ok, false);
});

test("the stored type comes from the bytes, not the claim", () => {
  const result = parseAvatarInput({ kind: "upload", imageDataUrl: dataUrl("jpeg", pngBytes) });
  assert.equal(result.ok, true);
  assert.equal(result.contentType, "image/png");
  assert.equal(sniffImage(Buffer.from("hello")), null);
});

test("oversized uploads are rejected", () => {
  const big = Buffer.concat([jpegBytes, Buffer.alloc(MAX_AVATAR_BYTES)]);
  const result = parseAvatarInput({ kind: "upload", imageDataUrl: dataUrl("jpeg", big) });
  assert.equal(result.ok, false);
  assert.match(result.error, /too large/);
});

test("anything else is an error", () => {
  assert.equal(parseAvatarInput(null).ok, false);
  assert.equal(parseAvatarInput({ kind: "nope" }).ok, false);
});
