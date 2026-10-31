import {
  boolean,
  index,
  jsonb,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

/** A poker club. Every piece of club data (sessions, ledger, avatars, usage) points at one. */
export const clubs = pgTable(
  "clubs",
  {
    id: serial("id").primaryKey(),
    /** URL-safe and unique: /c/<slug>. */
    slug: varchar("slug", { length: 64 }).notNull(),
    name: text("name").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("AUD"),
    timezone: varchar("timezone", { length: 64 }).notNull().default("Australia/Melbourne"),
    /** Short tag used on share cards and recap captions, without the "#". */
    hashtag: varchar("hashtag", { length: 40 }),
    /** The club's own rules and house guidelines, as plain text. */
    guidelines: text("guidelines"),
    /** "standard", "social", "competitive" or "custom". */
    pointsPreset: varchar("points_preset", { length: 16 }).notNull().default("standard"),
    /** The full rule set when pointsPreset is "custom". */
    pointsRules: jsonb("points_rules"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("clubs_slug_idx").on(table.slug)],
);

/**
 * A person as the club knows them. `userId` stays null until the person signs up and claims
 * the name, so history recorded before signup keeps working. `nameKey` is the lower-cased,
 * whitespace-collapsed name the leaderboard already matches on.
 */
export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    nameKey: varchar("name_key", { length: 120 }).notNull(),
    /** The account that claimed this name; null while the name is only history. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("players_club_name_key_idx").on(table.clubId, table.nameKey),
    index("players_user_id_idx").on(table.userId),
  ],
);

/** Who belongs to which club, and as what. One membership per person per club. */
export const memberships = pgTable(
  "memberships",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The name this person plays under in this club. */
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    /** "owner", "admin" or "member". */
    role: varchar("role", { length: 16 }).notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("memberships_club_user_idx").on(table.clubId, table.userId),
    uniqueIndex("memberships_player_idx").on(table.playerId),
    index("memberships_user_id_idx").on(table.userId),
  ],
);

/** An invite link. The code is the capability: anyone holding it can join until it stops working. */
export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 32 }).notNull(),
    /** The role the joiner gets: "member" or "admin". */
    role: varchar("role", { length: 16 }).notNull().default("member"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when the invite was emailed, so a club can only send so many a day. */
    emailedTo: text("emailed_to"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invites_code_idx").on(table.code),
    index("invites_club_id_idx").on(table.clubId),
  ],
);

/**
 * One night of poker. Closed live sessions, imported history and hand-entered nights all
 * land here, so the leaderboards, points and profiles read one place for every club.
 */
export const clubSessions = pgTable(
  "club_sessions",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    /** The calendar date of the night, "YYYY-MM-DD". */
    sessionDate: varchar("session_date", { length: 10 }).notNull(),
    /** "cash" for now; tournaments get their own entry in a later phase. */
    kind: varchar("kind", { length: 12 }).notNull().default("cash"),
    /** "live" (closed ledger session), "import" or "manual". */
    source: varchar("source", { length: 12 }).notNull(),
    /** The live ledger session this came from, so closing twice never records it twice. */
    liveSessionKey: varchar("live_session_key", { length: 64 }),
    /** Groups the nights of one import so the whole import can be undone. */
    importBatch: varchar("import_batch", { length: 36 }),
    /** Surplus from this night that went into the bad beat jackpot, in cents. */
    jackpotCents: integer("jackpot_cents").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("club_sessions_club_date_idx").on(table.clubId, table.sessionDate),
    uniqueIndex("club_sessions_live_key_idx").on(table.liveSessionKey),
    index("club_sessions_import_batch_idx").on(table.importBatch),
  ],
);

/** What one player put in and took out on one night. Net profit is cash-out minus buy-in. */
export const sessionResults = pgTable(
  "session_results",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => clubSessions.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    buyInCents: integer("buy_in_cents").notNull().default(0),
    cashOutCents: integer("cash_out_cents").notNull().default(0),
  },
  (table) => [
    uniqueIndex("session_results_session_player_idx").on(table.sessionId, table.playerId),
    index("session_results_player_id_idx").on(table.playerId),
  ],
);

/** A player who has settled up their result for a night. No row means the player still owes or is still owed. */
export const nightSettlements = pgTable(
  "night_settlements",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    clubSessionId: integer("club_session_id")
      .notNull()
      .references(() => clubSessions.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    settledAt: timestamp("settled_at", { withTimezone: true }).defaultNow().notNull(),
    settledBy: text("settled_by").notNull(),
  },
  (table) => [
    uniqueIndex("night_settlements_session_player_idx").on(table.clubSessionId, table.playerId),
    index("night_settlements_club_id_idx").on(table.clubId),
  ],
);

/**
 * A tournament a club ran. Only what was entered is stored (places, entries, knockouts and any
 * payouts); prize pools, returns and profit are worked out when the dashboard is built.
 */
export const clubTournaments = pgTable(
  "club_tournaments",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    eventDate: varchar("event_date", { length: 10 }).notNull(),
    title: text("title").notNull(),
    venue: text("venue"),
    notes: text("notes"),
    buyInCents: integer("buy_in_cents").notNull().default(0),
    /** The price of a top-up (add-on). */
    topUpCents: integer("top_up_cents").notNull().default(0),
    /** Paid to a player for each knockout. Each paid entry puts this much into the bounty pool. */
    bountyCents: integer("bounty_cents").notNull().default(0),
    startingStack: integer("starting_stack").notNull().default(0),
    /** The winner also collects their own bounty, so every entry's bounty is claimed by someone. */
    winnerKeepsBounty: boolean("winner_keeps_bounty").notNull().default(false),
    /** Prize shares for 1st, 2nd and 3rd as whole or half percentages (50 means 50%). */
    shareFirst: integer("share_first").notNull().default(50),
    shareSecond: integer("share_second").notNull().default(30),
    shareThird: integer("share_third").notNull().default(20),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("club_tournaments_club_date_idx").on(table.clubId, table.eventDate)],
);

export const tournamentResults = pgTable(
  "tournament_results",
  {
    id: serial("id").primaryKey(),
    tournamentId: integer("tournament_id")
      .notNull()
      .references(() => clubTournaments.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    finishPlace: integer("finish_place"),
    /** Total entries including rebuys; at least 1. */
    entries: integer("entries").notNull().default(1),
    topUp: boolean("top_up").notNull().default(false),
    freeEntry: boolean("free_entry").notNull().default(false),
    knockouts: integer("knockouts").notNull().default(0),
    /** Prize paid for finishing position. Null means "work it out from the shares". */
    payoutCents: integer("payout_cents"),
  },
  (table) => [
    uniqueIndex("tournament_results_tournament_player_idx").on(table.tournamentId, table.playerId),
    index("tournament_results_player_id_idx").on(table.playerId),
  ],
);

export type Club = typeof clubs.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type ClubSession = typeof clubSessions.$inferSelect;
export type SessionResult = typeof sessionResults.$inferSelect;
export type ClubTournament = typeof clubTournaments.$inferSelect;
