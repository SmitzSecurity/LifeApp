CREATE TABLE `life_reminder_outbox` (
	`user_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `entry_date`)
);
--> statement-breakpoint
CREATE TABLE `life_review_jobs` (
	`user_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`detected_at` text NOT NULL,
	`timezone` text NOT NULL,
	`local_time` text NOT NULL,
	`profile_version` integer NOT NULL,
	PRIMARY KEY(`user_id`, `entry_date`)
);
--> statement-breakpoint
-- One metadata-only reminder intent per discovered day. This is atomic with the
-- job insert, including a crash between schedule discovery and its acknowledgement.
CREATE TRIGGER life_daily_reminder_intent AFTER INSERT ON life_review_jobs BEGIN
 INSERT INTO life_reminder_outbox(user_id,entry_date,created_at)
 VALUES(NEW.user_id,NEW.entry_date,NEW.detected_at) ON CONFLICT DO NOTHING;
END;
--> statement-breakpoint
-- Live eligibility is derived from the committed source, so completing/reopening
-- a check-in, turning reviews off, or creating a manual report cannot leave a stale
-- ready job. No asynchronous copy/update of completion flags is needed.
CREATE VIEW life_daily_job_status AS
WITH eligibility AS (
 SELECT j.user_id,j.entry_date,j.detected_at,e.version AS source_version,
 COALESCE(json_extract(p.payload,'$.reviewPreferences.remindersEnabled'),1) AS reminders_enabled,
 CASE
  WHEN r.status='complete' THEN 'already-generated'
  WHEN r.request_id IS NOT NULL THEN 'attention'
  WHEN p.user_id IS NULL OR COALESCE(json_extract(p.payload,'$.reviewPreferences.daily.enabled'),1)<>1 THEN 'disabled'
  WHEN e.user_id IS NULL THEN 'missing'
  WHEN COALESCE(json_extract(e.payload,'$.complete'),0)<>1
    OR length(trim(COALESCE(json_extract(e.payload,'$.journal'),'')))=0
    OR EXISTS(SELECT 1 FROM json_each(e.payload,'$.habits') h WHERE json_extract(h.value,'$.status')='unrecorded') THEN 'incomplete'
  ELSE 'ready'
 END AS state
 FROM life_review_jobs j
 LEFT JOIN life_profiles p ON p.user_id=j.user_id
 LEFT JOIN life_entries e ON e.user_id=j.user_id AND e.entry_date=j.entry_date
 LEFT JOIN life_ai_reviews r ON r.user_id=j.user_id AND r.entry_date=j.entry_date AND r.revision=1
)
SELECT *,CASE WHEN state IN ('missing','incomplete') AND reminders_enabled=1
 AND EXISTS(SELECT 1 FROM life_reminder_outbox o WHERE o.user_id=eligibility.user_id AND o.entry_date=eligibility.entry_date)
 THEN 1 ELSE 0 END AS reminder_pending FROM eligibility;
