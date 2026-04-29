# LifeApp — Life Operating System

A modular, reproducible journaling + habit-tracking system built on:

- **Google Sheets** — the database. Rich free-text columns (journal,
  finance, workouts, spiritual life) sit alongside binary habit columns
  (Success / Fail / Exempt).
- **AppSheet** — a clean GUI for entering data, so you never edit the
  spreadsheet directly.
- **Apps Script** — generates Daily / Weekly / Monthly / Annual /
  Spiritual reports via Gemini, writes them back to the sheet, and
  emails a formatted version to you.

The script's only home for *you-specific* configuration is the
spreadsheet itself. Code is generic. Move, change careers, refocus your
goals — you edit cells in `User_Profile`, not source code.

---

## Secrets

The Gemini API key is **never** stored in source or in the spreadsheet.
It lives in Apps Script's Script Properties, which is private to the
script's owner. See setup step 4 below for how to set it once with
`setApiKey()`.

---

## What's in this repo

```
LifeOS.gs          The entire engine. One file, paste it in as-is.
appsscript.json    The Apps Script manifest (OAuth scopes).
```

`LifeOS.gs` is internally organized into clearly labelled sections so
it stays readable as a single file:

```
SECTION 1  — Constants
SECTION 2  — Trigger entry points (runDailyAudit, runSpiritualReport, ...)
SECTION 3  — Setup (setupSpreadsheet, setApiKey)
SECTION 4  — Default seed data for User_Profile and System_Docs
SECTION 5  — Report processors (daily/weekly/monthly/annual)
SECTION 6  — Spiritual analysis + biography append
SECTION 7  — Config readers (User_Profile, System_Docs)
SECTION 8  — Prompt templating
SECTION 9  — Gemini client
SECTION 10 — Markdown -> HTML formatting
```

---

## Spreadsheet tabs (created automatically by `setupSpreadsheet()`)

- **`Responses`** — your AppSheet-driven daily entries.
- **`User_Profile`** — key/value config: email, location, faith, goals,
  column markers, lookback windows, search toggles.
- **`User_Memory`** — append-only log of weekly/monthly/etc. reports.
- **`System_Docs`** — key/value where each value is a prompt template
  or persona. Edit report wording without touching code.
- **`Spiritual_Biography`** — append-only narrative chapters
  `(date, type, title, narrative, tags)`. Recent chapters are read back
  as memory each run, so future reports stay in conversation with the
  user's ongoing arc.

---

## Setup (new user, ~5 minutes)

1. **Create the spreadsheet.** Make a fresh Google Sheet.
2. **Open the script editor** (Extensions → Apps Script).
3. **Paste in the code.**
   - Replace the contents of the default `Code.gs` with the entire
     contents of `LifeOS.gs` (you may rename the file to `LifeOS.gs`
     for clarity).
   - In Project Settings, enable "Show appsscript.json manifest file
     in editor", then replace the manifest with the contents of
     `appsscript.json` from this repo.
4. **Reload the spreadsheet** so the new `Life OS` menu appears. From
   that menu, choose **Run setup**. Approve the OAuth prompts. This:
   - creates every required tab (`Dashboard`, `Responses`,
     `User_Profile`, `User_Memory`, `System_Docs`,
     `Spiritual_Biography`, `Habit_Library`),
   - seeds defaults (including a starter header row on `Responses`
     and a curated set of context columns and habits in
     `Habit_Library`),
   - registers an installable edit-trigger so the Dashboard buttons
     work,
   - moves you to the Dashboard tab, and
   - on the *first* run, offers to open the **profile editor** — a
     single-page HTML dialog with `<textarea>` fields, a timezone
     dropdown, and a stored-or-replace API-key field. You scroll
     through Identity / Life context / Spiritual context / Gemini
     API key and click Save once.

   The same dialog is your home for `User_Profile`. Re-open it any
   time from **Dashboard → "Edit profile"** or
   **Life OS → Edit profile…** — every field is repopulated with
   your saved value, blank fields are kept as-is, and a *"Loaded
   your saved profile"* banner makes it obvious that you're editing
   rather than starting fresh.
5. **(If you skipped the profile editor above)** Open it any time
   from **Dashboard → "Edit profile"** or
   **Life OS → Edit profile…**.
