# Workout notes, routine drafts and report formatting

September 14, 2026. Default training goal: muscle growth, with strength secondary.

## Product behavior

- Saved analyses render a shared Markdown subset in the app and future HTML emails: headings, emphasis, lists, links and tables. Raw HTML and images are disabled; links allow only HTTP(S) and mailto. Plain-text emails retain the source. No report is regenerated and no previously sent email is resent.
- The current structured logging/AI/Trash extension is described in [workout-logging.md](workout-logging.md).
- Workouts has a written log with an optional duration. Notes use the existing versioned resource API and can be edited or excluded. Daily and period analyses receive bounded excerpts and explicit coverage. Notes do not fabricate sets, reps, load volume or cardio totals; the movement chart counts logs, which may overlap structured sessions.
- Users can type or dictate a routine description, then choose Build with AI. Only that description, the saved Movement goal and exercise guidance go to Gemini. Routine drafts persist separately from analyses and are never emailed. Review routine opens the normal editor; Save routine is a separate action. Reopening an accepted draft uses the current saved routine, preserving edits.
- Dictation starts only on a user click, stops on request/unmount, and depends on the browser's speech service, which may process audio remotely. Unsupported browsers show the keyboard-dictation fallback. No microphone access is required for typed logs or AI building.
- Existing routines and active workout snapshots retain their exact targets. New exercises have editable lower/upper rep targets; 70 presets replace the old 16-item catalog. Unknown starting loads are zero and must be chosen by the user.

## Evidence and defaults

There is no uniquely optimal rep/rest pair for each exercise. These are practical, editable applications of the evidence for generally healthy adults, not individualized rehabilitation prescriptions.

- [ACSM 2026 resistance-training guidance](https://acsm.org/resistance-training-guidelines-update-2026/) emphasizes consistency, individualization, heavier loading for strength, and sufficient weekly volume for hypertrophy. A preset's three sets are a starting point, not a complete weekly-volume prescription.
- [IUSCA hypertrophy position stand](https://journal.iusca.org/index.php/Journal/article/view/81) supports hypertrophy across loading ranges, practical moderate rep ranges, and generally at least two minutes of rest for multi-joint exercises versus 60–90 seconds for isolation/some machines.
- [2024 rest-interval meta-analysis](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full) finds a small potential advantage over very short rest, with uncertainty about precise longer-rest differences. Longer rest can help preserve performance.

Heavy lower-body compounds start at 5–8 reps/180 seconds; presses and heavy pulls 6–10/150; other compounds 8–12/120; isolation work 10–15 or 12–20/90; repetition-based core work 10–20/60. Users can rest longer and adjust load/targets. Cardio and timed holds are not silently converted into lifting repetitions by the builder.

## Data and request safety

Migration **0009_routine_builder.sql was applied and verified on September 14, 2026**. Never replay migrations0000–0009. The new table stores routine requests/results and extends life_ai_usage to include them alongside analyses and archived usage. Existing report, resource, consent and auth rows are untouched. The existing daily eligibility view and hand-authored reminder trigger are preserved.

Routine requests require an explicit action, a bounded description and server-selected instructions. JSON output is strictly validated (1–6 days, at most12 exercises/day and48 total); invalid/truncated output settles known usage without saving a routine. Request IDs have a routine: namespace. Admission is atomic: shared account/global monthly limits, five total AI attempts per UTC day, at most two routine builds per UTC day, the global cost circuit breaker, and at most one unresolved routine build per account. A retry never repeats a provider request once admitted. Unknown outcomes retain reservations and pause new builds pending operational reconciliation.

Account deletion atomically erases routine descriptions/drafts and workout notes, retaining only minimal AI accounting. An in-flight result after deletion settles archived usage without recreating personal data. Portable backups include optional routineBuilds; old backups still validate. Unknown builds trigger the same migration reconciliation blocker as unknown analyses. Keep the extended usage view on code rollback; do not drop0009 or remove archived accounting.

Historical migration procedure (already completed): record a recovery bookmark, validate a private portable backup, compare personal-data hashes and usage/consent counts, and check that0009 is absent. Execute the canonical0009 statements and migration-ledger insert in one D1 batch. Verify the new table is empty and old rows, eligibility SQL and accounting totals match before deploying code. Do not test with owner deletions, paid requests or email resends.
