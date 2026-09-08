# Feedback engine — September 8, 2026 owner direction

LifeApp’s core value is an evolving understanding of the user, grounded in their explicit goals, journals and activities. Budget and gym tools provide structured evidence; they are not a replacement for holistic advice, linked reviews and an editable life narrative.

## Implemented in this increment

- Per-section goals, optional spiritual tradition, overall analysis intent and cadence-specific focus, tone and depth are saved privately in the existing profile.
- Daily, weekly, monthly and annual enable switches and local execution preferences are saved. Email, reminders, local event area and biography preferences are explicit. These are preferences for future integrations; no scheduler, provider or email sender is active.
- A check-in can be saved as a draft. To finish, the user must supply journal text and resolve each adopted habit as done, missed or exempt. Optional module notes may be blank. Legacy entries need an explicit completion confirmation. This is a review eligibility rule, not a moral judgment or change to habit scoring.
- The journal shows unfinished-prior-day status and completion issues. Editing a completed entry creates an unfinished draft until the user finishes again.
- `dailyReviewDecision` blocks absent or incomplete entries, preserves an existing report, and makes complete entries eligible. `lateCompletionAction` models releasing a held job after its original trigger was due. These are tested domain functions, not a connected job runner.
- `buildReviewContext` supplies completed, dated evidence from enabled sections, goals, selected preferences, structured monthly money totals and workout sets. Missing and unfinished coverage are explicit. Higher order review context includes the latest successful revisions of lower-order reviews in its period, alongside original source entries.

## Next implementation: durable jobs and report revisions

Use an account-partitioned report store and transactional outbox. A schedule tick creates one deterministic initial job for account + cadence + period; it does not call a model directly. The local-date calculation uses the saved IANA zone. Daily targets yesterday; weekly targets the prior calendar week (Monday–Sunday), monthly the prior calendar month, annual the prior calendar year. Clamp day 29–31 to the last valid day. Resolve DST gaps/overlaps explicitly and test once-per-local-period scheduling.

The user’s missing-prior-day rule applies to scheduled analysis: a missing previous-day entry suppresses analysis and produces at most one opted-in reminder; an unfinished entry holds the job. Show this status in the journal. Do not infer that a habit failed, the user abandoned their goals, or a spiritual lapse occurred. Empty review periods do not generate an AI narrative.

Persist `blocked_missing` / `blocked_incomplete` jobs. In the same database transaction that changes a check-in from unfinished to complete, release due jobs that depend on that date. Enqueue them immediately if enabled and if no successful initial report exists. Worker claiming and a unique job key must prevent duplicate work from schedule ticks, reloads, late completions or multiple devices. Test the SQL/outbox transition before connecting a provider; the current pure decision tests do not prove transactional scheduling.

Each initial successful report is immutable. Store source entry versions, selected goals/settings snapshot, cited dates and a content/evidence digest. If source entries change, show “entry updated since this report” and offer regeneration. Do not silently replace the report.

Manual generation can target any completed day. Regeneration accepts the user’s critique or missing emphasis and creates a new revision, linking its predecessor and retaining the original. Each generation request gets its own idempotency key and usage reservation; an accidental retry does not incur another request or charge. An intentional new revision may incur disclosed usage and must respect caps. UI must distinguish queued, blocked, generating, complete, failed and awaiting provider setup states.

## User profile, memory and biography

Separate user-stated facts from AI-inferred patterns. Each memory assertion needs supporting entry/report IDs, dates, confidence, and accepted/corrected/dismissed status. Users can inspect, correct, exclude and remove it. No silent promotion of a model suggestion into a goal, adopted habit, diagnosis or enduring identity. Avoid self-reinforcing summaries: original entries remain evidence even when higher-level reports use lower-level reports.

Biography is opt-in, editable, versioned and linked to supporting dates. Record events and the user’s own interpretation; mark uncertainty and exclude rejected inferences. Allow excluding sensitive entries from analysis or biography before enabling provider calls. Optional spiritual content follows the user’s chosen tradition and avoids pathologizing absence or inferring failure.

## Email and local opportunities

Email is a first-class review destination, alongside in-app history. Deliver only after the report is saved, to the verified account address, with delivery preference, unsubscribe control and a separate idempotent delivery outbox. Email failure must retry delivery without regenerating or billing for the report again. The preference currently saves only; no message was sent during development.

Local opportunities are opt-in and use the user-specified general area and goals. Verify dates, locations, links and availability before inclusion. Mark search cost separately, enforce its allowance, and never add recommendations/events to the habit denominator.

No email examples were needed to implement this contract. Read a bounded set of original reports through the connected email app only when refining actual report templates; do not copy private journal material into source fixtures.

## Integration gates

Before provider calls: supported server credentials, account isolation, consent for sensitive data, prompt/evidence boundaries, actual usage/cost ledger, reservations and caps, retry handling, report revisions, data export/deletion and test fixtures. Before email: verified delivery address, configured sender and explicit opt-in. Consumer signup/recovery and app-store billing remain separate launch requirements. No real customer charge or public store submission is authorized here.
