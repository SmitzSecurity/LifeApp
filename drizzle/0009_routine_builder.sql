CREATE TABLE `life_routine_builds` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`status` text NOT NULL,
	`input_snapshot` text NOT NULL,
	`result_json` text,
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
CREATE INDEX `idx_life_routine_build_time` ON `life_routine_builds` (`user_id`,`created_at`);
--> statement-breakpoint
-- Extend the shared cap/rate/circuit-breaker ledger without changing existing usage.
DROP VIEW life_ai_usage;
--> statement-breakpoint
CREATE VIEW life_ai_usage AS
 SELECT user_id,request_id,status,model,price_version,input_tokens,output_tokens,thought_tokens,reserved_micros,cost_micros,created_at,finished_at,error_code FROM life_ai_reviews
 UNION ALL
 SELECT user_id,request_id,status,model,price_version,input_tokens,output_tokens,thought_tokens,reserved_micros,cost_micros,created_at,finished_at,error_code FROM life_deleted_ai_usage
 UNION ALL
 SELECT user_id,request_id,status,model,price_version,input_tokens,output_tokens,thought_tokens,reserved_micros,cost_micros,created_at,finished_at,error_code FROM life_routine_builds;
--> statement-breakpoint
-- Runs in the same account-deletion statement; only minimal usage survives.
CREATE TRIGGER life_routine_builds_delete BEFORE INSERT ON life_account_deletions BEGIN
 INSERT INTO life_deleted_ai_usage
 SELECT user_id,request_id,status,model,price_version,input_tokens,output_tokens,thought_tokens,reserved_micros,cost_micros,created_at,finished_at,error_code FROM life_routine_builds WHERE user_id=NEW.user_id;
 DELETE FROM life_routine_builds WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER life_routine_builds_deleted_insert BEFORE INSERT ON life_routine_builds
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_routine_builds_deleted_update BEFORE UPDATE ON life_routine_builds
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;
