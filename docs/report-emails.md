# Full-report emails

Report emails are separate from both profile preferences and automatic AI analysis. Migration `0007_report_email.sql` adds consent and delivery state, plus completion, opt-out and account-deletion triggers. It never changes old reports or enables anyone. Do not rerun migrations 0000–0006.

The `full-report-v1` consent requires a verified, Google-linked private beta account, a same-origin JSON request and the current consent version. It applies to reports completed after acceptance, including requested revisions. The recipient must still match the verified account at dispatch. The legacy `emailEnabled` preference is historical intent only. No existing reports are backfilled.

Every five-minute Cron tick can send two queued reports through the native `REPORT_EMAILS` binding. Email delivery works independently of AI activation and does not generate another report or reserve AI usage. When enabled, planner discovery is limited to ten profiles per tick to leave D1 query headroom. Claims and the consent recheck are atomic; overlapping ticks cannot send the same pending message.

The approved sender is `reports@lifeapp.smitzgroup.com`, restricted in `config/report-email.json`. For the free private beta, enable Email Routing on `lifeapp.smitzgroup.com` and verify each beta recipient as a Cloudflare destination address. Cloudflare documents free sending to those addresses even when only Email Routing is configured. General delivery to arbitrary recipients requires a separately authorized Workers Paid plan and Email Sending onboarding. See [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

After checking the sender domain and recipient verification, set runtime variables `LIFEAPP_EMAIL_FROM=reports@lifeapp.smitzgroup.com` and `LIFEAPP_EMAIL_ENABLED=true`. Existing auth URL and beta allowlist are reused. Keep the flag absent or false until configuration succeeds. Native delivery requires no API key in application code. Generate binding types with `npm run types:email`. New beta recipients need Cloudflare destination verification before receiving emails on the free plan.

An accepted message ID confirms service acceptance, not inbox delivery. Explicit pre-delivery rate/quota rejections retry at most five times with backoff. Unknown responses and claims left sending for ten minutes become unconfirmed and are never automatically resent. An opt-out cancels pending/retry jobs; already in-flight mail may arrive. The UI reports these distinctions.

Emails contain the full saved report as escaped HTML and plain text. They link to the saved date, which still requires normal sign-in. A random unsubscribe capability can only turn delivery off: GET shows a confirmation, POST performs the opt-out and also supports one-click email clients. Account deletion removes consent and delivery rows and prevents stale recreation. Already delivered inbox copies are outside LifeApp.

Private backup v1 now optionally includes email consent evidence and delivery history; tokens and authentication secrets are excluded. Older backups still validate. A backup never authorizes import or re-enables consent; importing remains unimplemented.

Validation: `npm test`, `npx tsc --noEmit`, Cloudflare build/dry-run and synthetic browser checks. Do not send real test emails, change a live account's consent, or test account deletion without that specific user action/authorization.
