# Upgrade the existing database for account deletion

Migration 0005 and automatic-review activation are already complete in the owner's
September 9 checkpoint. This is the next, separate upgrade, **0006**. Keep the
existing Worker, `DB` binding and D1 database. Do not rerun 0000–0005.

This additive migration creates two empty tables, a usage view, a deletion trigger
and 20 stale-write guards. Creating the trigger does not execute a deletion. It
does not change users, consent, Cron, runtime flags, existing records or usage.
The new application code requires its usage view, so apply and verify the schema
before merging/deploying the account-deletion PR.

## Before the approved rollout

1. Open the existing `lifeapp` D1 Console and verify its ID against the `DB` binding
   and current private checkpoint.
2. Record `/bookmark` for recovery. Do not run `/restore` during ordinary setup.
3. Run [d1-upgrade-0006-preflight.sql](d1-upgrade-0006-preflight.sql). Expect:

| Field | Expected |
| --- | ---: |
| migrations | 6 |
| required_prior_migrations | 6 |
| app_tables | 12 |
| deletion_objects | 0 |
| reminder_trigger | 1 |
| status_view | 1 |

4. Run [d1-upgrade-0006-counts.sql](d1-upgrade-0006-counts.sql) and keep the result.
   Use a quiet interval for reconciliation. Automatic jobs can legitimately
   change counts; if they are active, record that fact and investigate differences.

If preflight differs, inspect the schema/ledger before writing. A partial or
already applied upgrade needs reconciliation, not an initial bootstrap.

## Apply once and verify

Paste the entire [d1-upgrade-0006.sql](d1-upgrade-0006.sql) bundle and execute once.
It puts each complete SQL statement, including each trigger body, on one line for
the D1 Console and records `0006_account_deletion.sql` in the migration ledger.
Then run [d1-upgrade-0006-verify.sql](d1-upgrade-0006-verify.sql) separately.

| Field | Expected before any account deletion |
| --- | ---: |
| migrations | 7 |
| migration_0006 | 1 |
| app_tables | 14 |
| deletion_objects | 4 |
| stale_write_guards | 20 |
| deleted_accounts | 0 |
| archived_attempts | 0 |
| scheduler_objects | 2 |

Run the counts query again. In a quiet interval every value must match, including
existing consent and sessions. A “no data” response from the schema bundle is not
verification. On any error or interruption, inspect what was applied; D1 Console
multi-statement requests must not be assumed to roll back as a whole. Never
blindly repeat or mark the migration applied before all objects are verified.

An operator with a correctly configured authenticated Wrangler setup can instead
list and apply pending migrations. Only 0006 should be pending. Wrangler handles
the ledger; do not also run the console bundle. The local placeholder database ID
is never a production target.

## Deployment, smoke check and rollback

After verification, merge/deploy the reviewed PR. Check ordinary Google sign-in,
the Account dialog, export, saved check-in history and existing review receipts.
Opening the dialog or choosing Keep my account changes no data. Preserve the
current Cron and runtime flags. Do not use the owner's account for deletion tests.

Once any deletion has happened, a code rollback to a version that budgets only
from `life_ai_reviews` would omit archived usage. Keep AI and automatic execution
disabled during such a rollback, and deploy code using `life_ai_usage` before
reenabling them. Leave migration 0006, retirement markers and usage archives in
place. Do not restore deleted journals or auth sessions to reverse the feature.
See [account deletion](../account-deletion.md) for backup/retention limitations.

The original pre-upgrade count query is for initial reconciliation. After actual
deletions, use `life_ai_usage` for site-wide measured and held totals; the active
review count alone is intentionally lower.
