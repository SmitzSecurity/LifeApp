# LifeApp

Private working beta of LifeApp: journal, track habits and activity, manage a budget, and learn from daily and longer-term analysis.

## Canonical project

Repository: [SmitzSecurity/LifeApp](https://github.com/SmitzSecurity/LifeApp).

This replaces the abandoned Apps Script version with the current self-contained app. Earlier GitHub commits retain the original attempt. The current app runs directly on Cloudflare Workers/D1; its normal commands no longer require Sites. The old private web beta stays available until verified account/data cutover.

## Local development

Use Node 24 and an owner-controlled development environment:

```sh
npm ci
npm run standalone -- init-local
npm run standalone -- migrate-local
npm run dev
```

Open http://localhost:3000. Google sign-in requires owner credentials in the ignored local settings file; it is intentionally unavailable until configured. See `docs/migration-to-codex.md` for guided Google/AI/hosting setup. Customers never provide API keys.

For Cloudflare's GitHub-connected creation form, use the prepared commands and build setting in `docs/cloudflare-git-build.md`. That path preserves dashboard runtime settings and keeps the initial deployment closed until Google sign-in is configured.

The local migration checker is implemented: `npm run migration:preview -- SOURCE.json [--target TARGET.json] [--out NEW_REPORT.json]`. See `docs/data-migration-preview.md`. It validates private exports and flags conflicts/held AI usage; it cannot import data or prove account ownership.

## Implemented

- Two-step onboarding with Journal, Movement and Money included, three optional focus areas, explicit habit adoption, custom habit names, renaming and archiving.
- Daily journal, preserved earlier section notes, done/missed/exempt/unrecorded states, saved history and editing by calendar date. History searches journal text and filters inclusive dates and completion status, with 30-entry pages reaching beyond the initial 366-day list. Search text stays in a private JSON request body; search does not change saved entries or reports.
- Deterministic scoring with exempt and missing entries excluded and a separate count for each status.
- D1 persistence for profiles and dated entries; server identity from authenticated Google sessions; optimistic revisions prevent stale saves.
- Historical habit snapshots preserve old names and choices. Archived habits remain visible on their saved days.
- 36 standard habits, per-section goals, automatic timezone with advanced override.
- Compact monthly budgets with inline category limits, contributing-transaction drill-down and transaction edits. Recurrence supports day-of-month or nth/last weekday; variable bills/income require estimates and show pending actual amounts. Forecasts and recorded totals remain distinct, with exact cents and duplicate occurrence protection. Long-term budget goals live in Settings.
- Strength routines/splits, saved set-by-set logging, rest timers, corrections and history; cardio logs include duration, optional distance, effort and notes. Home shows four weeks of recorded budget and movement trends.
- Daily, weekly, monthly and annual AI analysis with concise output, saved guidance, source-window validation and preserved earlier versions. Feedback can save for the future or save and regenerate. Atomic reservations, shared caps, archived accounting and two revisions per analysis per UTC day protect provider usage. Costs/models/tokens are absent from the reading UI but retained internally and in exports.
- Home presents yesterday's analysis, today's log, latest period reports and activity trends. Analysis appears above an entry. Compact Responses, search, explicit Save/Cancel and dirty-state guards remain. Navigation is Home, Responses, Budget and Workouts, with Settings in the top-left menu. Delete account is at the bottom of Settings.
- Durable daily scheduling, explicit automatic-analysis opt-in and a bounded consumer share the manual AI reservation/duplicate gate. New admissions recheck consent, preferences, completion and caps atomically. Production activation requires migration 0005, operator flags and Cron. See `docs/daily-scheduling.md`. Migration 0008 adds a separate periodic-analysis opt-in; new schedules default to 04:00 local time. Daily and periodic consumers alternate on the existing five-minute Cron. See `docs/analysis-and-budget.md` for cadence rules, limits and migration guidance.
- Full-report emails use a separate opt-in, verified recipients, an atomic outbox and unsubscribe controls. Activation requires migration 0007 and the sender/runtime configuration in `docs/report-emails.md`. Email delivery never regenerates reports or grants automatic-analysis consent. Settings keeps the independent daily, periodic and email opt-ins.
- Private data export and confirmed account deletion, including session revocation and separate minimal AI usage retention. Deletion requires a recent Google sign-in and migration 0006; see `docs/account-deletion.md` and `docs/setup/account-deletion-0006.md`.
- Analysis guidance is user-managed. Biography generation and external-event search remain disconnected.
- No real personal source records, credentials, AI calls, sample records, or billing are seeded into the app.

This is a private web beta, not an app-store release. On September 9, 2026, the owner confirmed Google sign-in and check-in persistence on the deployed Cloudflare app, then supplied a screenshot of a completed Gemini review for a synthetic check-in with measured usage and no remaining reservation. Independent provider invoice reconciliation and live cross-account isolation checks remain outstanding. The old Sites app and its records remain separate until verified account/data cutover. See `docs/architecture.md` for the migration boundary and remaining capabilities.

## Validation

For independent development, use Node 24 and `npm ci`, then:

```sh
npm test
npx tsc --noEmit
```

`npm test` builds and tests the standalone target without Sites helpers. Retired Sites-specific checks are preserved in `legacy/sites/`; they are not part of the standalone gate.

The first suite uses the actual migration and SQLite statements with synthetic users; the second executes the compiled Worker with local D1 under Miniflare. Its compatibility date matches the installed workerd binary (2026-05-22). It does not contact the published app. The deletion checks also exercise signed session cookies, atomic rollback and in-flight AI settlement.

Browser checks can run against a disposable synthetic fixture after building:
`node scripts/browser-smoke.mjs`. Add `--calm --history --editing --analysis` for richer disposable fixtures and mocked AI; all external networking is blocked. Open the loopback URL printed by the command.
It serves the compiled app with a synthetic signed session and two saved check-ins,
allows GET and read-only history search, blocks data changes and external provider calls, and uses temporary local
D1 only. Check Account, download the synthetic backup, choose Keep my account,
and reopen a check-in from History. Stop the process when finished. This verifies
local UI behavior; production Google sign-in and the owner's data need their own
authenticated smoke check.

Use `node scripts/browser-smoke.mjs --history` for 400 synthetic days. Check
loading older pages, journal search, date/status filters, clearing filters, and
reopening an entry older than the initial 366-entry list. No migration is needed
for history search; every query uses the verified account and existing entry dates.

See `docs/structured-modules.md` and `docs/feedback-engine.md` for earlier implementation boundaries. Current additions and activation dependencies: `docs/cloud-drafts.md`, `docs/ai-activation.md` and `docs/google-sign-in.md`.

## Resume

1. Read the continuing Library build log `libfile_19df04a785a0819185c2b0a728b24c08`.
2. Reopen this GitHub repository and the current checkout.
3. Address the next recorded task; do not restart the scaffold.
4. Update the same build log with exact implementation and verification status.
