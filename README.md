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

The script's only home for *you-specific* configuration is the spreadsheet
itself. Code is generic. Move, change careers, refocus your goals — you
edit cells in `User_Profile`, not source files.

---

## Secrets

The Gemini API key is **never** stored in source or in the spreadsheet.
It lives in Apps Script's Script Properties, which is private to the
script's owner. See the setup steps below for how to set it once with
`setApiKey()`.

---

## Architecture

```
Spreadsheet (the configurable surface)
├── Responses              — daily entries (driven by AppSheet)
├── User_Profile           — key/value: email, location, faith, goals,
│                            column markers, lookback windows, toggles
├── User_Memory            — append-only log of weekly/monthly/etc reports
├── System_Docs            — key/value: prompt templates and personas
└── Spiritual_Biography    — append-only narrative chapters

Apps Script (the engine)
├── appsscript.json        — OAuth scopes
├── Config.gs              — readers for User_Profile / System_Docs
├── Setup.gs               — setupSpreadsheet(), setApiKey()
├── Gemini.gs              — single Gemini call site
├── Prompts.gs             — template substitution
├── Format.gs              — Markdown -> HTML and plain-text helpers
├── Reports.gs             — daily/weekly/monthly/annual processors
└── Spiritual.gs           — spiritual analysis + biography append
```

---

## Setup (new user, 10 minutes)

1. **Copy the spreadsheet.** Make a fresh Google Sheet.
2. **Open the script editor** (Extensions → Apps Script).
3. **Copy each `.gs` file** from `src/` into the editor as a separate
   script file with the same name. Replace the contents of
   `appsscript.json` (you may need to enable showing the manifest in
   Project Settings).
4. **Run `setupSpreadsheet`** once from the editor. Approve the OAuth
   prompts. This creates every required tab and seeds defaults.
5. **Fill in `User_Profile`** — at minimum, `email`. Optional fields
   shape the prompts: `location`, `faith`, `career`, `goals`, etc.
6. **Set the API key once** — in the editor, run:

   ```
   setApiKey('YOUR_NEW_GEMINI_KEY')
   ```

   The key is stored in Script Properties. Don't paste it in any cell
   or any file.
7. **Configure the `Responses` sheet.** This is the one place that
   needs a column convention. Headers must include:
   - A column named whatever you set as `col_spacer` in `User_Profile`
     (default `>> HABITS >>`). Free-text columns go to its left;
     binary habit columns go to its right.
   - A column named whatever you set as `col_end` (default
     `AI_Feedback_Log`). The daily report writes here.
   - A column named whatever you set as `col_score` (default
     `Daily_Score`). The numeric daily score is written here.
   - A `Date` column.
   - Use AppSheet to enter data — habits should be Success / Fail /
     Exempt (or TRUE / FALSE).
8. **Add time-based triggers** (Triggers tab in the editor) for the
   functions you want:
   - `runDailyAudit` — daily, late evening
   - `runWeeklyReport` — weekly
   - `runMonthlyReview` — monthly
   - `runAnnualReview` — yearly
   - `runSpiritualReport` — weekly is reasonable

That's it. Editing your goals later means changing one cell in
`User_Profile`. Editing the *wording* of a report means changing one
cell in `System_Docs`.

---

## What lives in `User_Profile`

| key | purpose |
|---|---|
| `email` | Where reports are sent. Required. |
| `model_name` | Gemini model (e.g. `gemini-2.5-pro`). |
| `timezone` | For dating biography entries. |
| `location`, `faith`, `career`, `goals` | Free text, injected into prompts. |
| `col_spacer`, `col_end`, `col_score` | Column markers on the `Responses` sheet. |
| `spiritual_col_prefix` | Header prefix that flags a spiritual column (default `Spirit_`). |
| `spiritual_columns_explicit` | Comma-separated extra spiritual columns (default `Journal`). |
| `spiritual_lookback_days` | Days to read for the spiritual review (default `14`). |
| `spiritual_bio_max_chars` | Cap on biography text fed back as memory (default `6000`). |
| `enable_search_daily` / `enable_search_weekly` / `enable_search_spiritual` | Toggle Google Search grounding per report. |

You can also add your own keys and reference them inside any prompt
template with `{{your_key}}` — `Prompts.gs` will resolve placeholders
against `User_Profile` automatically.

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
  spiritual columns. Edit if your column conventions differ from the
  defaults.

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

The spiritual subsystem analyzes only the columns flagged as spiritual
and grows a long-running narrative biography on the
`Spiritual_Biography` tab. Each row is
`(date, type, title, narrative, tags)`. The most recent rows are
concatenated and fed back into the next run as memory, capped at
`spiritual_bio_max_chars` characters so the system scales as the
biography grows.

Recommended spiritual column naming on `Responses` (binary trackers):

`Spirit_Fasted`, `Spirit_Prostrations`, `Spirit_JesusPrayer`,
`Spirit_MorningRite`, `Spirit_EveningRite`, `Spirit_ServiceCharity`,
`Spirit_AvoidedDigitalBypass`, `Spirit_AvoidedJudgement`,
`Spirit_IgnoredLustfulThoughts`, `Spirit_AvoidedLust`,
`Spirit_AvoidedLustfulGazing`, `Spirit_AvoidedMediaBinge`,
`Spirit_AvoidedCriticism`, `Spirit_AvoidedGluttony`,
`Spirit_TwoDrinkMax`, `Spirit_AvoidedCrudeJokes`.

Free-text spiritual columns:

- `Spirit_Life` — saints' lives, gospel readings, parish events,
  notable spiritual moments.
- `Journal` — internal dispositions; left un-prefixed so the daily
  audit still uses it, and added to `spiritual_columns_explicit` so
  the spiritual subsystem reads it too.

If your tradition or column conventions differ, change
`spiritual_col_prefix` / `spiritual_columns_explicit` in
`User_Profile` and edit `spiritual_column_semantics` and
`persona_spiritual` in `System_Docs`. No code change required.
