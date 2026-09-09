# Initial D1 setup through the owner's console

Prepared September 9, 2026 from the unchanged migrations `0000` through `0004`
at main commit `2de604a5de633cdf446af047fd0f171b1803d88f`. This is a fixed initial
setup bundle, not an additional migration or an application runtime change.

Use `d1-initial-0000-0004.sql` only after inspecting the intended database and
confirming it has no application tables and no `d1_migrations` table. Cloudflare's
own `_cf_KV` table may exist. The SQL never changes that internal table. Keep
sign-in closed until setup and verification are complete.

1. Confirm the Worker's `DB` binding targets the intended existing database.
2. In that database's Console, paste the entire SQL file and execute once. Each
   statement is on one line, with no line comments, so pasting into a single-line
   input does not comment out later statements. Keep the trigger intact.
3. The final result should be `LifeApp database ready`, `migrations_applied=5`,
   `app_tables=11`, `reminder_trigger=1`, and `review_status_view=1`.
4. Inspect the result before enabling Google sign-in. If an error occurs, retain
   the exact error and inspect the schema and migration ledger; do not erase the
   database or rerun the bundle blindly.

The bundle creates the same schema as the five original files. It uses the
installed Wrangler 4.92.0 migration ledger definition and records each exact
filename after its statements. Future `wrangler d1 migrations list/apply` should
therefore recognize these five migrations, rather than recreate their tables.
Later schema changes belong in new files in `drizzle/`, not this snapshot.

No IF NOT EXISTS clauses conceal an existing incompatible schema. Repeating
this bundle fails at its first CREATE TABLE. No application records, credentials,
AI calls, emails, billing actions or external account permissions are included.
The operator executes it using their own authenticated Cloudflare Console; this
file alone does not establish that any remote migration has run.

Verification of this exact bundle: an in-memory SQLite database with foreign
keys enabled matched all original schema objects after normalization of comments
and whitespace. All five ledger names, 11 app tables, the trigger and view were
verified. A synthetic discovered day produced one reminder and changed from
missing to ready when completed. Repeating setup failed without changing the
existing synthetic record or duplicating migration records. A fresh Miniflare
probe did not return in this environment; do not describe this bundle as remotely
tested or freshly verified through D1's console. The original migrations were
already exercised by the earlier standalone Worker/D1 suite.

Official references checked September 9, 2026:
[D1 migration tracking](https://developers.cloudflare.com/d1/reference/migrations/)
and [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/),
which supports semicolon-separated statements executed as a batch.
