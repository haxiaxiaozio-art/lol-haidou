CREATE TABLE `calibration_samples` (
	`region` text NOT NULL,
	`sample_hash` text NOT NULL,
	`match_hash` text NOT NULL,
	`played_at` text NOT NULL,
	`patch` text NOT NULL,
	`role` text NOT NULL,
	`secondary_role` text,
	`d1` real NOT NULL,
	`d2` real NOT NULL,
	`d3` real NOT NULL,
	`d4` real NOT NULL,
	`secondary_score` real,
	`operation_score` real NOT NULL,
	`deaths_per_ten` real NOT NULL,
	`recall_applied` integer DEFAULT false NOT NULL,
	`won` integer NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`region`,`sample_hash`)
);
--> statement-breakpoint
CREATE INDEX `calibration_samples_role_submitted_idx` ON `calibration_samples` (`role`,`submitted_at`);
--> statement-breakpoint
CREATE INDEX `calibration_samples_match_idx` ON `calibration_samples` (`region`,`match_hash`);
--> statement-breakpoint
CREATE TRIGGER `calibration_samples_match_limit`
BEFORE INSERT ON `calibration_samples`
WHEN (SELECT COUNT(*) FROM `calibration_samples` WHERE `region` = NEW.`region` AND `match_hash` = NEW.`match_hash`) >= 10
BEGIN
	SELECT RAISE(IGNORE);
END;
