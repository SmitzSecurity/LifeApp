# Workout logging, training analysis and Trash

September 14, 2026. This release uses the existing schema through migration0009. No production migration or setup replay is needed.

## Logging and presets

Warm-ups are additional logs. A program with three working sets still has three working sets after three warm-ups. `setNumber` is now a stable per-exercise serial, separate from the working-set ordinal shown in the UI. Up to20 working sets and20 warm-ups are allowed per exercise. Existing warm-ups keep their original IDs and historical classification; correcting a working set to a warm-up makes that working set available again. Removing a set or deleting a session updates actual coverage.

Write workout accepts typed or dictated descriptions. Organize with AI sends the description, Movement goal and catalog guidance to Gemini after an explicit click. The fixed instruction extracts completed sets only; it omits ambiguous reps/loads/units and timed/cardio work rather than manufacturing lifting data. Strict validation rejects unknown muscle IDs, overlapping roles, unsupported ranges and duplicate set IDs. Known exercise mappings override model guesses. The editable preview lets the user confirm or correct sets, loads, warm-ups and muscle assignments before Save.

Original text and confirmed structure are saved atomically in one versioned `workout-note` resource. This avoids a partial note/session save and counts the confirmed workout once. Daily/period evidence, Home trends and the weekly muscle map share that projection. Warm-ups and zero-rep sets are excluded from working volume. Unstructured notes remain narrative evidence and never manufacture sets. Users should log each session once; separately entering the same workout into two independent logs cannot be automatically disambiguated.

Saved exercise definitions appear under Personal presets in the program editor, including new movements suggested by AI. They are private to the account. The latest saved definition for a normalized name is used; copying it into a program creates a fresh independent exercise snapshot. Definitions are retained with source logs, including Trash, and disappear on account deletion. Muscle assignments and rep/rest targets remain editable estimates.

## Training analysis and AI accounting

Analyze this week generates training-only Markdown using the current calendar week, previous-week comparison, saved Movement goal, logged exercises/cardio, bounded note excerpts and estimated muscle coverage. Weeks start Monday in the saved timezone. The ongoing week is identified as partial. It does not read journals or finances, and it does not add automatic scheduling or emails. Finance-only analysis remains future work.

The existing `life_routine_builds` table stores purpose-specific jobs with `routine:`, `workout:` and `training:` request namespaces. List and backup validation distinguish their result schemas. All jobs participate in `life_ai_usage`: account/global monthly reservation limits, five total attempts per UTC day, two per tool per UTC day, the existing circuit breaker, and unresolved-job admission protection. Exact retries cannot issue another provider request. Unknown outcomes retain reservations even when hidden. Known invalid output settles measured usage and returns no usable draft. Account deletion retains only minimal accounting; in-flight results cannot recreate private content.

## Delete and Restore

Delete is recoverable: journal history, workout sessions, written logs, cardio, generated analyses and AI drafts expose Trash/Restore. Existing transaction and recurring-item deletion remains unchanged. Programs retain their Archive/Restore workflow.

Journal deletion checks the saved version, preserves the snapshot, and sets `complete=false` so the existing scheduler gate closes. Restore recovers its former completion state. Ordinary saves cannot overwrite a deleted entry. Resource deletion excludes records from activity, coverage and future evidence, and releases an active workout slot; restoring an unfinished workout requires the active slot to be available.

Analysis/build visibility uses typed `visibility` resources keyed by immutable request ID. The original output, revision chain, usage and duplicate-prevention identity remain intact. Hidden analyses are excluded from prior-report context and Home links; regeneration from a hidden predecessor retains revision identity but omits its prose with explicit snapshot evidence. Pending/retry emails are cancelled on Delete, and the atomic email claim independently checks visibility. An email already claimed for sending may already be in transit. Restore does not requeue a cancelled or uncertain delivery.

Portable export includes recoverable deleted records, visibility markers and all AI usage. Account deletion remains the separate irreversible operation with its existing verified-session safeguards. Never test either behavior on the owner's data.

## Release checks and rollback

Run `npm test`, `npx tsc --noEmit`, Cloudflare build/deploy dry-run and the disposable browser fixture with mocked AI. Regression coverage includes warm-up progression/reload, immutable plans, confirmed structured totals, account isolation, deletion/restoration, stale edits, shared limits, unknown outcomes, email cancellation and export validation. Browser checks cover phone layout, AI draft confirmation, personal presets, weekly analysis and Trash.

An older binary cannot safely read these new namespaces, visibility flags and set serials. After feature use, use a forward fix; a source recovery tag is not permission to deploy an older binary. Preserve migrations0000–0009, D1, Cron, 04:00 local daily scheduling and all existing consent/runtime flags.

## September 14 format and layout repair

Training analysis now uses the full content width with a three-line preview and a focused reader for the complete Markdown report. History/Trash is in its own panel. The initial cardio editor contains only fields and Save/Cancel; saved cardio and deletion actions are available through History → Cardio history.

Written-workout requests enforce Gemini's JSON output contract (`generationConfig.responseFormat.text`) with required fields, supported muscle IDs and numeric/array bounds. See [Google's structured-output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). The local validator remains authoritative for rep ranges, distinct muscle roles, set caps and completed facts. A single whole JSON code fence may be unwrapped; prose, partial JSON and invalid structures are rejected. Failure codes distinguish JSON, schema and truncated output; raw invalid responses are not stored. Failed drafts refresh immediately and original notes remain available to save.

The owner authorized one recovery retry after two format failures exhausted the daily allowance. Operator-issued `ai-recovery` resources have a failed-workout source UUID and expiry; no browser endpoint can create or edit them. The grant is tied to the original account and exact description. A recovery job stores `recoveryOf` in its snapshot, and the admission INSERT atomically rejects any prior use, including failed, hidden or uncertain attempts. Only that request may raise the daily count ceilings from 5/2 to 6/3; spending caps, archived usage, unresolved holds, circuit breaker and profile/tombstone checks remain mandatory. Original attempts and costs remain untouched. Export includes grant and consumption records; account deletion removes the grant and keeps minimal accounting. This requires no D1 migration. Do not automatically issue a grant or call the provider to test it.

Validation: 160 source tests plus 11 compiled Worker tests; TypeScript and Cloudflare deployment dry run. The synthetic browser fixture supports `--analysis --editing --training --workout-recovery` to test exhausted limits and single recovery without provider access or live data.
