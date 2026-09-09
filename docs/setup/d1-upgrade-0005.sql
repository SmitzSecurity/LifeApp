CREATE TABLE `life_automatic_consent` ( `user_id` text PRIMARY KEY NOT NULL, `enabled` integer NOT NULL, `version` integer NOT NULL, `policy_version` text NOT NULL, `start_date` text NOT NULL, `accepted_at` text NOT NULL, `updated_at` text NOT NULL );
ALTER TABLE `life_review_jobs` ADD `last_considered_at` text;
CREATE INDEX `idx_life_review_job_date` ON `life_review_jobs` (`entry_date`);
INSERT INTO d1_migrations (name) VALUES ('0005_automatic_daily_consent.sql');
