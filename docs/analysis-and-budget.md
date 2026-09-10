# Analysis, Home and budget

The September 2026 update presents saved analysis before an entry's journal, with Feedback and Regenerate controls. Earlier versions stay in storage and in the optional version history. Provider/model/token/cost details remain internal accounting and export data, not the reading interface. There is no customer billing implementation.

Feedback saves to versioned profile guidance (12 notes, 500 characters each). Save for future makes no provider request. Save & regenerate first persists the note, then requests a revision; if generation fails, the note remains saved. Settings allows editing/removing guidance. Server admission limits revisions to two per analysis per UTC day and all AI attempts to five per account per UTC day, with the existing account/global reservations and archived-usage circuit breaker retained. Unknown requests never retry automatically.

Journal, Movement and Money are included when old or new profiles are parsed. No new habits are automatically adopted. Existing entry snapshots and earlier section notes are preserved. New context can be written directly into the journal. Cardio supports activity, duration, optional distance/unit, effort and notes. Voided activities and unfinished strength sessions are excluded from trends.

Home opens by default and offers yesterday's analysis, today's log, the latest saved weekly/monthly/annual analysis and four weekly activity buckets. Weekly periods are Monday–Sunday; monthly/yearly periods are full calendar periods. Larger reports aggregate all eligible days and clearly identify sampled journal excerpts. Prior completed shorter analyses are supporting evidence, not a replacement for the recorded facts. Budget goals and saved guidance inform all cadences.

New schedules default to 04:00 in the user's timezone; existing stored preferences are not silently changed by a default. Automatic daily consent remains separate. New `periods-v1` consent authorizes weekly/monthly/annual generation independently, using enabled cadence preferences. There is no automatic backfill of periods ending before acceptance. One existing five-minute Cron alternates daily (up to two) and periodic (up to one) generation, so each is considered about every ten minutes; planning and email consumption still run each tick. Report emails retain their independent `full-report-v1` consent and native delivery controls. Pricing currently fails closed at January 1, 2027, until the server price table is reviewed.

Recurring budget items support a calendar day or first/second/third/fourth/last weekday of the month. A positive amount is required, including an estimate for variable bills/income. Forecasts automatically reserve allowance space for the selected saved month. Due variable items show Needs actual amount and require an explicitly entered actual amount. Estimates are never presented as recorded cash flow. The deterministic occurrence ID prevents double counting; actual confirmation removes that occurrence from the forecast. Plans carry forward into unsaved future months for review, as before.

Allowance headings expand into their limit editor and contributing transactions. Recurring editors are inside Category allowances. Transaction corrections happen within the selected tile and retain optimistic versions and exact retries after an ambiguous save. Archiving categories and pausing recurring items retain references. Budget goals appear during initial setup, then in Settings; legacy monthly goal snapshots remain in backups and provide fallback context. No bank transfers or bank synchronization are performed.

Settings groups goals, habits, analysis/guidance, timezone and automation/email. Download data and Delete account are at the bottom; there is no Account menu. The existing recent-login and exact DELETE confirmation remain mandatory.

## Budget editing follow-up

Budget goals open in a dialog over Budget, using the same fields and saved profile as Settings. Saving retains transaction and monthly-plan drafts. Concurrent Settings changes use the profile version guard; the popup retains its draft and reconciles the latest profile before retrying, including a lost save response.

Transaction history offers Edit, Void/Unvoid and Delete in the row. Voided text is struck through and excluded from totals. Delete hides the transaction from normal history, category totals, Home trends and future analysis context. Deleted transactions provides Restore; exports retain the payload and identity. Restoring a voided item leaves it voided until explicitly unvoided.

Recurring editors and expected payments offer Delete monthly item. Save plan applies it to the selected month. Saved recurring IDs remain as deleted, inactive records, with Restore under Deleted monthly items; recorded payments stay intact. New unsaved recurring drafts can be removed entirely. Plans copied into new months exclude deleted items from forecasts. A stale client cannot create a new occurrence for a deleted item. Confirming a deleted actual again reuses its deterministic occurrence ID.

Expanded allowances show a downward chevron, accent heading and Collapse hint. Desktop tile pairs stretch to equal height; mobile uses natural-height single columns. This follow-up requires no database migration or production data rewrite. Older payloads default to not deleted. After a user deletes an item, do not roll back to code that ignores deleted flags: it would incorrectly count deleted values. Use a compatible forward fix.

## Deployment

Apply only `0008_analysis_periods.sql` after confirming 0000–0007 are present. It adds cadence/window columns, changes the revision unique index, creates empty period consent with deletion guards, and recreates daily eligibility with the original logic plus a daily-only report join. It does not modify old journal/resource/report payloads or opt anyone in. Snapshot/validate private export and record a D1 recovery bookmark first. Run the migration and its ledger insert in one D1 query batch; never replay prior migrations. Compare original rows/usage and confirm period consent is empty before deploying code.

Current old code remains compatible during the additive schema upgrade because new columns have a daily default. Once periodic reports exist, roll back only to code that understands cadence; never redeploy pre-deletion-accounting code. Data restoration is a separate explicitly scoped recovery action, not part of deployment.

Validation: full `npm test`, TypeScript, Cloudflare build/dry-run; synthetic browser fixture `node scripts/browser-smoke.mjs --calm --history --editing --analysis` uses isolated D1 and a mocked provider with real networking disabled. No live paid report, email or account deletion is needed to verify this release.
