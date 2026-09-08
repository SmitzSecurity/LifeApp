CREATE TABLE `life_entries` (
	`user_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`payload` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `entry_date`)
);
--> statement-breakpoint
CREATE TABLE `life_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL
);
