CREATE INDEX `calibration_samples_patch_role_submitted_idx` ON `calibration_samples` (`patch`,`role`,`submitted_at`);
--> statement-breakpoint
CREATE TABLE `calibration_sample_anomalies` (
	`region` text NOT NULL,
	`sample_hash` text NOT NULL,
	`match_hash` text NOT NULL,
	`patch` text NOT NULL,
	`role` text NOT NULL,
	`anomaly_score` integer NOT NULL,
	`reason_codes` text NOT NULL,
	`policy_version` text NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`region`,`sample_hash`)
);
--> statement-breakpoint
CREATE INDEX `calibration_anomalies_submitted_idx` ON `calibration_sample_anomalies` (`submitted_at`);
--> statement-breakpoint
CREATE TABLE `calibration_model_versions` (
	`version` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`model_json` text NOT NULL,
	`quality_score` integer NOT NULL,
	`max_expected_drift` real NOT NULL,
	`sample_count` integer NOT NULL,
	`rollout_percentage` integer DEFAULT 0 NOT NULL,
	`parent_version` text,
	`rollback_version` text,
	`policy_version` text NOT NULL,
	`notes` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`activated_at` text,
	`retired_at` text
);
--> statement-breakpoint
CREATE INDEX `calibration_versions_status_created_idx` ON `calibration_model_versions` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `calibration_versions_scope_created_idx` ON `calibration_model_versions` (`scope`,`created_at`);
--> statement-breakpoint
CREATE TABLE `calibration_governance` (
	`scope` text PRIMARY KEY NOT NULL,
	`active_version` text NOT NULL,
	`candidate_version` text,
	`previous_stable_version` text,
	`rollback_version` text,
	`rollout_percentage` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_rate_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_health_events` (
	`id` text PRIMARY KEY NOT NULL,
	`route` text NOT NULL,
	`status_code` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`error_code` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `service_health_events_created_idx` ON `service_health_events` (`created_at`);
--> statement-breakpoint
CREATE TABLE `service_alerts` (
	`alert_key` text PRIMARY KEY NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text NOT NULL
);
