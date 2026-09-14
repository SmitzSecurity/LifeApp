# Responses and owner prototype limits

September 14, 2026. Responses opens today's form above saved history. An existing entry for today is continued rather than duplicated. The embedded editor scrolls within a bounded area so history remains reachable; Save and Cancel stay with that form. Historic entries retain their focused analysis-first editor. Saving there returns to today's form. Search/pagination and unsaved navigation protection remain. Per-row edit/trash icons are adjacent; Delete requires confirmation, preserves unrelated drafts, updates the open day when necessary, and uses the existing seven-day Trash mechanism.

Saved responses now use a compact, independently scrollable panel around 20% of the viewport height (144–240px), with 60px rows and 44px edit/delete targets. Opening Search temporarily gives the panel more room for its filters; closing Search returns to the compact height. Pagination and confirmation dialogs remain available.

Journal Dictate uses the browser's speech service, starts only on a button click, and appends final transcripts to the existing text. Stop ends recording before Save; the journal and date cannot change during recording. Cancel, navigation and unmount abort recording and ignore queued speech callbacks. Permission denial and the 6,000-character limit preserve existing text. Unsupported browsers show a disabled Dictate button and suggest the keyboard microphone. Speech availability and microphone permissions depend on the browser; this feature does not call Gemini or consume LifeApp AI credits.

Repeatable browser verification: `node scripts/browser-smoke.mjs --calm --editing --analysis --history --dictation` serves a synthetic speech implementation and visible controls from the loopback-only fixture. No real microphone, production data or provider access is involved. Verify append/final-only handling, Save, Cancel/late results, switching entries, denial, length limits and unsupported fallback. Close the synthetic control panel before clicking underlying form buttons.

Settings uses a native timezone dropdown populated from the browser's IANA timezone list, with UTC, common fallbacks and the exact saved zone retained. Device timezone remains the automatic default. Manual choices are versioned with the profile and Cancel restores the saved selection. No timezone, consent or schedule is changed by installing this release.

## Temporary owner allowance

The operator can configure two private Worker runtime bindings: `LIFEAPP_AI_OWNER_USER_ID` (an existing opaque `google:` account ID) and `LIFEAPP_AI_OWNER_LIMITS_UNTIL` (an ISO UTC timestamp ending in `.000Z`). Resolve the ID against the existing verified Google account; never identify the owner by a client-supplied email or role, embed their email/ID in source, or link/merge accounts. Missing, malformed, non-Google or expired configuration grants no override.

Until expiry, only that account has 25 total AI attempts per UTC day, 10 attempts per builder purpose per UTC day, five regenerations per analysis period per UTC day, and a $5 account monthly cap. Everyone else retains 5 total, 2 per builder, 2 regenerations and $1 per month. The app-wide $5 monthly cap and $0.20 reservations remain unchanged. Automatic and manual analyses resolve the same account limits. Deleted/archived usage still counts, unknown outcomes retain holds, duplicate requests do not run again, and the cost circuit breaker is unchanged. This grants no automatic-analysis or email consent and purchases no provider credits.

The initial private override expires October 14, 2026 at 23:59:59 UTC. At expiry it falls back to standard limits without clearing any usage; an account already above the normal allowance waits for the relevant reset. Removing either binding disables the override immediately. Keep these runtime values out of generated configuration and public Git history.

## Launch reminder

Before the owner opens registration or enables customer payments, review and remove or deliberately replace the prototype override. Confirm the customer allowance, shared spending cap, payment enforcement and scheduled-analysis headroom against real usage. Recheck Gemini pricing before January 1, 2027; the existing pricing-expiry gate remains. Do not charge users or buy services as part of this release.

## Verification

208 tests pass (196 source + 12 compiled Worker). New tests exercise exact owner identity, invalid configuration, expiry, daily/build/regeneration limits, archived accounting, other-account isolation, global spending and the circuit breaker. Existing tests retain unknown-outcome and exact-retry coverage. Browser checks use synthetic local D1 with external AI mocked: new inline Save, historical Save, cancellation, confirmation, preserving another day's unsaved draft, dirty navigation, timezone Save/Cancel/persistence, 390px mobile and desktop layout. Production checks are read-only; activating the private owner binding is the only runtime change. No migration is required and 0000–0010 must not be repeated.
