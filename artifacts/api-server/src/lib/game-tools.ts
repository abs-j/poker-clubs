// What the Games tab needs to edit, reopen or delete a night. Separate from the dashboard
// payload, which is a fixed shape. Session numbers match the cards: date order, then id.
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { clubSessions, db, liveSessions } from "@workspace/db";
import { listClubNights, syncClosedLiveSessions } from "./club-sessions";
import { canManageNight, hostOf, type LedgerActor } from "./ledger-permissions";
import { recordedSessionNumbers } from "./night-settlement";

export type GameNightRef = {
  id: number;
  sessionNumber: number;
  date: string;
  source: "live" | "import" | "manual";
};

export type GameTools = {
  /** Club owner or admin. Members do not receive night ids. */
  admin: boolean;
  /** The viewer may reopen the latest closed live night. */
  canReopen: boolean;
  /** Games card for that night, or null when there is nothing to reopen. */
  reopenSessionNumber: number | null;
  nights: GameNightRef[];
};

const sourceOf = (source: string): GameNightRef["source"] =>
  source === "live" || source === "import" || source === "manual" ? source : "manual";

/** Admin edit/delete targets, plus whether this person can reopen the latest closed night. */
export async function loadGameTools(clubId: number, actor: LedgerActor): Promise<GameTools> {
  await syncClosedLiveSessions(clubId);
  const numbers = await recordedSessionNumbers(clubId);
  const [latest] = await db
    .select({
      key: liveSessions.sessionKey,
      hostName: liveSessions.hostName,
      startedBy: liveSessions.startedBy,
    })
    .from(liveSessions)
    .where(and(eq(liveSessions.clubId, clubId), eq(liveSessions.status, "ended"), isNotNull(liveSessions.endedAt)))
    .orderBy(desc(liveSessions.endedAt), desc(liveSessions.startedAt))
    .limit(1);

  let canReopen = false;
  let reopenSessionNumber: number | null = null;
  if (latest) {
    canReopen = canManageNight(actor, hostOf(latest));
    const [night] = await db
      .select({ id: clubSessions.id })
      .from(clubSessions)
      .where(and(eq(clubSessions.clubId, clubId), eq(clubSessions.liveSessionKey, latest.key)))
      .limit(1);
    reopenSessionNumber = night ? numbers.get(night.id) ?? null : null;
  }

  const nights = actor.isAdmin
    ? (await listClubNights(clubId)).flatMap((night) => {
        const sessionNumber = numbers.get(night.id);
        if (sessionNumber === undefined) return [];
        return [{ id: night.id, sessionNumber, date: night.date, source: sourceOf(night.source) }];
      })
    : [];

  return { admin: actor.isAdmin, canReopen, reopenSessionNumber, nights };
}