6. **(If you skipped the API key step)** Use **Dashboard → "Set
   Gemini API key"** or **Life OS → Set Gemini API key…** A prompt
   opens; paste your key. The key is stored in Script Properties
   (private to the script's owner) and is never written to source or
   to the spreadsheet.

   *Note:* the Apps Script editor's Run button cannot pass parameters,
   which is why `setApiKey` is wired to the menu/dashboard and falls
   back to a prompt dialog when called with no argument.
7. **Build your schema directly on the Dashboard.** Setup seeds the
   `Responses` tab with the bare minimum:

   ```
   ID, Date, Journal, >> HABITS >>, AI_Feedback_Log, Daily_Score
   ```

   The Dashboard now has an editable **Schema** region (Type | Name |
   Description). You shape your real habit list there, *not* by
   editing the `Responses` tab by hand.

   Two ways to add rows to the schema:

   - **Type them in.** Pick a Type (Context or Habit) from the
     dropdown, give the column a Name, and (optionally) a description.
     Phrase habits positively — *"Read 20 minutes"*, *"Cold shower"*,
     *"Two-drink maximum"* — so that marking "Success" is a good thing.
   - **Tick items on the `Habit_Library` tab** and click
     **Import selected from library** on the Dashboard. The library
     ships with ~40 curated context columns and habits across body,
     mind, finance, relationships, and the Christian / Orthodox
     spiritual rule. Library checkboxes reset after import.

   When the Schema region looks the way you want, click
   **Sync schema to Responses**. The script:

   - inserts new context columns to the LEFT of the `>> HABITS >>`
     spacer,
   - inserts new habit columns to the RIGHT of the spacer,
   - removes columns from `Responses` that you've removed from the
     Schema region (with a confirmation dialog before any deletion),
   - re-applies table formatting: frozen header, banded rows, a
     **Success / Fail / Exempt** dropdown on every habit column for
     the *entire sheet*, and a placeholder `Sample\nText` value in
     row 2 of any empty context column (the multi-line content makes
     AppSheet auto-detect the column as `LongText` rather than
     single-line `Text`), and
   - leaves protected columns (ID, Date, spacer, AI_Feedback_Log,
     Daily_Score) untouched.

   The placeholder is only written into rows that are otherwise
   completely empty, and it's coloured grey so it's easy to see and
   delete once you have real data flowing.

   Re-running setup preserves your Schema rows; nothing is lost.

   The Schema region is also kept in sync with `Responses` in two
   safety-belt ways:

   - On every setup run, if the Schema region is empty, it's
     auto-populated from whatever columns currently exist on
     `Responses` (with descriptions copied from the
     `Habit_Library` where names match).
   - **Dashboard → "Pull Responses into Schema"** rewrites the
     Schema region from `Responses` on demand. Use it any time the
     two get out of sync.
   - If you click **Sync schema to Responses** while the Schema
     region is empty *and* `Responses` already has columns, a
     three-option dialog catches it:
     - **YES** — refresh the Schema from Responses (recommended).
     - **NO** — cancel.
     - **CANCEL** — proceed with the deletion as typed. Protected
       columns (see below) are still preserved.
   - **Protected columns are never deleted by Sync**, regardless of
     whether they appear in the Schema region. The default protected
     list is `Journal` plus the structural markers (`ID`, `Date`, the
     spacer, `AI_Feedback_Log`, `Daily_Score`). To add your own,
     edit `protected_columns` in `User_Profile` (comma-separated).

   You can re-apply table formatting and validation any time from
   **Dashboard → "Reformat Responses table"**.

   Once your schema is settled, point AppSheet at the `Responses`
   sheet. Because the habit columns already carry value-in-list
   validation and the context columns carry multi-line sample text,
   AppSheet auto-detects them as `Enum (Success/Fail/Exempt)` and
   `LongText` respectively — no per-column re-typing in AppSheet's
   UI.
8. **Add time-based triggers** (Triggers tab in the editor) for the
   functions you want:
   - `runDailyAudit` — daily, late evening
   - `runWeeklyReport` — weekly
   - `runMonthlyReview` — monthly
   - `runAnnualReview` — yearly
   - `runSpiritualReport` — weekly is reasonable

Editing your goals later means changing one cell in `User_Profile`.
Editing the *wording* of a report means changing one cell in
`System_Docs`.

### The Dashboard tab

The first tab — `Dashboard` — is the home screen. It has two parts:

1. **Actions** — a list of one-line buttons backed by checkboxes.
   Tick the checkbox in column A and the matching action runs (the
   checkbox automatically resets afterwards). Available actions:

   - **Setup & identity:** Edit profile, Set Gemini API key, Re-run
     setup.
   - **Schema:** edit the on-sheet Schema region directly, then click
     **Sync schema to Responses**. **Pull Responses into Schema**
     refreshes the Schema region from whatever columns currently live
     on `Responses` (use this if the Schema gets cleared or out of
     sync). **Import selected from library** copies ticked rows from
     `Habit_Library` into the Schema. **Reformat Responses table**
     re-applies banding, frozen header, habit-column validation, and
     LongText sample seeding on demand.
   - **Manual report runs:** Run daily audit / weekly report /
     monthly review / annual review / spiritual report — useful for
     testing without waiting on a time-based trigger.
   - **Refresh dashboard status.**

2. **Status** — a live snapshot of email, timezone, location, faith,
   career, goals, whether an API key is stored, model name,
   `Responses` row count, latest daily score, biography chapter
   count, and the last `User_Memory` entry. Refreshes automatically
   every time the spreadsheet is opened or an action runs.

The Dashboard is wired to script actions via an installable
`onEdit` trigger that `setupSpreadsheet` registers for you. (Apps
Script's *simple* `onEdit` cannot send mail or call external APIs;
the installable trigger runs as you, the script's owner, with full
permissions.)

### The "Life OS" menu

Equivalent menu access for everything on the Dashboard:

- **Run setup** — `setupSpreadsheet`
- **Edit profile…** — `runProfileWizard` (alias `runInitWizard` is
  preserved for backward compatibility)
- **Set Gemini API key…** — opens a prompt
- **Refresh dashboard** — `refreshDashboard`
- **Run daily audit** / **weekly report** / **monthly review** /
  **annual review** / **spiritual report**

---

## What lives in `User_Profile`

| key | purpose |
|---|---|
| `email` | Where reports are sent. Required. |
| `model_name` | Gemini model (e.g. `gemini-2.5-pro`). |
| `timezone` | For dating biography entries. |
| `location`, `faith`, `career`, `goals` | Free text, injected into prompts. |
| `spiritual_context` | Free text. Your spiritual goals, situation, tradition, and rule of life. Appended verbatim to the spiritual report prompt as authoritative framing. Update whenever the situation shifts. |
| `col_spacer`, `col_end`, `col_score` | Column markers on the `Responses` sheet. |
| `spiritual_lookback_days` | Days to read for the spiritual review (default `14`). |
| `spiritual_bio_max_chars` | Cap on biography text fed back as memory (default `6000`). |
| `enable_search_daily` / `enable_search_weekly` / `enable_search_spiritual` | Toggle Google Search grounding per report. |

You can also add your own keys and reference them inside any prompt
template with `{{your_key}}` — the template engine resolves
placeholders against `User_Profile` automatically.

---

## What lives in `System_Docs`

Each row is `(key, value, description)`. The `value` column is the
prompt template the model sees. Edit the wording, the structure, or
the persona — no code change needed.

Default keys:

- `persona_strategic`, `persona_spiritual` — reusable persona blocks.
- `prompt_daily`, `prompt_weekly`, `prompt_monthly`, `prompt_annual` —
  one row per report type.
- `prompt_spiritual` — the spiritual review template. Emits two
  delimited sections (`===SPIRITUAL_REPORT===` and
  `===BIOGRAPHY_ENTRY===`) so one model call produces both the email
  and the biography chapter.
- `spiritual_column_semantics` — tells the model how to interpret your
  spiritual columns. Edit if your column conventions differ.

Placeholders supported in any template:

- `{{user_profile}}` — rendered profile block.
- `{{data}}` — the data context for this run.
- `{{memory}}` — previous report (daily/weekly/etc.).
- `{{prior_bio}}` — recent biography chapters (spiritual).
- `{{days_back}}` — lookback window.
- `{{persona_strategic}}`, `{{persona_spiritual}}`,
  `{{spiritual_column_semantics}}` — pulled from other rows in
  `System_Docs`.
- `{{any_user_profile_key}}` — pulled from `User_Profile`.

---

## Spiritual subsystem specifics

The spiritual subsystem reads the **entire daily log** — every habit
and every free-text context column over the lookback window — and
weighs the whole life as one life. There is no `Spirit_*` column
prefix or "spiritual columns" filter; the model is trusted to extract
the spiritual signal from the full log in conversation with two
sources of explicit framing:

1. **`spiritual_context` in `User_Profile`** — a free-text field where
   you describe your spiritual situation, goals, tradition, current
   rule of prayer/fasting, and what season you're in. The wizard
   surfaces it as a `<textarea>`. Update it whenever your situation
   shifts; the next spiritual report will pick up the change.
2. **The `Spiritual_Biography` tab** — append-only narrative chapters
   `(date, type, title, narrative, tags)`. The most recent chapters
   are concatenated and fed back into the next run as memory, capped
   at `spiritual_bio_max_chars` characters so the system scales as the
   biography grows.

If you want a different framing, edit `persona_spiritual`,
`spiritual_column_semantics`, or `prompt_spiritual` in `System_Docs`.
No code change required.

The `Habit_Library` tab ships with neutral, positively-phrased habits
(Morning prayer rule, Jesus Prayer, Kept the fast, Almsgiving, etc.)
and a `Spiritual_Life` context column for free-form spiritual
reflection. Use them or roll your own — there are no required column
names.
