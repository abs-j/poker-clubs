import type { NextFunction, Request, Response } from "express";
import { identityUser } from "./club-access";

// The site owner. A comma-separated list of account emails. Unset, blank, or only
// commas and spaces means nobody: fail closed, including in production.
export function platformAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = platformAdminEmails();
  if (allowed.size === 0) return false;
  return allowed.has(email.trim().toLowerCase());
}

/** Signed-out callers get 401. Signed-in accounts that are not on the list get 403. */
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await identityUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  if (!isPlatformAdminEmail(user.email)) {
    res.status(403).json({ error: "Not available." });
    return;
  }
  next();
}
