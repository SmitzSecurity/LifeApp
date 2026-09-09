# Cloudflare Git build setup

Prepared September 9, 2026 for the existing SmitzSecurity/LifeApp repository.
The owner created the D1 database and selected this repo in Cloudflare's creation
wizard. The first deployment establishes hosting; sign-in is closed with HTTP
503 until runtime Google configuration is complete. No journals are exposed.

## Creation form

| Setting | Value |
| --- | --- |
| Project name | `lifeapp` |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npm run deploy:cloudflare` |
| Production branch | `main` |
| Root directory | Repository root (leave default) |
| Builds for non-production branches | Off for this initial deployment |
| Build variable | `LIFEAPP_D1_DATABASE_ID` = the owner's existing D1 database ID |

The database ID is operational configuration, not a login credential; obtain it
from the owner's dashboard/current private build log. It stays out of public
source in the ignored generated configuration. Node 24 is selected by `.nvmrc`.
Do not add Google/Gemini keys to build variables. Cloudflare Access is a separate
sign-in layer and is not required to keep this bootstrap closed.

`build:cloudflare` requires a real UUID (rejects the local placeholder), uses
the existing standalone build, and writes a guarded deployment marker. It never
copies auth URL, email allowlist, OAuth keys or AI values from build environment
into configuration. `deploy:cloudflare` requires that matching output and rejects
a normal local build. `npm run deploy:cloudflare -- --dry-run` verifies packaging
locally without creating or changing a Worker.

The generated config uses `keep_vars=true`: runtime settings added in the
dashboard survive later Git builds. The original local-development settings and
the manual `standalone configure`/deployment guard remain available independently.
No API origin is guessed; inspect the resulting Worker URL before registering
Google's callback. No Cron is configured.

## After the first deployment

1. Confirm the exact HTTPS Worker URL and the `DB` binding points to the existing
   database. An initial HTTP 503 with the setup message is expected.
2. Apply all existing migrations to that database through authorized Cloudflare
   access. The initial Git deploy does not apply migrations or create tables.
   Wrangler migrations require D1 permissions, which the default Workers Builds
   token may not include; inspect the actual permission form before changing it.
3. Configure `BETTER_AUTH_URL`, `LIFEAPP_BETA_EMAILS`, `BETTER_AUTH_SECRET`,
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as runtime values/secrets. Use
   encrypted runtime secrets for credentials and the private beta email. The
   callback is the verified origin plus `/api/auth/callback/google`.
4. Test synthetic sign-in/logout and account isolation. Add the fresh managed
   Gemini secret and paid-project activation only after owner setup, then
   reconcile one synthetic AI request and a duplicate retry.

Publishing source to main can trigger deployment after Git builds are connected.
Future code work should use review branches until a change is ready for release.
Never publish credentials or journals. Keep the old Sites app/data until verified
cutover; this initial hosting step does not migrate data or release a store app.

Official documentation checked September 9, 2026:
[build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[Node version selection](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/),
[preserving runtime variables](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth).

Verification: 57 standalone tests and TypeScript passed. A separate Cloudflare
build with a synthetic database UUID and synthetic secret marker passed; generated
configuration contained only Google auth mode, preserved runtime vars, and the
supplied DB binding. Missing-ID and local-build deployment guards rejected their
inputs. Wrangler's deployment dry run resolved the built Worker modules and 15
static assets successfully without a real deployment. No credentials, journals,
database migrations, live sign-in or provider calls were involved.
