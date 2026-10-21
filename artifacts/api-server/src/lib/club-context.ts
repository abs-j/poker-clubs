import { ensureDefaultClub } from "@workspace/db";

/**
 * The original club (Monash) is a legacy mode, off unless asked for: it brings access-code
 * sign-in, the Google Sheet reader and mirror, and a public snapshot page, all tied to one club.
 * A normal deployment has none of that and never creates the club.
 */
export const legacyEnabled = () => Boolean(process.env.MEMBER_ACCESS_CODES) || process.env.LEGACY_DEFAULT_CLUB === "true";

let defaultClubId: Promise<number> | null = null;

/** The original club's id in legacy mode; null otherwise, so no club is ever treated as "the original". */
export function getDefaultClubId(): Promise<number | null> {
  if (!legacyEnabled()) return Promise.resolve(null);
  if (!defaultClubId) {
    defaultClubId = ensureDefaultClub().then(
      (club) => club.id,
      (error) => {
        defaultClubId = null;
        throw error;
      },
    );
  }
  return defaultClubId;
}
