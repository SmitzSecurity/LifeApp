-- Add cadence metadata without rewriting saved analyses or accounting.
ALTER TABLE life_ai_reviews ADD COLUMN cadence TEXT NOT NULL DEFAULT 'daily' CHECK(cadence IN ('daily','weekly','monthly','annual'));--> statement-breakpoint
ALTER TABLE life_ai_reviews ADD COLUMN window_start TEXT;--> statement-breakpoint
CREATE UNIQUE INDEX idx_life_ai_cadence_revision ON life_ai_reviews(user_id,cadence,entry_date,revision);--> statement-breakpoint
DROP INDEX idx_life_ai_revision;--> statement-breakpoint
CREATE TABLE life_period_consent (
 user_id TEXT PRIMARY KEY NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL,
 policy_version TEXT NOT NULL,
 start_date TEXT NOT NULL,
 accepted_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 last_considered_at TEXT
);--> statement-breakpoint
CREATE TRIGGER life_period_consent_deleted_insert BEFORE INSERT ON life_period_consent
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;--> statement-breakpoint
CREATE TRIGGER life_period_consent_deleted_update BEFORE UPDATE ON life_period_consent
 WHEN EXISTS(SELECT 1 FROM life_account_deletions WHERE user_id=NEW.user_id)
 BEGIN SELECT RAISE(ABORT,'Account has been deleted'); END;--> statement-breakpoint
CREATE TRIGGER life_period_consent_delete AFTER INSERT ON life_account_deletions
 BEGIN DELETE FROM life_period_consent WHERE user_id=NEW.user_id; END;--> statement-breakpoint
-- Preserve the original daily eligibility logic; only daily originals join it.
DROP VIEW life_daily_job_status;--> statement-breakpoint
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
 LEFT JOIN life_ai_reviews r ON r.user_id=j.user_id AND r.entry_date=j.entry_date AND r.revision=1 AND r.cadence='daily'
)
SELECT *,CASE WHEN state IN ('missing','incomplete') AND reminders_enabled=1
 AND EXISTS(SELECT 1 FROM life_reminder_outbox o WHERE o.user_id=eligibility.user_id AND o.entry_date=eligibility.entry_date)
 THEN 1 ELSE 0 END AS reminder_pending FROM eligibility;
