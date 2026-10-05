# Installable LifeApp beta

This extends the existing product at the same origin. The October 3 source already includes the web manifest, 192/512 PNG icons, Apple metadata, a standalone launch mode, safe-area handling and account-bound offline saves. Do not recreate those systems or reset the manifest identity.

## Entry points and behavior

Open `/install`, or use Install LifeApp from Settings or the Google sign-in screen. Links from those screens open a separate tab, preserving mounted drafts and saved-day sign-in parameters. Before opening the installed app, sync pending work in the original tab; unsaved in-memory drafts are not automatically transferred between windows.

The install page offers the native prompt only after a supported browser emits `beforeinstallprompt`, and only in response to an explicit button click. Every prompt object is consumed once. Dismissal, missing support and exceptions retain manual instructions. `appinstalled` or an actual standalone window can confirm installation; accepting a prompt alone cannot. Detection is transient and does not store device information.

Manual instructions cover iPhone/iPad Safari, Android Chrome and desktop browsers. iPad desktop-mode user agents are recognized. The page uses the current semantic palette, native zoom, wrapping actions, minimum 48px controls and safe-area padding. It inherits the existing manifest and icons, and the installed app starts at `/`, not `/install`. The normal Google flow and beta allowlist continue to apply.

Installation adds no account, credential, notification permission, background job, billing, API mutation, migration, analytics, service worker or private cache. Existing offline/save/reconnect behavior is unchanged; see `docs/offline-sync.md`. No customer release or store submission is included.

## Verification

`npm test` now includes `tests/pwa-install.test.mjs` (17 focused synthetic tests) and `tests/pwa-worker.test.mjs` (two compiled Worker checks). The focused tests cover server snapshots, supported platforms, prompt consumption, acceptance versus completion, cancellation, concurrency, error recovery, insecure contexts, listener cleanup, manifest continuity and entry-point safety. Compiled checks render the route and verify that anonymous access still cannot read the app's private API. The PR verification workflow uses Node 24 and read-only repository permissions, with no deployment or provider credentials.

Physical-device release checklist (not claimed by automated tests):

- Android Chrome: install, launch from the icon, verify standalone layout and existing Google sign-in.
- iPhone Safari: Share > Add to Home Screen, enable Open as Web App when shown, launch and sign in.
- On each device, save a synthetic entry, close/reopen the app, check save/sync status, and verify the keyboard does not obscure the active form or navigation.
- Confirm sign-out and account switching still respect queued-save guards. Use synthetic test accounts; do not delete the owner's account.
- Verify a subsequent deployment updates the installed experience without forcibly reloading unsaved work.

## Platform references

- MDN installability and platform differences: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- MDN install prompt event: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event
- Apple iPhone web-app installation: https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iph42ab2f3a7/ios

Publication and physical-device testing are separate from committing these changes. Record the actual checks and deployment result rather than treating a PR as a live release.
