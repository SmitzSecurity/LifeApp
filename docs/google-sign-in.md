# Google account sign-in decision

**Updated migration checkpoint:** Google code-flow authentication is now implemented for the standalone Cloudflare target using Better Auth and private D1 sessions. The existing Sites deployment still uses its supported dispatch identity. See `migration-to-codex.md` for the new implementation and owner setup. The text below records the earlier Sites limitation; it is no longer an implementation blocker for the new standalone target.

Owner requirement: Google Account sign-in as the consumer account path, with later optional integration into Google applications. Accepted September 8, 2026.

The current private Sites boundary authenticates ChatGPT users and supplies a trusted, Site-specific stable user ID. Its documented starter path owns sign-in/callback routes. The Sites authentication skill requires confirming a supported external identity path before implementing app-owned OAuth. The exposed Site tools and current instructions do not provide Google identity configuration. Do not replace a label with a nonfunctional Google button or trust an email/body/header from an untrusted client. This is a current tooling constraint, not a claim that Google OAuth cannot be supported on another host.

Plugin discovery found no usable connected Google Cloud OAuth management capability. A separately hosted consumer backend remains a possible route, but its host, callback domain and operator account are not provisioned. Keep the same canonical code project and domain/service logic; do not create a competing LifeApp app to get around this dependency.

## Reviewable integration requirements

| Area | Required behavior |
| --- | --- |
| Initial consent | Request `openid profile email` only. Google sign-in does not grant access to Gmail, Calendar or Drive. |
| OAuth client | Owner-controlled Google Cloud project, consent screen and Web application client; register the exact HTTPS redirect URI only after confirming the supported host. Client secret stays server-side. |
| Callback/session | Authorization code flow, unpredictable single-use state and nonce, PKCE; server verification of signature, issuer, audience, expiry and nonce; short-lived secure HttpOnly SameSite session, rotation and logout. Use an established supported auth implementation. |
| Account identity | Store an internal account ID mapped to the verified issuer + `sub`. Email is mutable and must not identify or merge accounts. |
| Existing journals | Link a Google identity only after reauthenticating both the current owner account and Google account. Transactional migration/linking preserves all profiles, entries, section records and AI usage/report ownership. Never automatically link equal email addresses. |
| Later Google apps | Ask incrementally for the narrow scopes needed when the user enables that feature. Store refresh tokens encrypted on the server, implement revocation/disconnect and handle revoked access without affecting the core journal. |
| Verification | Test cancelled/expired consent, invalid state/nonce, replayed code, wrong token audience, account switching, missing/revoked refresh tokens and cross-account access. |

Required dependency: a confirmed consumer hosting/authentication path and the owner's OAuth client registration. No Google OAuth client was created, credentials collected, scopes granted or existing journal account migrated in this run. Continue independent scheduling/export work while that dependency is unresolved.

Google's [OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) specifies stable `sub` identity and validation; its [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) covers client configuration, redirects and incremental authorization. Checked September 8, 2026.
