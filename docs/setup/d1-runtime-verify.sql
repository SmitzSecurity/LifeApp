-- Read-only post-0006 checks. No journal text, identity, credentials or SQL writes.
-- Run against the existing DB through the connected Cloudflare API or configured Wrangler.
SELECT name FROM d1_migrations ORDER BY id;
SELECT
 (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name GLOB 'life_*') AS app_tables,
 (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('life_account_deletions','life_deleted_ai_usage','life_ai_usage','life_delete_account')) AS deletion_objects,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND (name GLOB 'life_*_deleted_insert' OR name GLOB 'life_*_deleted_update')) AS stale_write_guards,
 (SELECT COUNT(*) FROM sqlite_master WHERE name IN ('life_daily_reminder_intent','life_daily_job_status')) AS scheduler_objects;
SELECT
 (SELECT COUNT(*) FROM life_profiles) AS profiles,
 (SELECT COUNT(*) FROM life_entries) AS entries,
 (SELECT COUNT(*) FROM life_resources) AS resources,
 (SELECT COUNT(*) FROM life_ai_reviews) AS active_attempts,
 (SELECT COUNT(*) FROM life_deleted_ai_usage) AS archived_attempts,
 (SELECT COUNT(*) FROM life_account_deletions) AS deleted_accounts,
 (SELECT COUNT(*) FROM life_review_jobs) AS jobs,
 (SELECT COUNT(*) FROM life_reminder_outbox) AS reminder_intents;
SELECT COUNT(*) AS attempts,
 COALESCE(SUM(cost_micros),0) AS measured_micros,
 COALESCE(SUM(CASE WHEN cost_micros IS NULL THEN reserved_micros ELSE 0 END),0) AS held_micros
FROM life_ai_usage;
SELECT enabled,policy_version,start_date,COUNT(*) AS accounts
FROM life_automatic_consent GROUP BY enabled,policy_version,start_date;
SELECT state,COUNT(*) AS jobs FROM life_daily_job_status GROUP BY state;
SELECT entry_date,status,
 CASE WHEN json_extract(input_snapshot,'$.automaticConsent') IS NULL THEN 'manual' ELSE 'automatic' END AS source,
 COUNT(*) AS attempts
FROM life_ai_reviews GROUP BY entry_date,status,source ORDER BY entry_date,status,source;
SELECT COUNT(*) AS duplicate_original_groups FROM (
 SELECT user_id,entry_date FROM life_ai_reviews WHERE revision=1
 GROUP BY user_id,entry_date HAVING COUNT(*)>1
);
