-- Read only. Expected: 7 prior migrations, no email objects, no 0007 ledger row.
SELECT
 (SELECT COUNT(*) FROM d1_migrations) AS migrations,
 (SELECT COUNT(*) FROM d1_migrations WHERE name IN ('0000_loud_donald_blake.sql','0001_adorable_scream.sql','0002_blushing_prism.sql','0003_fancy_dreadnoughts.sql','0004_mature_makkari.sql','0005_automatic_daily_consent.sql','0006_account_deletion.sql')) AS required_prior_migrations,
 (SELECT COUNT(*) FROM d1_migrations WHERE name='0007_report_email.sql') AS migration_0007,
 (SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'life_email_%') AS email_objects;
