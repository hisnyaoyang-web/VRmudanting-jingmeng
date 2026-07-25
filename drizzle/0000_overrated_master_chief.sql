CREATE TABLE `claims` (
	`wallet_address` text NOT NULL,
	`story_id` text NOT NULL,
	`season_id` text NOT NULL,
	`nonce` text NOT NULL,
	`voucher_digest` text NOT NULL,
	`score` integer NOT NULL,
	`grade` text NOT NULL,
	`tx_hash` text,
	`token_id` text,
	`status` text DEFAULT 'issued' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_wallet_story_season_unique` ON `claims` (`wallet_address`,`story_id`,`season_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `claims_nonce_unique` ON `claims` (`nonce`);--> statement-breakpoint
CREATE TABLE `progress` (
	`wallet_address` text NOT NULL,
	`story_id` text NOT NULL,
	`best_score` integer DEFAULT 0 NOT NULL,
	`best_grade` text DEFAULT 'bad' NOT NULL,
	`fragments` integer DEFAULT 0 NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`last_reward_date` text,
	`last_played_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_wallet_story_unique` ON `progress` (`wallet_address`,`story_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet_address` text,
	`story_id` text NOT NULL,
	`story_version` text NOT NULL,
	`season_id` text NOT NULL,
	`difficulty` text NOT NULL,
	`challenge_date` text NOT NULL,
	`nonce` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`input_digest` text,
	`score` integer,
	`grade` text,
	`verified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_wallet_idx` ON `runs` (`wallet_address`);--> statement-breakpoint
CREATE INDEX `runs_leaderboard_idx` ON `runs` (`story_id`,`season_id`,`score`);--> statement-breakpoint
CREATE TABLE `unlocks` (
	`wallet_address` text NOT NULL,
	`unlock_id` text NOT NULL,
	`source` text NOT NULL,
	`unlocked_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unlocks_wallet_id_unique` ON `unlocks` (`wallet_address`,`unlock_id`);