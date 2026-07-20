CREATE TABLE `rating_matches` (
	`region` text NOT NULL,
	`match_hash` text NOT NULL,
	`played_at` text NOT NULL,
	`patch` text NOT NULL,
	`processed` integer DEFAULT false NOT NULL,
	`submitted_at` text NOT NULL,
	PRIMARY KEY(`region`, `match_hash`)
);
--> statement-breakpoint
CREATE INDEX `rating_matches_processed_submitted_idx` ON `rating_matches` (`processed`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `rating_players` (
	`region` text NOT NULL,
	`player_hash` text NOT NULL,
	`rating` real DEFAULT 1500 NOT NULL,
	`deviation` real DEFAULT 350 NOT NULL,
	`games` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`last_played_at` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`region`, `player_hash`)
);
--> statement-breakpoint
CREATE INDEX `rating_players_region_rating_idx` ON `rating_players` (`region`,`rating`);