# LifeApp: moving beyond Sites

September 8, 2026. The owner requested a normal code project, Google Account login and help setting up AI credentials. This document is the handoff for the same LifeApp, not a new product or competing codebase.

## Current GitHub handoff

September 9 follow-up: durable daily schedule/reminder intents and live
late-completion eligibility are now implemented; see `daily-scheduling.md`.
The standalone gate passes 56 tests. No Cron, automatic AI consumer, email sender,
owner credentials or external deployment was activated. The older checkpoint
counts and unavailable-GitHub notes below are historical, not current blockers.

GitHub account SmitzSecurity and existing repository SmitzSecurity/LifeApp are verified. Its prior main commit is 5a2a1b7fd888443cf6b6d517a5f122f52dbcd011 (April 29, 2026, 13 legacy commits). The owner explicitly authorized overwriting that abandoned attempt with the current app. Use the existing repository; do not create a competing LifeApp repository. Its current visibility is public. This transfer changes source code, not the deployed app or its access controls.

Verification for this handoff: the normal `npm test` command passed all 46 standalone tests (43 source/service tests and 3 compiled Worker tests); TypeScript passed. The five retired Sites-only tests remain in `legacy/sites/` for historical reference. No real Google sign-in, AI request, hosting deployment or data import was performed.

Normal npm dev/build/test commands now run standalone without Sites helpers; the root Sites binding was removed intentionally. Legacy Apps Script files remain recoverable in GitHub history. The prior Sites source checkpoint is a04529766cd665b931498ddfc8bdb5223d49bee2. The continuing build log records the exact verified new GitHub commit after transfer. Google/AI credentials, Cloudflare deployment and data cutover remain pending.

The GitHub connector is now callable for profile/repository reads and file/tree/commit writes. The prior CLI device process ended without a retained CLI login; do not mistake the user's completed browser step for a verified CLI session. Use the connected repository tools for this authorized content replacement. Do not keep asking the owner to reconnect.

## Earlier setup notes (superseded where the current handoff differs)

GitHub is confirmed connected and installed. Repository operations did not appear in the active workspace after connection, so no GitHub repository has been created or transferred yet. The next run should use the connected GitHub plugin to discover the owner and create or reuse a **private** LifeApp repository, transfer this existing Git history, verify the pushed commit and record the new canonical repository in the continuing build log. Do not ask Abraham to reconnect, upload files one at a time or start a new scaffold. If the capability still is not exposed, report that exact runtime limitation; never invent a repository URL or claim the transfer succeeded.

A working alternate route is now prepared: direct GitHub API/release access succeeded, and the official GitHub CLI 2.100.0 was installed at `/workspace/tools/gh-2.100.0/bin/gh`, after verifying its published SHA-256. `gh auth status` confirmed this CLI has no signed-in account; the connected ChatGPT plugin does not automatically sign the CLI in. The agent can initiate the official browser/device login and give the owner GitHub's one-time code and returned verification URL. The owner enters the code on GitHub and approves GitHub CLI there; do not request a password, API token or recovery code in chat. Start login only when ready to continue, because the device code expires. [Official GitHub CLI login](https://cli.github.com/manual/gh_auth_login).

