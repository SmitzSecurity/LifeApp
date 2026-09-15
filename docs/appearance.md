# Appearance and dialog cancellation

September 14, 2026. Settings → Appearance offers OLED black (default) and light blue. Each theme has 30 independent color roles covering surfaces, text, controls, status, charts and muscle coverage. Colors accept a picker or six-digit hex input. Group buttons keep the editor compact. Switching themes retains each custom palette; Reset clears only the selected theme's overrides.

Preview is local until Save Settings. Cancel changes returns to the saved profile. The optional `appearance` profile JSON field uses existing account/version conflict checks and portable exports; no migration or change to analysis consent. A validated browser cache applies saved colors before paint, then the loaded account profile takes precedence. Cache failure falls back to OLED. The editor uses the chosen base palette so low-contrast custom values do not hide its recovery controls.

Default text and control contrast is tested against [WCAG 2.2](https://www.w3.org/TR/WCAG22/): 4.5:1 for ordinary text and 3:1 for input outlines/focus indicators. Custom combinations receive contrast feedback, not an accessibility certification. The white/blue palette is a design choice. [Palmer & Schloss (2010)](https://pmc.ncbi.nlm.nih.gov/articles/2889342/) explains color preference through associations and experience; it does not establish a universally best app color. Semantic status colors also have text labels. Muscle colors express estimated set ranges, with numbers available independently.

The September 15 update embeds all checks inside Customize colors and relevant checks beneath each color picker. Passing checks remain visible as Preferred; repairing a failing color does not close or remove the checks. The adjacent live preview includes actual muscle-map and habit controls plus sample scores, allowances, trends, timer, surfaces and status messages. It uses example data and the draft theme while editing/recovery controls retain the readable base palette. See docs/category-editor-and-previews.md.

All active page CSS, native fields, portaled menus/dialogs and SVG muscle regions inherit semantic tokens. Legacy unused calm.css is historical. Adding a new visible component must not introduce a fixed light/dark palette. The default root CSS must match the TypeScript OLED preset; bootstrap runs self-contained from compiled HTML and never interpolates arbitrary CSS or cached script.

## Dialog behavior

X, Escape and Cancel use the same discard action for programs, written notes, cardio and routine-builder inputs. Budget recurring-item, category-order and goal dialogs likewise discard unsaved changes when closed. Closing does not delete saved history or cancel a committed request. In-flight and unconfirmed writes remain protected so an exact retry can reconcile their outcome. Dictation callbacks are cleared before aborting, preventing a late transcript from repopulating a discarded draft. Saved workout sessions continue unaffected.

## Verification

Synthetic account tests cover optional legacy profiles, account-scoped save/read/export, version conflicts, invalid values, no AI or consent side effects, per-mode overrides, default contrast, and pre-paint bootstrap validation. The compiled Worker suite executes the actual HTML bootstrap. Browser regression checks cover program A → X → program B, original program restored on reopening, notes/cardio cancellation, theme save/reload, custom colors and mobile layouts. Production verification is read-only.
