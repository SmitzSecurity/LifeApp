# Account deletion

The Account button is available after Google sign-in, including before onboarding.
It offers the existing private export, describes the records removed and usage
retained, and requires typing `DELETE`. The server requires an exact same-origin
JSON POST and a verified, beta-permitted Google session created within the last
10 minutes. Users with an older session sign out, sign in again, and reopen Account.
No account ID is accepted from the client. The built-in Better Auth deletion route
remains disabled; this endpoint implements the atomic D1 operation explicitly.

A successful deletion removes profiles, check-ins, resources, AI snapshots,
reports and critiques, automatic consent, jobs, reminder intents, OAuth account
records/tokens, the LifeApp auth user and every session belonging to that user.
Session cookie caching is disabled, so subsequent requests with old cookies fail
authentication. The successful browser view removes the journal UI. Another tab
can still display content it had already loaded, but cannot save or reload it.
The user's Google account and independently downloaded exports are unaffected.

The server inserts an opaque `google:<LifeApp-user-id>` retirement marker. An
AFTER INSERT trigger archives minimal AI accounting and deletes the records in
one serialized write. The write rechecks session ID, user ID, expiry and freshness
inside its SELECT, closing the gap after session authentication. Trigger failures
roll back the complete operation. Insert/update guards stop in-flight requests
from recreating records, consent, jobs or auth sessions for a retired ID.

## AI accounting and requests already running

`life_deleted_ai_usage` retains only the opaque former account ID, request ID,
status, model/price version, reported tokens, reserved/measured cost, timestamps
and a controlled error code. It contains no journal, goal, report, critique,
email, name, Google subject, OAuth tokens or provider response ID. These are
pseudonymous usage records, not anonymous data or customer charges.

`life_ai_usage` is a UNION ALL view over active and archived attempts. All AI
admission cost/rate queries and the cost-bound circuit breaker read this view.
Deleting an account cannot reduce site-wide measured or held usage. If deletion
wins during a provider request, its completion updates only the archive; its
report is discarded. An unconfirmed result retains its reservation and is never
automatically repeated. A request already admitted may still transmit or finish;
local deletion cannot recall a request from the AI provider. A response already
received by a browser cannot be retracted.

Signing in again creates a new LifeApp account and requires new automatic consent.
No mapping to the old Google subject or email is retained to relink the account.
Therefore account-specific limits start over for the new account, while the
site-wide limit still includes old costs and reservations. This is not a complete
anti-abuse design for open public registration; the verified beta allowlist remains.

## Retention and recovery boundary

Retirement markers and usage accounting currently have no automatic expiry.
They must remain available for stale-write protection and unresolved cost
reconciliation. Provider backups, operational access/rate-limit records and
short-lived, unassociated OAuth state have their own retention; this operation
does not selectively erase them or delete information already processed by Google.
An owner-approved retention policy and disclosure review remain public-launch work.

Restoring D1 to a point before a deletion can restore personal data and sessions.
Do not restore such a backup into service unchanged. Keep the service closed,
reconcile all later deletions from a separately retained operator record, revoke
restored sessions, and verify erasure before serving requests. Do not remove usage
holds merely to make a count match. This feature does not automate backup recovery.

## Rollout and verification

Apply migration 0006 to the existing database before deploying this code; use
[the rollout instructions](setup/account-deletion-0006.md). No live deletion is
performed by migrations, builds or tests. Test actual deletion only with a
separately authorized disposable beta account, never the owner's working journal.

Synthetic tests exercise populated deletion, another account's isolation, invalid
confirmation/origin, anonymous and unverified sessions, freshness and revocation
races, rollback, stale writes, pre-onboarding deletion, in-flight provider success,
unknown usage and the cost-bound circuit breaker. The compiled Worker test uses
local D1 and a genuinely signed synthetic session cookie, then verifies that old
cookies cannot read journals, exports or AI reports.

References checked September 9, 2026: [D1 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/),
[Better Auth session management](https://better-auth.com/docs/concepts/session-management),
and [session cookies](https://better-auth.com/docs/concepts/cookies).
