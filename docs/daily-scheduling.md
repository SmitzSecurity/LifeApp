# Durable daily scheduling foundation

Implemented September 9, 2026 in the canonical GitHub product. This is tested code,
not a live scheduler, AI activation or email delivery service.

## What now works

- A standalone Worker scheduled handler discovers yesterday's review at/after the
  user's saved local time. It uses the stored IANA timezone, including daylight
  saving changes. A skipped spring-forward time runs on the first later tick;
  a repeated autumn time identifies the same account/day, not a second job.
- Migration `0004_mature_makkari.sql` adds durable account/day scheduling intents
  and metadata-only reminder intents. A SQL trigger commits both together.
  Duplicate/overlapping ticks cannot create another intent for the same day.
- `life_daily_job_status` derives eligibility directly from committed profiles,
  entries and original reports. Finishing a held entry releases its eligibility
  in that very commit, without waiting for another tick. Reopening it restores
  the hold. This is immediate **eligibility**, not immediate AI execution yet.
- Missing/incomplete data never calls AI or affects scores. Reminder eligibility
  disappears as soon as the entry is complete, reminders/reviews are disabled,
  or a report attempt exists. No journal, email address or report prose is copied
  to the queue/outbox.
- An existing original report suppresses generation; failed, generating or
  uncertain attempts require attention and cannot silently become a fresh job.
  Original/revised report and cost-ledger records remain untouched.
- The authenticated daily AI status response and review panel can show the job's
  current state, with explicit messaging that automatic execution is not active.

## Activation boundary

The handler requires BOTH `LIFEAPP_AUTH_MODE=google` and the owner-controlled
`LIFEAPP_REVIEW_PLANNER_ENABLED=true`. It does not inherit activation from AI
flags. No public HTTP trigger, default Cron configuration, provider consumer or
email sender was added. Default builds remain inactive.

After owner hosting setup, migrations and review of this boundary, the operator
can configure a Cron expression such as `*/5 * * * *` in the existing standalone
Wrangler configuration. Do not activate it as part of a credentials check.
Cloudflare runs Cron in UTC, so the code performs per-user local-time evaluation.
The official [Cron documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
and [scheduled-handler API](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
were checked September 9, 2026.

The current beta scan supports at most 500 profiles. It fails explicitly before
creating jobs if that bound is exceeded; partitioned discovery is required before
larger deployments. Invalid profiles are counted without logging their content;
the handler marks that tick failed after processing valid profiles. A version
guard skips preferences changed during a scan and retries discovery on the next
tick. A crash after a committed insert is safe to replay.

Discovery only covers the preceding local day, after today's preferred time.
Already-discovered old jobs remain durable, but a full-day scheduler outage does
not backfill historical days. Changing time/timezone does not rename a discovered
day or fabricate earlier jobs. An explicit catch-up policy is still needed.

## Next implementation

1. Add explicit user consent for automatic use of saved context, separate from
   default-on scheduling preferences and per-request manual consent.
2. Implement a bounded execution worker using the existing AI admission/ledger.
   Recheck completion, preferences, source version, consent and spend caps in
   the same admission boundary. A view read alone is NOT a lock or authorization
   to call a provider; preserve the unique original-report reservation gate.
3. Keep uncertain provider attempts held for reconciliation. Expiring a job lease
   must never permit a duplicate paid provider call.
4. Add delivery claims, verified-recipient resolution, opt-out rechecks and an
   idempotent provider-backed email sender. The current reminder table contains
   **intents only**, not a transport-ready outbox. No messages have been sent.
5. Add worker dispatch after late completion, outage catch-up policy, higher-order
   periods and account deletion cleanup before activation at scale.

Scheduling tables are derived operational metadata, not part of portable-v1
backups. Migration must leave both planners/consumers disabled, then reconstruct
eligible schedule metadata after authenticated source/destination reconciliation.
Do not transfer reminder intents as already-authorized emails or AI charges.

## Verification

Synthetic SQLite and compiled Worker/D1 tests cover timezone boundaries/DST,
duplicate ticks, profile-change races, missing/late/reopened entries, preference
opt-outs, preserved manual reports, held uncertain attempts, atomic job/outbox
rollback, private status reads, inactive flags and scan capacity. No personal
journals, real Google login, provider calls, email, payment or deployment are used.
Browser/phone rendering of the new status text has not been tested.

The complete standalone gate passed 56 tests (52 source/service and four compiled
Worker tests), including ten new scheduling checks. Production build and
TypeScript checking passed.
