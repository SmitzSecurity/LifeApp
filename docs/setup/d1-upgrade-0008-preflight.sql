-- Read only. Expect eight migrations, no cadence column or period consent table.
SELECT name FROM d1_migrations ORDER BY id;
SELECT name FROM pragma_table_info('life_ai_reviews') WHERE name IN ('cadence','window_start');
SELECT name FROM sqlite_master WHERE name='life_period_consent';
SELECT (SELECT count(*) FROM life_profiles) profiles,(SELECT count(*) FROM life_entries) entries,
 (SELECT count(*) FROM life_resources) resources,(SELECT count(*) FROM life_ai_usage) attempts,
 (SELECT sum(cost_micros) FROM life_ai_usage) measured,
 (SELECT sum(CASE WHEN cost_micros IS NULL THEN reserved_micros ELSE 0 END) FROM life_ai_usage) held;
