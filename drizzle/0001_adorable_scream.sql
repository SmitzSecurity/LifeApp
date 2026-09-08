CREATE TABLE `life_resources` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`period` text NOT NULL,
	`payload` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	`active_slot` text,
	PRIMARY KEY(`user_id`, `kind`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_life_resources_period` ON `life_resources` (`user_id`,`kind`,`period`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_life_one_active_workout` ON `life_resources` (`user_id`,`kind`,`active_slot`) WHERE "life_resources"."active_slot" IS NOT NULL;