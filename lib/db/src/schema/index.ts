import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { clubs } from "./clubs";

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id").references(() => clubs.id),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    role: varchar("role", { length: 16 }).notNull(),
    memberName: text("member_name"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("auth_sessions_expires_at_idx").on(table.expiresAt),
    index("auth_sessions_role_idx").on(table.role),
  ],
);

export const siteVisits = pgTable(
  "site_visits",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id").references(() => clubs.id),
    memberName: text("member_name").notNull(),
    visitedAt: timestamp("visited_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("site_visits_member_name_idx").on(table.memberName),
    index("site_visits_visited_at_idx").on(table.visitedAt),
  ],
);

export const liveSessions = pgTable(
  "live_sessions",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id").references(() => clubs.id),
    sessionKey: varchar("session_key", { length: 64 }).notNull().unique(),
    sessionDate: text("session_date").notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    startedBy: text("started_by").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedBy: text("ended_by"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    sourceTab: text("source_tab"),
    sourceRowStart: integer("source_row_start"),
    sourceRowEnd: integer("source_row_end"),
    totalBuyInCents: integer("total_buy_in_cents"),
    totalCashOutCents: integer("total_cash_out_cents"),
    balanceDifferenceCents: integer("balance_difference_cents"),
    balanceStatus: varchar("balance_status", { length: 16 }),
    /** What an admin chose to do about a gap before closing (see night-balance.ts). Null until chosen. */
    balanceResolution: jsonb("balance_resolution"),
  },
  (table) => [
    index("live_sessions_status_idx").on(table.status),
    index("live_sessions_club_id_idx").on(table.clubId),
    index("live_sessions_session_date_idx").on(table.sessionDate),
  ],
);

export const liveActivityEvents = pgTable(
  "live_activity_events",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id").references(() => clubs.id),
    eventId: varchar("event_id", { length: 64 }).notNull().unique(),
    sessionKey: varchar("session_key", { length: 64 }).notNull(),
    sessionDate: text("session_date").notNull(),
    memberName: text("member_name").notNull(),
    action: varchar("action", { length: 16 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    comment: text("comment"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    revision: integer("revision").default(1).notNull(),
    sheetHash: varchar("sheet_hash", { length: 128 }),
  },
  (table) => [
    index("live_activity_events_session_key_idx").on(table.sessionKey),
    index("live_activity_events_club_id_idx").on(table.clubId),
    index("live_activity_events_session_date_idx").on(table.sessionDate),
    index("live_activity_events_member_name_idx").on(table.memberName),
    index("live_activity_events_updated_at_idx").on(table.updatedAt),
  ],
);

export const liveActivityEventComments = pgTable(
  "live_activity_event_comments",
  {
    id: serial("id").primaryKey(),
    eventId: varchar("event_id", { length: 64 })
      .notNull()
      .references(() => liveActivityEvents.eventId, { onDelete: "cascade" }),
    action: varchar("action", { length: 16 }).notNull(),
    comment: text("comment").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("live_activity_event_comments_event_id_idx").on(table.eventId),
    index("live_activity_event_comments_created_at_idx").on(table.createdAt),
  ],
);

export * from "./identity";
export * from "./clubs";
export * from "./member-usage";
export * from "./member-usage-activity";
export * from "./member-avatars";
export * from "./admin-security";
