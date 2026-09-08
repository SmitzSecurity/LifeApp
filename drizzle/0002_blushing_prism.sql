CREATE TABLE `life_ai_reviews` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`revision` integer NOT NULL,
	`source_version` integer NOT NULL,
	`predecessor_id` text,
	`critique` text NOT NULL,
	`status` text NOT NULL,
	`input_snapshot` text NOT NULL,
	`report_text` text,
	`model` text NOT NULL,
	`price_version` text NOT NULL,
	`provider_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`thought_tokens` integer,
	`reserved_micros` integer NOT NULL,
	`cost_micros` integer,
	`created_at` text NOT NULL,
	`finished_at` text,
	`error_code` text,
	PRIMARY KEY(`user_id`, `request_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_life_ai_revision` ON `life_ai_reviews` (`user_id`,`entry_date`,`revision`);--> statement-breakpoint
CREATE INDEX `idx_life_ai_account_time` ON `life_ai_reviews` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_life_ai_time` ON `life_ai_reviews` (`created_at`);