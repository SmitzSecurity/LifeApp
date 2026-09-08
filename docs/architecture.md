# Implementation decision — September 8, 2026

## Platform

Use a responsive React/TypeScript web beta on the supported Vinext/Cloudflare Worker starter, with D1 SQL persistence. This produces a durable, reviewable first slice in the available environment without introducing another no-code setup workflow. Preserve the app-store objective as a later release milestone; do not describe this web beta as fulfilling it.

Domain validation and scoring live in `lib/life/domain.ts`, independent of UI, storage, provider APIs, and auth. The HTTP service lives in `lib/life/service.ts` and accepts a database and verified identity. Its SQL uses bound parameters; account identity never comes from request JSON or URL parameters. The route adapter owns authentication and binding access. This separation lets a later consumer/mobile client reuse behavior without inheriting AppSheet or spreadsheet-column assumptions.

D1 `life_profiles` stores the user's goal, timezone, selected modules, and adopted habits as validated configuration JSON. `life_entries` stores one dated snapshot per user and calendar day, with journal, optional context, adopted habit snapshots, revision, and update timestamp. Composite `(user_id, entry_date)` primary key supports per-user history and date lookup. Revisions prevent lost updates. There is no runtime schema initialization; generated Drizzle migration owns schema creation.

Only explicit done/missed entries enter the score. A score of zero is valid; no eligible records produces null. No provider controls the number. Habit snapshots keep the original name and module when edited or archived later. A new backdated check-in starts from the current adopted habits; historical adoption-date scheduling is not implemented yet.

Identity uses private Sites sign-in and the dispatch-provided stable user id for this beta. The app is owner-private. This is a temporary auth adapter, not the planned self-service consumer account system. Do not open the app publicly until a supported consumer auth/authorization path and required data controls are implemented and verified. Do not trust these forwarded headers on a different hosting platform without an authenticated trusted proxy.

## Scope boundaries

A server Gemini adapter, manual daily review UI, immutable report revisions and usage reservations/cost meter are implemented. Activation remains disabled until a fresh owner secret and paid-project confirmation are set; no real call has been verified. AI memory, scheduled execution, email, payments, trials and the store package remain disconnected. See `ai-activation.md`, `cloud-drafts.md` and `google-sign-in.md` for the current checkpoint.

History initially loads the latest 366 check-ins. Older entries remain stored and can be fetched by exact date using the check-in date field. Pagination/search, data export/deletion, module reordering, habit restoration, scheduled habit frequencies, and advanced onboarding remain backlog items. Context-module choices are implemented; specialist reports for those modules are not.

## Next increment

The September 8 owner feedback adds the structured section tools and feedback contract described in `structured-modules.md` and `feedback-engine.md`. The manual review store and provider adapter now exist. Next implement durable scheduled jobs and email outbox, late-completion release and failure/usage reconciliation. Complete account data export/deletion and reviewable AI memory controls before external beta. The owner has requested activating AI now; a synthetic live smoke test awaits a fresh server key. When credentials become necessary, request only a new server-side provider secret through the supported secure setup flow; never reuse the legacy key. Keep tests with synthetic data. Consumer authentication and app-store stack decisions remain a separate gate before external beta access.

## References

- Platform-provided Sites building/authentication/storage instructions were read for this implementation.
- [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) supports the bound-query API used by the service.
- Source inspection details: `legacy-audit.md`.
