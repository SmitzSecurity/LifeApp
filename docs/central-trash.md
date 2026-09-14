# Central Trash and analysis replacement

Released from `codex/central-trash`. Migration `0010_central_trash.sql` is required before this binary runs. Never replay completed migrations 0000–0009.

Trash lives in the top-left menu. Journal entries, transactions, recurring monthly items, strength/cardio logs, written workout notes and generated analyses/drafts have one account-scoped Restore/permanent-delete list. Normal screens keep Delete actions and omit deleted items. Archived categories/programs remain archives because saved records reference their identities.

Deletion time is recorded once when an item enters Trash. Restoring and deleting again starts a new window; editing a deleted item does not. The existing five-minute Cron purges expired items in bounded batches of 50, even when AI and email are disabled. Restore closes at exactly seven days. Manual permanent deletion uses the same atomic purge path immediately. Accounts with more than 50 expired items are processed over successive ticks.

The purge marker and content removal occur in one SQLite trigger transaction. A failure rolls both back. Opaque IDs prevent stale saves from resurrecting removed items. Entry versions remain monotonic across deletion: reopening a permanently deleted date supplies an empty entry with a fresh version so the date can be used again safely. Recurring items retain only a minimal hidden placeholder for transaction references; titles, amounts and schedule details are erased. Analyses are separate saved records from the source logs used to generate them.

AI input/output content is scrubbed on permanent deletion, while attempt IDs, measured costs, unknown reservations, revision keys and recovery-consumption markers remain. Account deletion also clears Trash metadata and preserves the existing minimal accounting ledger. Pending/retry email for a deleted analysis is cancelled; previously sent email is outside app storage and Restore never resends it.

Successful regeneration discards prior generated text for the same journal/report period or training week. It also removes embedded predecessor text from the new snapshot. Failed or uncertain regeneration preserves the current completed analysis. Existing superseded analyses are retired by Cron. Distinct report periods remain available. No paid request is made by this cleanup.

Write workout no longer offers Organize with AI, and the `workout-build` HTTP action returns 410 before any reservation/provider call. Plain notes, browser dictation, existing structured-note editing, personal presets from saved structured logs, and their accounting remain. Routine building and training analysis retain their existing explicit actions and limits.

## Migration procedure

1. Verify migrations 0000–0009, the existing DB binding, Cron, runtime flags and separate consents with read-only checks.

2. Save a private portable backup and validate it; record a current D1 recovery bookmark. Compare personal-row fingerprints, usage and original eligibility objects before/after installation.

3. Apply only the canonical 0010 statements and its migration-ledger insert in one D1 query batch. Installation backfills deletion metadata but removes no content. Do not replay on an ambiguous response; inspect schema/ledger first.

4. Verify the new table, index and every trigger against the local canonical definitions, and verify unchanged old personal data/usage/consents and eligibility SQL. Deploy through the existing Git build.

5. Verify the deployed menu and removed organizer with read-only checks. Use only synthetic fixtures for Restore, permanent deletion, regeneration and account deletion tests.

Prefer a forward fix after release. Older binaries do not understand purged accounting rows, tombstones or retention, and must not be used as a general rollback. Never restore a pre-release database bookmark over newer owner writes just to retry an upgrade.
