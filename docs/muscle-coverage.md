# Muscle coverage and the compact training workspace

September 14, 2026. Programs and Start are the primary actions. Desktop pairs the launcher with muscle coverage; phones switch between Programs & session and Muscle map. Written logs, cardio, history, AI drafting and program editing open focused dialogs. Hiding a tool preserves its draft, stops dictation and restores focus; explicit Cancel discards a program edit. Training-only AI is a labeled placeholder. The owner plans separate training and finance analyses later; this release adds neither automatic requests nor new opt-ins.

## Volume and evidence

- **Program:** saved planned sets for one session. It is not compared with a weekly reference.
- **Weekly plan:** sets multiplied by an explicit `weeklySessions` (0–7) on each active program. Unset frequencies are excluded and disclosed; zero means intentionally outside the weekly plan. If the routine listing is incomplete, no partial weekly-plan total is presented.
- **This week:** Monday through today in the user's saved timezone. Counts only logged, positive-rep, non-warm-up sets, including work in an active session. It reads the full bounded activity window rather than the 100-session history slice. Exceeding the bound fails closed without partial totals. Last week in the header is the previous full calendar week, clearly labeled.

The estimate is **direct sets + 0.5 × indirect sets**, per muscle. A compound set can contribute to multiple muscles but counts once in the overall working-set total. Unknown custom movements are explicitly unmapped, never silently guessed. Written notes and cardio continue informing analyses without invented lifting sets. Marking a planned set as a warm-up excludes its volume; it still occupies that planned set's slot. Older unmarked sets remain working sets. Saved history is never rewritten to retrofit classifications.

[ACSM's 2026 guidance](https://acsm.org/resistance-training-guidelines-update-2026/) suggests around 10 weekly sets per muscle group for hypertrophy, emphasizes individualization, and recommends training major groups at least twice weekly. This is a broad reference, not a universal optimum or a quota for every small muscle. Colors saturate at 10 rather than rewarding endless volume.

The half-set approximation comes from [Pelland et al., Sports Medicine (2026; online December 2025)](https://pubmed.ncbi.nlm.nih.gov/41343037/), **not an ACSM fractional-counting rule**. Their meta-regression found fractional counting fit the evidence better than direct-only or full indirect credit. That does not establish an exact 50% stimulus for each assisting muscle or prescribe an individual's ideal volume.

The original SVG is a schematic of 14 broad regions. Assignments across the 70 presets are practical movement-based estimates, informed by basic anatomy ([OpenStax upper limb](https://openstax.org/books/anatomy-and-physiology-2e/pages/11-5-muscles-of-the-pectoral-girdle-and-upper-limbs), [lower limb](https://openstax.org/books/anatomy-and-physiology-2e/pages/11-6-appendicular-muscles-of-the-pelvic-girdle-and-lower-limbs)). Technique, effort, range and individual anatomy affect stimulus. Mere stabilization does not automatically earn credit. Grouped shoulders/core do not imply equal training of every subdivision. Users can edit direct/indirect assignments, change sets/frequency or add suggested exercises for a selected gap. Renaming an exercise clears its saved mapping to avoid retaining a different movement's targets.

## Data and validation

No migration. Optional JSON fields: `routine.weeklySessions`, `exercise.muscles = {direct, indirect}`, and `set.warmup`. Schema validation rejects duplicate/overlapping muscle roles. New preset exercises persist their assignments; historical exercises without assignments use name-based catalog defaults at read time. Explicit saved assignments always win. Workout snapshots retain their original exercises and mappings when a program is edited; existing version checks, exact retries and one-active-workout rules remain.

Daily/period analysis contexts include compact, date-scoped muscle-volume evidence with interpretation limits. No report is regenerated or emailed by this change. Consent, reservations, rate limits, migration0009 accounting and archived usage remain in force. All workout fields travel in the existing account export and deletion paths.

Verification: ten new tests cover all preset mappings, half-set math, weekly frequency, warm-ups/zero reps, unknown exercises, legacy validation, scoped evidence, timezone/account isolation, complete reads above100 sessions, bounded failure, immutable workout snapshots, retries and export. Existing source and compiled Worker gates remain required. Browser fixtures use synthetic routines/workouts only (`--training --analysis --editing`).
