# Structured modules — saved implementation, September 8, 2026

The existing Vinext/React/Cloudflare D1 project is retained. Migration `0001_adorable_scream.sql` adds account-partitioned, versioned section records; it does not rewrite profiles or journal data. An account/kind/id primary key prevents duplicate resource records, and a partial unique index enforces one active workout per account. Inputs are validated and saves use optimistic version checks.

## Habits and goals

36 standard habits are selectable across the six modules; custom habits and archiving remain. Nothing is adopted by AI automatically. Profile defaults allow version-1 accounts to load new goal and review settings without a destructive migration. The device timezone is detected on opening LifeApp; an override lives under Advanced settings. Historical entry dates remain unchanged.

## Budget

Amounts are integer USD cents. Each month has a saved plan with category allowances, recurring payments/income, due days and separate spending/saving/investing goals. A new month carries forward the latest earlier plan into a draft for confirmation; it is not automatically committed by a cron. Monthly schedules are forecasts, not bank transfers or automatically recorded transactions.

Log expenses, income or movements to savings/investments, with date, amount, category and description. Category allowance remaining subtracts actual expenses only. The UI separately shows scheduled outstanding payments and allowance after them. Scheduled occurrence IDs are deterministic per account/month/item. Voiding and restoring an occurrence keeps one record. Cash flow is recorded income minus recorded expenses and savings/investment transfers; it is not a bank balance or net worth.

Saved categories and schedule IDs are retained for referential history. Amounts/names/limits are editable; scheduled items can be disabled for the month. Transactions can be corrected or voided. A correction cannot move a record to another month. Category choice is manual; automatic AI classification and financial advice are not connected. Currency conversion, refunds, account balances, bank sync and nonmonthly recurrence remain out of scope for this increment. Do not treat these totals as accounting software.

All monthly transactions are fetched before showing totals; the beta returns an explicit error over 5,000 rather than a partial balance. Budget/routine configuration listings are bounded at 120, workout history at 100 including the current workout. Pagination/export will be needed before general release.

## Workouts

Create multiple routines/splits with goals (in profile), preferences/equipment notes, exercises, sets, target reps, starting load, kg/lb and rest seconds. A standard exercise dropdown and custom names are available. A session snapshots its routine so later edits do not rewrite history. The active screen shows exercise/set, actual reps/load, set corrections and completion. Partial workouts can be finished; missing sets do not affect adopted-habit scores.

Saving a set persists an absolute rest deadline with the session. A lost-response retry reuses the same pending save. The countdown computes from wall-clock time and refreshes when the page becomes visible. Visible-page vibration is optional and feature-detected, with an immediate test pulse when enabled. Physical haptics are not guaranteed: the browser can refuse them or lack hardware; locked-screen alerts require a native notification implementation and device verification.

Recent sessions show recorded sets/reps and per-exercise load volume; an active session shows previous matching exercise results with their original units. These are deterministic summaries, not AI training guidance. Routine planning AI and personalized progression reports are pending.

Official implementation reference checked September 8, 2026: [W3C Vibration API](https://www.w3.org/TR/vibration/) documents visible-page and activation requirements, Chromium implementation and WebKit opposition. [MDN Navigator.vibrate](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate) documents limited availability. No browser or physical-device interaction test was performed during this increment.
