// Encrypts small secrets (a club's AI key) before they are stored. AES-256-GCM, with a key derived from
// SETTINGS_ENCRYPTION_KEY, or SESSION_SECRET when that is not set. Losing or changing the secret makes
// stored keys unreadable, and the club simply enters its key again.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function secretKey(): Buffer {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("Set SETTINGS_ENCRYPTION_KEY (or SESSION_SECRET) to store a club's AI key.");
  return createHash("sha256").update(`poker-clubs:secret-box:${secret}`).digest();
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

/** The original text, or null when it was sealed with another secret or has been damaged. */
export function openSecret(sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
