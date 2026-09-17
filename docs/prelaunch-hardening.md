# Prelaunch hardening — September 16, 2026

The workout, transaction capture, Settings footer and exercise-art release was deployed from `612744bc6b7faf30cee671b77e29fa52666262aa`. The subsequent app-wide review is on `codex/prelaunch-review`; these follow-up fixes are not yet deployed. No account access, billing, customer limits, runtime flags or migrations were changed during the review.

## Recovery and data integrity

- Responses distinguish a rejected save from an unknown outcome. A version conflict preserves the local response and offers a read-only comparison with the saved response. Keeping local changes returns to the editor for a separate Save; deleted responses must be restored first. Network/server failures retain the original mutation identity, including a subsequent expired-login rejection.
- Settings and onboarding freeze a submitted profile while its outcome is unknown. A read can acknowledge matching normalized saved values. Genuine conflicts offer explicit saved/local review; keeping local edits preserves unrelated current sections and newly added habits. No automatic overwrite is performed.
- Trash refresh updates entries and resource revisions without replaying initial deep-link navigation or timezone/profile initialization. An entries epoch prevents a delayed read from replacing a newer response acknowledgement.
- Saved program conflicts preserve the editor draft and show the current program before an explicit discard/load or save-copy choice. An edited-session conflict still permits beginning without saving the template or saving a new template. Unknown program, template and workout writes retain their identities through later authentication failures; a conflict must reconcile with a newer version of that same saved resource before releasing the retry.
- Deleting a saved recurring item uses its saved snapshot even if the unrelated editor draft is invalid. Ordinary Save still validates the complete draft.
- Transaction AI drafts have recoverable Delete for completed/failed drafts, with exact retry and close locks for unknown acknowledgements. Restore retains the reviewed rows. Usage, unknown holds, account isolation and Trash retention are unchanged.
- A failed loan-payment read has a scoped Retry; it neither replays a mutation nor clears payment drafts.
- Cardio, analysis feedback/regeneration, routine/training AI, Budget AI and transaction-import retries also keep their exact submitted snapshots if an earlier unknown result is followed by an expired-login response. A later authentication rejection cannot disprove the earlier write.

## UI corrections

The new response conflict dialog scrolls internally and keeps its two choices reachable on narrow screens. Date clear targets are 44px. Recurring start/end controls stack on narrow screens so large text, the date and calendar/clear controls cannot overlap. Settings retains its pinned Save/Cancel footer and the main navigation remains 64px.

## Request hardening

Auth, account-deletion and email-consent bodies are limited while streaming, including requests without Content-Length. Oversized reads cancel after crossing the endpoint limit instead of buffering the entire body. AI regeneration retries must retain the same source version, predecessor and feedback. An unchanged retry returns its original job; changing the payload under that ID returns a conflict, including admission races. Original deterministic daily/period analysis identities remain unchanged. No usage reservation is released by these checks.

## Dependency maintenance

Targeted patches include Next.js 16.3.5 and matching lint configuration, React/React DOM/server renderer 19.2.8, Sharp 0.35.4, Vite 8.0.16 and compatible transitive patches. Vinext remains on its current major; its pinned image-size parser is narrowly overridden to 2.0.4. These versions are recorded in the lockfile.

Cloudflare build tooling uses the matched stable pair Vite plugin 1.47.0 / Wrangler 4.114.0 with their required Workers type declarations. Miniflare stays on version 4. Scoped overrides patch its Sharp to 0.35.4 and Undici to 7.29.0; deployment bindings, compatibility date and runtime flags are unchanged.

The full dependency audit now has no high or critical findings. Four moderate entries describe one remaining chain through Drizzle's esbuild-kit dependency and esbuild 0.18.20. That copy is used for transforms, not the affected `serve` feature, and is absent from the Worker bundle. The optional Better Auth peer causes it to appear even in production-only dependency reports. Do not apply npm's suggested Drizzle downgrade: it violates the supported peer range and changes migration tooling. Reassess this bounded [development-server advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) if adding an esbuild server or changing the toolchain.

Relevant maintainer notices: [Next.js Windows server advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Sharp libheif advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), and [React server renderer advisory](https://github.com/advisories/GHSA-wx67-qw84-cm4g). LifeApp runs on Vinext/Cloudflare, not a Windows Next.js server, but the server renderer is part of its bundle; dependency classifications alone are not a deployment exposure assessment.

## Repeatable verification

The final review passes 444 source tests and 22 compiled Worker integration tests (466 total), TypeScript, a clean `npm ci`, the production-configured Cloudflare build and its deployment dry run. The compiled checks cover Google sign-in, account isolation, imports, scheduling, email acceptance, deletion and Trash purge. The dry run does not publish the review changes.

Browser checks covered desktop and 320px layouts with 130% text: response/profile/program conflict recovery, lost-save acknowledgement recovery, clean first setup, Trash restoration without deep-link navigation, invalid recurring-draft deletion, transaction-draft Delete/Restore, stacked date controls and loan-read Retry. Workout checks confirmed one saved program copy after an exact retry, the inline preview Edit action, cross-program previous performance, set skipping, rest extension, navigation/reload persistence and finishing with only the logged set counted. Final tested pages had no console warnings/errors. All browser records were synthetic.

Use the disposable loopback fixture in `scripts/browser-smoke.mjs`, with synthetic D1 and mocked providers. `--response-conflict`, `--profile-conflict` and `--routine-conflict` simulate a competing edit before the first saved-record write. `--profile-save-unknown` loses a successful profile acknowledgement; combine with `--onboarding --editing` for first setup. `--unconfirmed-transaction-draft-delete` loses the recoverable draft-deletion acknowledgement. `--debt-read-failure` fails one loan read. Existing workout/entry/import unknown-response flags remain available. Rebuild and restart fixtures together: an old fixture's SSR bundle must not be served against newly replaced client assets.

Verification uses no owner-account deletion, production record writes, real camera/microphone recordings or paid AI calls. Physical mobile keyboards, native camera capture, vibration and delivery to a new customer's mailbox still require device/integration testing.

The complete repository ESLint gate now passes with zero errors and zero warnings. React callbacks are committed after render, stale request replies cannot replace newer scopes, and keyed/state-based resets preserve drafts. New component regressions cover response/history/dictation lifecycle, retained Budget editors and storage preferences, workout navigation/rest/drag state, exercise playback and native-dialog dates. Trash restoration expires on a timer. Only ignored build/runtime/scratch output is excluded from lint; no new source-rule suppressions were added.

Sign-out uses full-page navigation at the authentication boundary. A trial use of next/link pulled a Vinext Pages Router dynamic import into the Worker; the compiled test gate rejected it. Native action buttons preserve server session rechecks without that dependency.

## Before paid onboarding

This hardening pass does not implement a paywall or open registration. Resolve these separately before inviting paying users:

- Define customer entitlements and enforce them on the server, including billing webhook retries and subscription cancellation. The current API intentionally reports `customerBilling: false`.
- Deliberately replace the private beta allowlist; test a second real account and account isolation end to end.
- Review/remove the expiring owner development override and define customer AI allowances, shared spending ceilings and scheduled-analysis headroom. Current ordinary limits and held unknown usage remain unchanged.
- Account for the planner's 500-profile bound and the export limits of 8 MB/10,000 rows; add supported capacity paths before exceeding them.
- Finalize retention, backup erasure, privacy and support policies. Keep the existing seven-day Trash and archived accounting safeguards.
- Run physical-device and real new-account onboarding checks, including login expiry, camera/PDF receipt review and accessibility with assistive technology.
