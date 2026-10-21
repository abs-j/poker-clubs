import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { clubs } from "./clubs";

/** One profile picture per member: a preset illustration or a small uploaded image. */
export const memberAvatars = pgTable(
  "member_avatars",
  {
    id: serial("id").primaryKey(),
    clubId: integer("club_id").references(() => clubs.id),
    /** Lower-cased, whitespace-collapsed member name, so it matches the leaderboard. */
    memberKey: varchar("member_key", { length: 120 }).notNull(),
    memberName: text("member_name").notNull(),
    /** "preset" or "upload". */
    kind: varchar("kind", { length: 12 }).notNull(),
    preset: varchar("preset", { length: 32 }),
    /** Base64 of the (already shrunk) image when kind is "upload". */
    imageBase64: text("image_base64"),
    contentType: varchar("content_type", { length: 32 }),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("member_avatars_club_member_key_idx").on(table.clubId, table.memberKey)],
);
