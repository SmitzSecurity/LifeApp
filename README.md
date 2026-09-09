# LifeApp

Private working beta of LifeApp: select life areas, adopt habits, record a day, and revisit saved check-ins.

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

- Two-step onboarding, six selectable context modules, explicit habit adoption, custom habit names, renaming and archiving.
- Daily journal, optional module notes, done/missed/exempt/unrecorded states, saved history and editing by calendar date.
- Deterministic scoring with exempt and missing entries excluded and a separate count for each status.
- D1 persistence for profiles and dated entries; server identity from authenticated Google sessions; optimistic revisions prevent stale saves.
- Historical habit snapshots preserve old names and choices. Archived habits remain visible on their saved days.
- 36 standard habits, per-section goals, automatic timezone with advanced override.
- Structured monthly budgets, scheduled payments/income, category allowances, actual transactions and saving/investing goals; exact cents and duplicate occurrence protection.
- Workout routines/splits, saved set-by-set gym logging, rest deadline/countdown, optional supported-browser vibration, corrections and session history.
- AI feedback preferences, explicit completion, missing-prior-day UI and tested hierarchical/late-completion rules. Manual daily AI review and critique-based preserved revisions, server Gemini adapter and usage reservations/caps are implemented.
- Expandable usage details on each review show reported input/output/thinking tokens, the saved provider cost in USD to six decimal places, and the remaining budget reservation. Thinking tokens are included in output; unknown usage stays unconfirmed rather than appearing free. These are application accounting records, not provider invoices or customer charges.
- Automatic cloud check-in drafts, serialized/idempotent saves, visible sync errors and leave-page protection.
- Durable daily schedule/reminder intents and live missing/incomplete/ready status are implemented and tested. Automatic execution and email delivery remain off; see `docs/daily-scheduling.md`.
- Evolving AI memory and biography generation remain disconnected.
- No real personal source records, credentials, AI calls, sample records, or billing are seeded into the app.

This is a private web beta, not an app-store release. On September 9, 2026, the owner confirmed Google sign-in and check-in persistence on the deployed Cloudflare app, then supplied a screenshot of a completed Gemini review for a synthetic check-in with measured usage and no remaining reservation. Independent provider invoice reconciliation and live cross-account isolation checks remain outstanding. The old Sites app and its records remain separate until verified account/data cutover. See `docs/architecture.md` for the migration boundary and remaining capabilities.

## Validation

For independent development, use Node 24 and `npm ci`, then:

```sh
npm test
npx tsc --noEmit
```

`npm test` builds and tests the standalone target without Sites helpers. Retired Sites-specific checks are preserved in `legacy/sites/`; they are not part of the standalone gate.

The first suite uses the actual migration and SQLite statements with synthetic users; the second executes the compiled Worker with local D1 under Miniflare. Its compatibility date matches the installed workerd binary (2026-05-22). It does not contact the published app. No browser automation has been performed.

See `docs/structured-modules.md` and `docs/feedback-engine.md` for earlier implementation boundaries. Current additions and activation dependencies: `docs/cloud-drafts.md`, `docs/ai-activation.md` and `docs/google-sign-in.md`.

## Resume

1. Read the continuing Library build log `libfile_19df04a785a0819185c2b0a728b24c08`.
2. Reopen this GitHub repository and the current checkout.
3. Address the next recorded task; do not restart the scaffold.
4. Update the same build log with exact implementation and verification status.
