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

export const memberUsage = pgTable(
  "member_usage",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id").references(() => clubs.id),
    memberName: text("member_name").notNull(),
    section: varchar("section", { length: 32 }).notNull(),
    pageViews: integer("page_views").notNull().default(0),
    activeSeconds: integer("active_seconds").notNull().default(0),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("member_usage_club_name_section_idx").on(
      table.clubId,
      table.memberName,
      table.section,
    ),
    index("member_usage_member_name_idx").on(table.memberName),
    index("member_usage_last_active_idx").on(table.lastActiveAt),
  ],
);
