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
  index("calibration_samples_patch_role_submitted_idx").on(table.patch, table.role, table.submittedAt),
  index("calibration_samples_match_idx").on(table.region, table.matchHash),
]);

export const calibrationSampleAnomalies = sqliteTable("calibration_sample_anomalies", {
  region: text("region").notNull(),
  sampleHash: text("sample_hash").notNull(),
  matchHash: text("match_hash").notNull(),
  patch: text("patch").notNull(),
  role: text("role").notNull(),
  anomalyScore: integer("anomaly_score").notNull(),
  reasonCodes: text("reason_codes").notNull(),
  policyVersion: text("policy_version").notNull(),
  submittedAt: text("submitted_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.region, table.sampleHash] }),
  index("calibration_anomalies_submitted_idx").on(table.submittedAt),
]);

export const calibrationModelVersions = sqliteTable("calibration_model_versions", {
  version: text("version").primaryKey(),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  modelJson: text("model_json").notNull(),
  qualityScore: integer("quality_score").notNull(),
  maxExpectedDrift: real("max_expected_drift").notNull(),
  sampleCount: integer("sample_count").notNull(),
  rolloutPercentage: integer("rollout_percentage").notNull().default(0),
  parentVersion: text("parent_version"),
  rollbackVersion: text("rollback_version"),
  policyVersion: text("policy_version").notNull(),
  notes: text("notes").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  activatedAt: text("activated_at"),
  retiredAt: text("retired_at"),
}, (table) => [
  index("calibration_versions_status_created_idx").on(table.status, table.createdAt),
  index("calibration_versions_scope_created_idx").on(table.scope, table.createdAt),
]);

export const serviceRateLimits = sqliteTable("service_rate_limits", {
  bucket: text("bucket").primaryKey(),
  requestCount: integer("request_count").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
});

export const serviceHealthEvents = sqliteTable("service_health_events", {
  id: text("id").primaryKey(),
  route: text("route").notNull(),
  statusCode: integer("status_code").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("service_health_events_created_idx").on(table.createdAt),
]);

export const serviceAlerts = sqliteTable("service_alerts", {
  alertKey: text("alert_key").primaryKey(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const calibrationGovernance = sqliteTable("calibration_governance", {
  scope: text("scope").primaryKey(),
  activeVersion: text("active_version").notNull(),
  candidateVersion: text("candidate_version"),
  previousStableVersion: text("previous_stable_version"),
  rollbackVersion: text("rollback_version"),
  rolloutPercentage: integer("rollout_percentage").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
