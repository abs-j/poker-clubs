import { eq } from "drizzle-orm";
import { clubs, db } from "@workspace/db";
import { cleanModelId } from "./ai-notes";
import { openSecret, sealSecret } from "./secret-box";

/** A fast, cheap vision-capable default an admin can change. */
export const DEFAULT_AI_MODEL = "google/gemini-2.5-flash-lite";

export type ClubAiStatus = { enabled: boolean; model: string; keySet: boolean };

async function row(clubId: number) {
  const [found] = await db.select({ model: clubs.aiModel, cipher: clubs.aiKeyCipher }).from(clubs).where(eq(clubs.id, clubId)).limit(1);
  return found;
}

/** What the settings page may show. The key itself never leaves the server. */
export async function getClubAiStatus(clubId: number): Promise<ClubAiStatus> {
  const found = await row(clubId);
  const keySet = Boolean(found?.cipher && openSecret(found.cipher));
  return { enabled: keySet, model: found?.model || DEFAULT_AI_MODEL, keySet };
}

/** The key and model to read notes with, or null when this club hasn't set one up. */
export async function getClubAiConfig(clubId: number): Promise<{ apiKey: string; model: string } | null> {
  const found = await row(clubId);
  const apiKey = found?.cipher ? openSecret(found.cipher) : null;
  return apiKey ? { apiKey, model: found?.model || DEFAULT_AI_MODEL } : null;
}

export async function updateClubAi(clubId: number, input: { model?: unknown; apiKey?: unknown; clearKey?: unknown }): Promise<ClubAiStatus | { error: string }> {
  const patch: { aiModel?: string | null; aiKeyCipher?: string | null } = {};
  if (input.model !== undefined) {
    const model = cleanModelId(input.model);
    if (!model) return { error: "Enter a model id like vendor/model-name." };
    patch.aiModel = model;
  }
  if (input.clearKey === true) patch.aiKeyCipher = null;
  else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    const key = input.apiKey.trim();
    if (key.length > 300 || /\s/.test(key)) return { error: "That doesn't look like an API key." };
    try {
      patch.aiKeyCipher = sealSecret(key);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Couldn't store the key." };
    }
  }
  if (Object.keys(patch).length > 0) await db.update(clubs).set(patch).where(eq(clubs.id, clubId));
  return getClubAiStatus(clubId);
}
