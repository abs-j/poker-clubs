import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { clubs } from "./clubs";

/** What an admin did, so destructive or sensitive actions are never anonymous. */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: serial("id").primaryKey(),
    action: varchar("action", { length: 40 }).notNull(),
    detail: text("detail").notNull().default(""),
    ip: text("ip"),
    /** The club the admin was acting in; null for actions before a club exists (failed sign-ins). */
    clubId: integer("club_id").references(() => clubs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("admin_audit_log_created_at_idx").on(table.createdAt)],
);

/** Failed sign-in counters that survive a server restart. */
export const loginThrottle = pgTable(
  "login_throttle",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 200 }).notNull(),
    failures: integer("failures").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).defaultNow().notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  },
  (table) => [uniqueIndex("login_throttle_key_idx").on(table.key)],
);
