# Automatic daily reviews

Implemented September 9, 2026 in the canonical GitHub product. The manual Gemini
path is live and owner-confirmed. Automatic execution is tested with synthetic
providers and remains off in the default configuration; this change does not
activate production Cron, consent, email or billing.

## User choice

My setup has a separate Automatic daily reviews section. It explains the saved
context sent to Google Gemini, the saved daily time/timezone, completion gates,
shared usage limit and late completion. An unchecked consent box plus Turn on
automatic analysis is required. Ordinary profile saves and the existing default-on
daily preference cannot grant consent. Unsaved setup edits must be saved first.

Consent is stored separately with an optimistic version, policy `daily-v1`, the
server-recorded acceptance time and the local opt-in date. Only that date and later
check-ins are eligible; enabling the feature cannot analyze an older journal
backlog. Re-enabling starts from the new opt-in date. Turning off daily reviews
also suppresses execution without erasing the separate saved choice.

Turn off automatic analysis blocks new admissions even when provider activation
is disabled. A stale tab cannot undo a newer opt-out. A review already admitted
may finish and consume tokens; disabling cannot recall a provider request. Manual
reviews retain their per-request consent. Email and external search remain off.

The authenticated `GET /api/life?automatic=1` reads the saved choice and schedule.
`POST /api/life` with action `automatic-consent` changes only the authenticated
account, enforces the existing origin/JSON checks and requires a matching consent
version. There is no public HTTP scheduler trigger. The client cannot pass the
server-only automatic-admission argument to the generation service.

## Discovery and execution

The scheduled Worker discovers the preceding local day after the user's preferred
time, using IANA timezone rules. A skipped spring-forward time runs on the first
later tick; a repeated autumn hour does not create another job. The existing
migration 0004 trigger commits a metadata-only reminder intent with each job;
the live eligibility view observes completion, reopened entries and preferences
without copying journal content into a queue.

A tick scans at most 500 profiles, skips already-discovered dates using an indexed
three-date UTC window, and attempts at most 20 new job inserts. Later ticks can
progress past accounts discovered earlier. It fails explicitly beyond the beta
capacity or on invalid profiles. It does not reconstruct days missed during a
full-day outage; a separate catch-up policy is still needed.

The consumer considers at most two ready, consented jobs per tick. Never-considered
jobs come first; deferred jobs rotate by their last consideration time so a capped
or oversized context cannot monopolize the batch. This timestamp is fairness
metadata, not a lease and not permission to repeat a provider call. Already-
discovered late days remain eligible when completed, after the current saved
local time. No execution runs synchronously inside the check-in save request.

The existing AI service performs automatic and manual generation. One serialized
SQLite INSERT admits the original review and reserves its usage. That statement
checks consent enabled/version/policy/start date, current profile and entry
versions, live ready status, the account/site caps, daily limit and the global
cost circuit breaker. The original request key and unique account/day/revision
constraint prevent concurrent manual and scheduled requests from calling Gemini
twice. An edit or opt-out committed before admission blocks that admission.

After admission, a crash, timeout or unconfirmed result leaves the original
attempt and its reservation. Neither path silently retries it. Completed reviews,
revisions and measured costs use the existing settlement path. The immutable
input snapshot records the consent version/policy/date/time used by an automatic
original. Stored authorization evidence is not an active grant on another account.

## Runtime bounds

The planner uses at most 22 D1 queries. Two reviews, including enabled budget,
transaction and workout reads plus settlement, stay below the free tier's
50-query invocation allowance in the covered path. A synthetic test counts these
queries with 23 accounts and module context. This is a query budget, not a claim
that all workloads satisfy CPU, row-read or daily request limits. Monitor the first
owner-controlled activation before expanding the beta.

Cloudflare references checked September 9, 2026:
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cron configuration](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

The provider timeout is 55 seconds per attempt. Runtime pricing checks use actual
execution time on each candidate, not a delayed Cron event's timestamp. Existing
pricing expiry and tracked monthly limits remain unchanged.

## Operator activation order

The existing populated beta database has a console-ready upgrade, before/after
checks and recovery notes in [setup/README.md](setup/README.md).

1. Review the change and apply pending migration `0005_automatic_daily_consent.sql`
   through the existing D1 migration workflow to the existing database. It adds
   the consent table, consideration timestamp and date index. It does not alter
   migration 0004's trigger/view or grant anyone consent. Do not rerun bootstrap
   migrations 0000–0004. Back up/inspect the target before a production migration.
2. Deploy the reviewed code with the new automatic flag absent or false. Existing
   manual AI generation does not require the new table while automatic execution
   is off; the new settings remain unavailable until migration succeeds.
3. For an explicitly approved rollout, add a Cron expression such as `*/5 * * * *`
   to the existing Wrangler configuration and set both runtime text flags
   `LIFEAPP_REVIEW_PLANNER_ENABLED=true` and
   `LIFEAPP_AUTOMATIC_REVIEWS_ENABLED=true`. Existing Google mode, paid-project
   confirmation, AI activation and server key must still be configured. No new
   API key or billing purchase is part of this feature.
4. In the app, review the saved daily time/timezone and explicitly opt in using
   a synthetic test account. Finish that day's check-in. Observe the next day's
   due tick, saved original, token/cost receipt and stable result after another
   tick. Test opt-out before expanding access. Record actual live outcomes.

Remove the automatic flag or set it false to stop new automatic admissions;
manual reviews can remain available. Pausing Cron stops discovery/dispatch but
cannot cancel a provider request already admitted. Existing report history and
usage reservations must be retained.

## Verification and remaining scope

The source suite exercises default-off/private consent, stale replay/opt-out,
consent/profile/entry races immediately before the atomic INSERT, overlapping
manual/automatic runs, late completion, changed local time, start-date restriction,
unknown provider holds, shared caps/circuit breaker, fairness and D1 query budget.
The compiled Worker test uses Miniflare D1 plus a mocked Gemini HTTPS response,
with outbound network disabled, and proves one saved result across repeated ticks.
Migration preview accepts and preserves automatic consent evidence in historical
reviews but exports/imports no active grant. Existing manual/auth/module tests run
unchanged against all migrations.

Automatic production execution, phone/browser rendering and provider invoice
reconciliation have not been verified. Reminder intents still lack a delivery
consumer; no emails were sent. Outage catch-up, larger-scale dispatch, higher-order
reviews and account-deletion cleanup remain separate work. Legacy account/data
migration must keep execution off until verified source/destination reconciliation
and a fresh opt-in on the destination.