After successful login, use `gh api user` to resolve the owner, inspect owned repositories for the existing LifeApp project, then use the private creation/existing-repository path and transfer the existing commits. Never force-push an unrelated repository or overwrite an initialized remote. Verify visibility and remote HEAD before changing the canonical pointer. [Official repository creation](https://cli.github.com/manual/gh_repo_create). No CLI sign-in, repository creation or transfer is claimed at this checkpoint.

Codex is the development environment. The running app still needs a hosting account, an identity provider configuration and server secrets. Cloudflare Workers/D1 is the selected migration target because it reuses the existing Worker and SQLite code. Development can continue from the same repository in Codex or another local coding environment. Current OpenAI documentation describes [Windows desktop project/Git workflows](https://learn.chatgpt.com/docs/windows/windows-app); it does not turn a coding workspace into production app hosting. Windows version eligibility should be checked before recommending a particular desktop installer.

## Prepared in this repository

- `vite.standalone.config.ts`, `wrangler.standalone.json` and `worker/standalone.ts`: direct Cloudflare build, independent of the Sites dispatch service. The standalone Worker rejects missing Google mode and strips caller-supplied Sites/proxy identity headers.
- `lib/auth/`: Better Auth 1.7.3 using its minimal initializer and explicit Drizzle/D1 adapter; Google authorization code flow with PKCE, persisted state, ID-token signature/issuer/audience/expiry validation, secure HTTP-only sessions, logout, encrypted OAuth access/refresh tokens and server-enforced beta allowlist. Initial scopes are openid/profile/email. Email is not the journal owner ID and matching emails do not link accounts automatically.
- `/sign-in` and `/sign-out`: real routes, activated only in standalone Google mode. `/api/auth` exposes only the code-flow/session/logout routes, blocks arbitrary scopes/direct token login/account linking, and enforces same-origin POSTs.
- `drizzle/0003_fancy_dreadnoughts.sql`: additive authentication/session/state/rate-limit tables. Current profiles, entries, module resources and AI ledger remain intact.
- `scripts/standalone.mjs`: cross-platform local setup, configuration checks, build, development, migrations, guarded deployment and hidden Wrangler secret entry. No Sites helper path is required for standalone commands.
- Private account export at `/api/life?export=1`, linked in My setup. It exports saved profile, entries, section resources and report/usage records, excludes auth credentials and other users, and rejects oversized exports rather than silently truncating them. This endpoint is prepared in the new source; it is not present in the unchanged live Sites version 3.

The existing Sites deployment continues using its existing authentication mode. Google auth does not use or replace the platform's reserved callback routes. The standalone target has not been deployed to a real Cloudflare account, and no current journal data has been moved. A strict local backup validator and destination comparison are now implemented; see `data-migration-preview.md`. Authenticated ownership proof and the actual atomic import remain necessary before cutover.

The owner's subsequent request with GitHub selected was checked: the plugin remains installed/enabled, but repository operations are still absent from this workspace. Starting another request did not resolve the limitation. Do not repeatedly ask the owner to reconnect or start another chat; preserve completed work in the canonical repository and report the missing capability accurately.

## Guided setup order

The agent handles commands, configuration and verification; Abraham handles account sign-in, consent and billing approval. Show one account screen at a time, explain the fields on that screen and wait only when the owner must act. Do not give him the entire command sequence as his first task.

1. **GitHub — complete:** use the existing public `SmitzSecurity/LifeApp` repository, whose abandoned files the owner explicitly authorized replacing. Repository tools are connected and working; no new repository or login flow is needed.
2. **Cloudflare:** use an owner-controlled account. Cloudflare management is not connected here; do not claim an account, Worker or database was provisioned. After authenticated access is available, use `wrangler login`/authorized connector and create the `lifeapp` D1 database once, retaining its returned ID. Determine the actual workers.dev or custom HTTPS origin before registering Google production redirects. Do not guess a workers.dev address. Billing upgrades are owner decisions.
3. **Google project:** open [Google Cloud Console](https://console.cloud.google.com/), create/reuse an owner-controlled LifeApp project, configure its consent screen for testing, and add the owner's Google account as a test user. Create a **Web application** OAuth client. Use only the exact callback values shown below. Keep the client secret private. [Google web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).
4. **Gemini:** open [Google AI Studio's key page](https://aistudio.google.com/api-keys), select/import the same project and create a fresh authorization key. Google currently defaults new AI Studio keys to auth keys and documents the September 2026 standard-key transition. Do not use the exposed legacy key. Confirm paid-project data handling before sending private journals; the owner enables billing, if needed. [Current Gemini key instructions](https://ai.google.dev/gemini-api/docs/api-key).
5. **Secure configuration:** enter values through the local private settings file or the hidden Wrangler secret prompt. Never paste credentials in chat, commits, screenshots, URLs or client code. The key is managed by LifeApp; future customers only sign in.
6. **Verify, then migrate data:** use synthetic accounts for a real Google sign-in, logout and one AI report. Reconcile reported token costs and repeat the exact generation request to prove duplicate protection. Verify one account cannot see another. Export the old authenticated account, prepare a dry-run import into the authenticated Google account, compare counts/versions/history and only then switch the primary app URL. Never merge accounts by email. Keep the old app available until the owner verifies the new one.

## Commands for Codex/the implementation agent

Use Node 24 LTS for the synthetic test suite (`node:sqlite` and TypeScript stripping). The standalone app scripts use Node and work without Bash/GNU timeout. Preserve `package-lock.json`. `npm test` builds and tests the standalone target without Sites-specific helper scripts. `npm run test:sites` is an optional compatibility check that requires the Sites runtime.

```sh
npm ci
npm run standalone -- init-local
npm run standalone -- doctor
npm run standalone -- migrate-local
npm run dev:standalone
```

`init-local` creates `.dev.vars` with a random session secret and empty provider settings; it refuses to overwrite an existing file. Open that ignored file privately to add the Google client and the beta email. Use **http://localhost:3000** in the browser; the corresponding Google callback is **http://localhost:3000/api/auth/callback/google**.

After Cloudflare returns the actual database ID and origin, use `configure` with `--url`, `--database-id` and `--email`. It writes the ignored `wrangler.standalone.local.json` and prints the exact Google callback URI. It never accepts an API key. Add the resulting HTTPS callback to the same Google OAuth client before testing production login. [Better Auth's Google setup](https://better-auth.com/docs/authentication/google).

```sh
npm run build:standalone
npm run standalone -- migrate-remote
npm run standalone -- deploy
```

Remote migrations/deployment refuse the local placeholder database and a missing production origin/allowlist. A build with stale configuration also cannot deploy. The build is written to `dist-standalone/`; existing Sites uses its separate normal build/package workflow. Do not send the standalone archive to Sites.

After a Worker is provisioned, use each supported secret name with `npm run standalone -- secret NAME`. Wrangler prompts for the value; the value must never be a command argument. Names: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `LIFEAPP_AI_PAID_PROJECT`, `LIFEAPP_AI_ENABLED`. Set the final two to `true` only after the paid-project and live-test prerequisites are met; absent flags disable AI. The flags are not duplicated in Wrangler vars. [Cloudflare secret handling](https://developers.cloudflare.com/workers/configuration/secrets/).

`doctor` checks local presence only; it does not claim to inspect remote secrets or validate a key. Setting secrets may publish a new Worker version, so perform it only for the intended owner deployment. Never run a remote mutation merely as a credentials check.

## Verification checkpoint

September 8, 2026: standalone production build, existing Sites compatibility build and TypeScript check passed. All 43 automated tests passed with synthetic data, including actual D1-backed Google state/session handling, signed Google-token validation and rejection cases, replay/logout, forged identity rejection, private export isolation and existing check-in/AI cost gates. No real Google account login, provider call, external deployment or data import was performed.

Follow-up checkpoint: eight migration preview tests now pass, and the complete suite passes **51 tests**. Both builds and TypeScript passed again. See `data-migration-preview.md` for the new verified behavior and remaining ownership/import boundary.

## Costs and boundaries

Cloudflare has free allowances; paid Workers starts with a $5 monthly subscription plus overages. D1 is available on free and paid plans. This does not guarantee LifeApp fits free CPU limits; measure OAuth and real workloads before selecting a paid plan. No plan was purchased here. [Official Workers/D1 pricing](https://developers.cloudflare.com/workers/platform/pricing/).

The existing AI safeguards remain: owner-funded capped beta usage, no customer charges, completed-entry gate, preserved reports/revisions and no automatic retry of unknown provider outcomes. Google application access, recurring report jobs/email, biography, billing/trials and app-store packaging remain later work. Moving hosting is not itself an app-store release.

## Continuity

After the verified GitHub transfer, SmitzSecurity/LifeApp is canonical for code. Keep the old Sites project only for the live fallback. Prior project `appgprj_6aa0404061f081918926d856daa9a693`; do not create another Site. The live v3 stays at https://lifeapp.abrahamesmitz.chatgpt.site. Read and update the same `LifeApp_Product_Build_Log.md`, ID `libfile_19df04a785a0819185c2b0a728b24c08`, after recording the new commit and any verified owner connection. Prioritize migration/activation over adding further Sites-only features.
