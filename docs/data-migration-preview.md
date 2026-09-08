# Checking a LifeApp backup before migration

Implemented September 8, 2026. This is a working local migration checker for the existing `lifeapp-portable-v1` private export. It does not import, link accounts, send journal data to AI, call GitHub, or change either database.

## What it checks

- Exact supported format, record fields, real calendar dates, timestamps and positive saved versions; bounded file size (8 MiB), record counts and nesting. Unknown ownership/credential fields are rejected.
- Profiles and selected habits, historical habit snapshots, explicit complete/incomplete status, and unique daily entries. Renamed/archived habits preserve their old recorded names.
- Budgets, categorized transactions, recurring occurrence IDs, original months, routine references, workout snapshots and one active workout.
- Original daily reports and every linked revision, source entry versions, prior report evidence, stored token costs and held reservations. Missing predecessors and altered revision evidence fail validation.
- When a destination backup is provided: records that would be added, exact matches, conflicting records, and records present only in the destination. Different payloads or versions conflict; nothing is overwritten or renumbered.

Stored report evidence is retained as opaque JSON under its known contract/window; the checker does not reinterpret the prose or regenerate reports. Validation preserves stored payload strings and versions exactly. Export files do not contain account identity proofs.

## Run it locally

Use Node 24 in the canonical checkout. Keep real backups in the ignored `private-backups/` directory. Do not commit journal backups or send them in chat.

```sh
npm run migration:preview -- private-backups/source.json
```

With a backup from the intended destination account:

```sh
npm run migration:preview -- private-backups/source.json --target private-backups/target.json --out private-backups/migration-preview.json
```

The report contains counts, cost totals, hashes and fixed blocker codes, not journal text, goals, habit names, financial notes, report prose or credentials. It still describes private activity, so keep it private. An output path must be new; the tool refuses to overwrite backups or prior reports. Invalid UTF-8, unsupported arguments (including `--apply`) and invalid backups fail without echoing their contents.

Exit code 0 means validation/preview succeeded, **not permission to import**. Exit code 2 means valid backups have record conflicts; exit code 1 means input/output or validation failed. Without a destination file, the comparison is unknown; it never assumes the destination is empty.

## Interpreting blockers

| Code | Required next step |
| --- | --- |
| `ownership_proof_required` | Authenticate the old and new accounts and bind both verified identities to the migration. File possession, matching emails and SHA-256 hashes do not prove ownership. |
| `apply_not_implemented` | Implement a separate authenticated, atomic import operation with idempotency and reconciliation; no apply path exists yet. |
| `target_not_compared` | Obtain the intended account's authenticated destination snapshot. A local file comparison is not a live account check. |
| `conflicting_records` | Resolve each conflict explicitly; keep original journals, versions and report history. |
| `usage_reconciliation_required` | Resolve generating/uncertain provider attempts before cutover. Never erase reservations or retry ambiguous requests automatically. |
| `multiple_active_workouts` | Resolve which session remains active before combining histories. |

`canApply` is always false in this increment. Before a future import, recheck source/destination hashes and versions against live authenticated records, verify all preserved record counts and review chains after the atomic write, and keep the old app available until the owner checks the new account. Do not enable AI jobs during an unverified migration or import old reservations as new charges.

## Verification

Eight automated tests exercise exports produced by the real LifeApp service against migrated SQLite databases using synthetic accounts, budgets, workouts and original/revised reports. They cover exact preservation, conflicts, duplicate records, broken references, invalid dates/versions, unresolved AI costs, cross-account privacy, invalid ownership claims, oversized/deep/invalid UTF-8 input, CLI operation and refusal to overwrite files. These tests perform no live migration, provider request or customer charge.

GitHub and hosting activation remain separate dependencies in `migration-to-codex.md`. The current live Sites v3 does not yet expose the backup endpoint prepared in the newer source.
