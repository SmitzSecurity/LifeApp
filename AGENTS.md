# LifeApp project continuity

Canonical repository: https://github.com/SmitzSecurity/LifeApp. The owner authorized replacing the abandoned Apps Script repository contents with the current LifeApp on September 8, 2026. Preserve the existing repository identity; do not create another Site or repository.

This is the standalone React/Vinext/Cloudflare Worker/D1 product. Use Node 24, npm ci, npm test, and npx tsc --noEmit. npm run dev and npm run build use the standalone configuration and require no Sites helpers. Runtime output is dist-standalone. The root Sites binding was removed intentionally during migration; do not recreate it. The old private Sites app remains a separate live fallback until account/data cutover.

Read README.md, docs/migration-to-codex.md, docs/data-migration-preview.md, and the latest available LifeApp_Product_Build_Log.md (stable ID libfile_19df04a785a0819185c2b0a728b24c08). The log records the verified remote commit and owner setup state. Git-backed code belongs here, not in separate Library archives.

Google login requires owner OAuth credentials and its exact registered callback. Fail closed if Google mode is absent; never trust oai-* headers, merge by email, allow arbitrary scopes, or put credentials in code/output. Server Gemini credentials and paid-project flags still require owner setup. Preserve deterministic adopted-habit scoring, incomplete-day gates, reports/revisions, usage reservations/caps and duplicate prevention.

Use synthetic fixtures. Migration preview does not authorize import or prove ownership; authenticated old/new account proof, atomic import and count/history reconciliation are still required. Never erase the old app/data before cutover. Do not buy services, charge customers or submit a public store release without specific authorization. Retired Sites tests in legacy/sites are historical checks, not the standalone test gate.
