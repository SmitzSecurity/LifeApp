-- Read only. Expect nine migrations, zero initial period opt-ins, daily originals preserved.
SELECT name FROM d1_migrations WHERE name='0008_analysis_periods.sql';
SELECT name FROM pragma_table_info('life_ai_reviews') WHERE name IN ('cadence','window_start');
SELECT name FROM sqlite_master WHERE name IN ('idx_life_ai_cadence_revision','life_period_consent_deleted_insert','life_period_consent_deleted_update','life_period_consent_delete');
SELECT count(*) periodic_choices FROM life_period_consent;
SELECT cadence,count(*) reports FROM life_ai_reviews GROUP BY cadence;
SELECT (SELECT count(*) FROM life_profiles) profiles,(SELECT count(*) FROM life_entries) entries,
 (SELECT count(*) FROM life_resources) resources,(SELECT count(*) FROM life_ai_usage) attempts,
 (SELECT sum(cost_micros) FROM life_ai_usage) measured,
 (SELECT sum(CASE WHEN cost_micros IS NULL THEN reserved_micros ELSE 0 END) FROM life_ai_usage) held;
