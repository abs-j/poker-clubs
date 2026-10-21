// Validation for profile pictures. Kept free of Express and the database so it can be unit tested.

export const AVATAR_PRESETS = ["fish", "shark", "whale", "octopus", "dolphin", "crab", "turtle", "jellyfish"] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

/** Uploaded pictures are shrunk in the browser; this is a hard ceiling on what we store. */
export const MAX_AVATAR_BYTES = 60 * 1024;

export const normalizeMemberKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export function isAvatarPreset(value: unknown): value is AvatarPreset {
  return typeof value === "string" && (AVATAR_PRESETS as readonly string[]).includes(value);
}

export type SniffedImage = { contentType: "image/jpeg" | "image/png" | "image/webp" };

/** Identifies the image type from its first bytes, ignoring whatever the client claimed. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: "image/jpeg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { contentType: "image/png" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { contentType: "image/webp" };
  }
  return null;
}

export type AvatarInput =
  | { ok: true; kind: "preset"; preset: AvatarPreset }
  | { ok: true; kind: "upload"; imageBase64: string; contentType: SniffedImage["contentType"] }
  | { ok: false; error: string };

/** Turns a request body into something safe to store, or an error message for the member. */
export function parseAvatarInput(body: unknown): AvatarInput {
  if (!body || typeof body !== "object") return { ok: false, error: "Choose a picture to save." };
  const { kind, preset, imageDataUrl } = body as Record<string, unknown>;

  if (kind === "preset") {
    if (!isAvatarPreset(preset)) return { ok: false, error: "That picture is not one of the presets." };
    return { ok: true, kind: "preset", preset };
  }

  if (kind === "upload") {
    if (typeof imageDataUrl !== "string") return { ok: false, error: "No image was sent." };
    const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
    if (!match) return { ok: false, error: "Use a JPEG, PNG or WebP image." };
    const base64 = match[1];
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length === 0) return { ok: false, error: "That image is empty." };
    if (bytes.length > MAX_AVATAR_BYTES) {
      return { ok: false, error: "That image is too large. Try a smaller one." };
    }
    const sniffed = sniffImage(bytes);
    if (!sniffed) return { ok: false, error: "That file does not look like a JPEG, PNG or WebP image." };
    return { ok: true, kind: "upload", imageBase64: base64, contentType: sniffed.contentType };
  }

  return { ok: false, error: "Choose a preset or upload a picture." };
}
