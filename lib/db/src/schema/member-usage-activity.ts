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

export const memberUsageActivity = pgTable(
  "member_usage_activity",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id").references(() => clubs.id),
    memberName: text("member_name").notNull(),
    section: varchar("section", { length: 32 }).notNull(),
    bucketAt: timestamp("bucket_at", { withTimezone: true }).notNull(),
    pageViews: integer("page_views").notNull().default(0),
    activeSeconds: integer("active_seconds").notNull().default(0),
  },
  (table) => [
    uniqueIndex("member_usage_activity_club_bucket_idx").on(
      table.clubId,
      table.memberName,
      table.section,
      table.bucketAt,
    ),
    index("member_usage_activity_at_idx").on(table.bucketAt),
  ],
);
