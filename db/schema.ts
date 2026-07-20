import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const ratingPlayers = sqliteTable("rating_players", {
  region: text("region").notNull(),
  playerHash: text("player_hash").notNull(),
  rating: real("rating").notNull().default(1500),
  deviation: real("deviation").notNull().default(350),
  games: integer("games").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  lastPlayedAt: text("last_played_at"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.region, table.playerHash] }),
  index("rating_players_region_rating_idx").on(table.region, table.rating),
]);

export const ratingMatches = sqliteTable("rating_matches", {
  region: text("region").notNull(),
  matchHash: text("match_hash").notNull(),
  playedAt: text("played_at").notNull(),
  patch: text("patch").notNull(),
  processed: integer("processed", { mode: "boolean" }).notNull().default(false),
  submittedAt: text("submitted_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.region, table.matchHash] }),
  index("rating_matches_processed_submitted_idx").on(table.processed, table.submittedAt),
]);
