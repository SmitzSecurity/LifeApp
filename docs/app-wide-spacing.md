# App-wide spacing

September 15, 2026. The owner requests consistent, less oversized UI across Home, Responses, Budget, Workouts, Settings and dialogs. Dedicated scoped density styles override older page styles without changing page state, data, wording or available actions. `ui-density.css` defines the shared rhythm and Home/Responses; `budget-density.css`, `workout-density.css` and `settings-density.css` cover their surfaces.

Use 14px body text, 13px labels/actions and 12px supporting text, with 16–18px headings and 16px editable input text. Reduce card padding, excess margins and chart heights rather than scaling the page or disabling zoom. Primary touch targets remain at least 44px. Keep semantic color variables, subgrid field alignment, independently scrolling editor bodies, equal action pairs, microphone placement and the confirmed 64px shell navigation. Report Markdown uses UI-only size overrides; shared email rendering is unchanged.

The owner explicitly requires review before removing unnecessary elements. Proposed removals are labeled R1–R5 in [the review list](ui-simplification-review.md); all remain implemented and visible. Do not hide labels or disable accessibility state as a spacing shortcut. No migrations, runtime flags, AI requests or live data changes are required.

Verify synthetic light and OLED fixtures at 320px/390px and desktop, active workout/rest states, empty and populated analyses, Budget category/recurring/goals/build dialogs, Settings previews and confirmation dialogs, journal growth/fixed actions, no overflow and no console errors. Compare dimensions against the pre-change synthetic fixture. Desktop viewport checks do not reproduce physical Firefox Android toolbar behavior; preserve the existing viewport logic.
