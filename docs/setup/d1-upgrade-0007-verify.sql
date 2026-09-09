-- Read only. Installation does not grant consent, queue old reports or send email.
SELECT
 (SELECT COUNT(*) FROM d1_migrations) AS migrations,
 (SELECT COUNT(*) FROM d1_migrations WHERE name='0007_report_email.sql') AS migration_0007,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('life_email_consent','life_email_outbox')) AS email_tables,
 (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'life_email_%') AS email_triggers,
 (SELECT COUNT(*) FROM life_email_consent) AS email_consents,
 (SELECT COUNT(*) FROM life_email_outbox) AS email_jobs;
