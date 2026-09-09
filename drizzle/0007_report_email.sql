-- Additive only: preserve existing data and queue no historical reports.
CREATE TABLE `life_email_consent` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`version` integer NOT NULL,
	`policy_version` text NOT NULL,
	`recipient` text NOT NULL,
	`enabled_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`unsubscribe_token` text NOT NULL,
	CONSTRAINT "email_consent_enabled" CHECK("life_email_consent"."enabled" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `life_email_consent_unsubscribe_token_unique` ON `life_email_consent` (`unsubscribe_token`);--> statement-breakpoint
CREATE TABLE `life_email_outbox` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`consent_version` integer NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_attempt_at` text,
	`finished_at` text,
	`message_id` text,
	`error_code` text,
	PRIMARY KEY(`user_id`, `request_id`),
	CONSTRAINT "email_outbox_state" CHECK("life_email_outbox"."state" IN ('pending','sending','sent','retry','failed','uncertain','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `idx_life_email_due` ON `life_email_outbox` (`state`,`next_attempt_at`);
--> statement-breakpoint
-- Email is queued atomically with a newly completed report. No historical backfill.
CREATE TRIGGER life_email_report_completed AFTER UPDATE OF status ON life_ai_reviews
 WHEN NEW.status='complete' AND OLD.status<>'complete' AND length(NEW.report_text)>0
 BEGIN
 INSERT INTO life_email_outbox(user_id,request_id,consent_version,state,created_at,next_attempt_at)
 SELECT NEW.user_id,NEW.request_id,c.version,'pending',NEW.finished_at,NEW.finished_at
 FROM life_email_consent c JOIN life_auth_user u ON 'google:'||u.id=c.user_id
 WHERE c.user_id=NEW.user_id AND c.enabled=1 AND c.policy_version='full-report-v1'
 AND c.enabled_at<=NEW.finished_at AND c.recipient=u.email AND u.email_verified=1
 ON CONFLICT DO NOTHING;
 END;
--> statement-breakpoint
-- Turning email off or accepting a new consent version retires unsent old jobs.
CREATE TRIGGER life_email_consent_changed AFTER UPDATE ON life_email_consent
 BEGIN
 UPDATE life_email_outbox SET state='cancelled',finished_at=NEW.updated_at,error_code='consent_changed'
 WHERE user_id=NEW.user_id AND state IN ('pending','retry')
 AND (NEW.enabled=0 OR consent_version<>NEW.version);
 END;
--> statement-breakpoint
CREATE TRIGGER life_email_account_deleted AFTER INSERT ON life_account_deletions
 BEGIN
 DELETE FROM life_email_outbox WHERE user_id=NEW.user_id;
 DELETE FROM life_email_consent WHERE user_id=NEW.user_id;
 END;
--> statement-breakpoint
CREATE TRIGGER life_email_consent_deleted_insert BEFORE INSERT ON life_email_consent
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_email_consent_deleted_update BEFORE UPDATE ON life_email_consent
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_email_outbox_deleted_insert BEFORE INSERT ON life_email_outbox
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;
--> statement-breakpoint
CREATE TRIGGER life_email_outbox_deleted_update BEFORE UPDATE ON life_email_outbox
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;
