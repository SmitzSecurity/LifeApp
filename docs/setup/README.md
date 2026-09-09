# Database upgrades

For the pending account-deletion feature, use [migration 0006](account-deletion-0006.md).
The owner has already applied 0005 and opted in to automatic reviews. The following
0005 instructions are retained for historical deployments; do not repeat them on
the current database.

# Historical upgrade: migration 0005

This is the pending upgrade for the populated `lifeapp` D1 database already
bound as `DB`. It combines with the usage receipt and automatic-review code in
PR #2. It does not create a database, import old account data, grant consent or
activate automatic reviews. The initial migrations 0000–0004 are already applied.

## Inspect the existing database

In Cloudflare, open **Storage & databases → D1 → lifeapp → Console**. Confirm its
ID against the current `DB` binding and the private project checkpoint. Keep the
automatic execution flag absent/false during the upgrade. Avoid check-in edits
and new AI requests while recording the before/after counts below.

1. Save a current recovery bookmark using `/bookmark`. It records a recovery
   point; it does not restore or modify the database. Keep that value privately.
2. Run [d1-upgrade-0005-preflight.sql](d1-upgrade-0005-preflight.sql).
3. Run [d1-upgrade-0005-counts.sql](d1-upgrade-0005-counts.sql) and save its result.
   It returns aggregate counts and usage totals, without journal text or secrets.

Expected preflight values for this upgrade:

| Field | Expected |
| --- | ---: |
| migrations | 5 |
| required_prior_migrations | 5 |
| app_tables | 11 |
| consent_table | 0 |
| consideration_column | 0 |
| job_date_index | 0 |
| reminder_trigger | 1 |
| status_view | 1 |

If these do not match, inspect the migration names and schema before running any
write. A partially applied or already applied upgrade needs reconciliation;
rerunning the initial bootstrap is not a repair.

## Apply the pending upgrade

After the target and preflight are verified for the approved rollout, paste the
entire [d1-upgrade-0005.sql](d1-upgrade-0005.sql) into the Console and execute it
once. Each statement occupies one line and contains no line comments. This
bundle contains only the three schema statements from canonical migration
`drizzle/0005_automatic_daily_consent.sql`, followed by its exact migration-ledger
entry. No existing table is dropped or rebuilt, and no application rows are seeded.

Then execute [d1-upgrade-0005-verify.sql](d1-upgrade-0005-verify.sql) separately.
A console message saying “no data” for the write is not the verification result.

| Field | Expected before anyone opts in |
| --- | ---: |
| migrations | 6 |
| migration_0005 | 1 |
| app_tables | 12 |
| consent_table | 1 |
| consideration_column | 1 |
| job_date_index | 1 |
| reminder_trigger | 1 |
| status_view | 1 |
| consent_rows | 0 |

Run the counts query again. Saved profile, entry, resource, review and job counts,
plus measured/held usage, should be unchanged while application writes are quiet.
Inspect any difference before proceeding. Existing authentication users remain.

The bundle intentionally fails if repeated; it does not conceal an incompatible
table with `IF NOT EXISTS`. If an error or connection interruption occurs, stop
and inspect the schema and migration ledger. Do not assume a failed console
request rolled back every statement, blindly retry, or mark the migration applied
before all three schema changes are confirmed. Never restore a bookmark merely
to retry: a restoration would also discard writes after that bookmark.

An operator already using a correctly configured, authenticated Wrangler setup
can instead list pending migrations and apply them through the existing workflow.
Only 0005 should be pending. Wrangler handles the ledger, so do not also run the
console bundle. Never use this checkout's placeholder database ID for production.

## Deploy and activate separately

Once the migration verifies, merge/deploy the reviewed combined code with automatic
execution off. A main-branch merge can trigger the existing Cloudflare Git build.
Check Google sign-in, the existing saved review's Usage details, and My setup.
The new consent control should show that automatic reviews await activation.

The later Cron/flag rollout and the account's separate opt-in are documented in
[daily-scheduling.md](../daily-scheduling.md). No new API key is required. Keep the
previous deployment available for code rollback; leave the additive schema and
all saved reports/reservations intact when rolling code back.

The upgrade is tested against a populated synthetic database and local D1. That
does not establish that the owner's production upgrade or activation has run.

Official references checked September 9, 2026:
[migration ledger](https://developers.cloudflare.com/d1/reference/migrations/),
[schema inspection](https://developers.cloudflare.com/d1/sql-api/sql-statements/),
and [recovery bookmarks](https://developers.cloudflare.com/d1/reference/time-travel/).
