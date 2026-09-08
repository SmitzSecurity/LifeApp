# Daily AI reviews: implementation and activation

**Standalone migration update:** `docs/migration-to-codex.md` now supplies a direct Cloudflare hosting path and hidden Wrangler secret entry. Fresh Google credentials are still required; no provider is activated yet. Follow that guide for the owner-controlled host rather than the earlier Sites-only activation path below.

Status, September 8, 2026: the server integration and manual review UI are implemented and tested with synthetic provider responses. No real provider call has been made. The existing Site has no configured environment variables. Do not describe AI as activated until a fresh owner-controlled key is configured and a synthetic live request succeeds.

## Delivered behavior

- A signed-in user selects a date, finishes and syncs its check-in, explicitly consents to sending the saved context, then requests a review.
- The server verifies ownership, completion, current entry revision, pricing validity and admission limits before calling Gemini. It supplies saved goals, feedback preferences and relevant enabled section evidence. It never changes deterministic habit scores.
- The initial report has one stable account/date request key. Concurrent clicks and ambiguous retries reuse its saved status. Critique-driven revisions link to the latest completed report and preserve the original, its source version and exact context snapshot.
- A single SQL insert atomically reserves provider usage, enforces uniqueness and checks account/site monthly limits. Reports, token counts, model version, request identity and measured micro-USD cost persist together. No customer is billed.
- Unknown provider/storage outcomes retain their reservation and do not retry automatically. An incomplete response records measured usage but is not presented as a completed report. Failed/uncertain attempts currently need operator reconciliation before another attempt for that day; a reconciliation UI is still needed.

## Owner-only activation

1. Create a fresh restricted Gemini API key in a Google project with paid-tier data handling. Do not use the legacy script key or commit a replacement. Billing/project creation remains the owner's action; this run did not buy service or enable billing.
2. Set `GEMINI_API_KEY` as a **secret**, plus `LIFEAPP_AI_PAID_PROJECT=true` and `LIFEAPP_AI_ENABLED=true` as server runtime environment values for the existing LifeApp Site. Never use a `NEXT_PUBLIC_`/`VITE_` key. Never ask customers for their own key. The connected Sites environment tool supports secret values, but no secure owner key-entry portal was exposed in this session; do not invent a portal or ask for a key in a public artifact.
3. Publish the tested existing project, then verify one synthetic completed-day request, persisted output and reported token usage. Repeat the identical request to verify it does not spend again; inspect another account's isolation before inviting external users. Do not use the owner's journal for this smoke test.
4. Confirm provider dashboard usage against the ledger before treating costs as reconciled. Disable new calls with `LIFEAPP_AI_ENABLED=false` if needed. Do not release unknown reservations without checking provider usage.

Initial private beta admission limits: $1/account/month, $5/site/month, five attempts/account/UTC day, $0.20 reserved per request; at most 48,000 UTF-8 input bytes (including system rules), one candidate and 4,096 output tokens. These are operator-funded beta safeguards, not subscription prices or customer entitlements. Month windows are UTC. Unknown outcomes count at reserved cost. A cost above the reservation trips a site-wide circuit breaker; the reservation is conservative rather than a contractual guarantee of the provider's final invoice. Keep provider-side quota controls and reconcile before paid launch. Context limits reject oversized requests rather than silently truncate them.

The model is `gemini-3.8-flash` through the official `generateContent` REST endpoint, with server-only key headers and no SDK dependency, tools, grounding/search or automatic retries. The versioned standard tariff checked September 8 is $0.75 per million input tokens and $3.75 per million output tokens, including thinking. The code conservatively counts generated thinking and text and assumes no cache discounts. Current tariff expires January 1, 2027, when new generation stops pending a price update. [Official Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

Paid Gemini API usage is marked as not used to improve Google's products, while free-tier usage is marked as used. This is why activation requires the owner to confirm a paid project before processing private journals; it is not a claim of zero retention. [Official data-use/pricing table](https://ai.google.dev/gemini-api/docs/pricing).

The adapter uses Google's documented usage metadata and output controls. Tests cover API serialization, secret placement, thinking costs, failures and no retries using a fake network response; they do not certify provider availability, account eligibility or real response quality. [GenerateContent reference](https://ai.google.dev/api/generate-content), [model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).

## Remaining product work

This increment generates one chosen completed day's review. It does not yet generate daily reports automatically, release held scheduled jobs after late completion, email reports/reminders, search local events, generate weekly/monthly/annual reviews, build persistent AI profile memory or write a biography. Saved scheduling preferences remain inactive. Next implement durable scheduled jobs and delivery outbox reusing this report/usage ledger, and add reconciliation plus account export/deletion before external beta. No trial, payment or store billing is active.

Verification completed for this increment: production build and TypeScript check succeeded; all 35 synthetic source/SQLite/compiled Worker tests passed. No browser, real Gemini response, Google sign-in, email, charge or store-release test was performed.
