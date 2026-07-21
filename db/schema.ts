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

export const calibrationSamples = sqliteTable("calibration_samples", {
  region: text("region").notNull(),
  sampleHash: text("sample_hash").notNull(),
  matchHash: text("match_hash").notNull(),
  playedAt: text("played_at").notNull(),
  patch: text("patch").notNull(),
  role: text("role").notNull(),
  secondaryRole: text("secondary_role"),
  d1: real("d1").notNull(),
  d2: real("d2").notNull(),
  d3: real("d3").notNull(),
  d4: real("d4").notNull(),
  secondaryScore: real("secondary_score"),
  operationScore: real("operation_score").notNull(),
  deathsPerTen: real("deaths_per_ten").notNull(),
  recallApplied: integer("recall_applied", { mode: "boolean" }).notNull().default(false),
  won: integer("won", { mode: "boolean" }).notNull(),
  submittedAt: text("submitted_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.region, table.sampleHash] }),
  index("calibration_samples_role_submitted_idx").on(table.role, table.submittedAt),
  index("calibration_samples_match_idx").on(table.region, table.matchHash),
]);
