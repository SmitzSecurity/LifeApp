# Legacy code audit — September 8, 2026

Source: Google Drive document **Old Script**, identified in the original LifeApp folder and read during this session. Its internal header says **Life Operating System V8.3 — The Bricklayer**. This is a legacy reference, not the unrecovered current v2 bound script.

## Preserve

- Separate context notes from adopted habits.
- Keep distinct daily, weekly, monthly, and annual report windows.
- Preserve report history so later reviews can use appropriate earlier context.
- Respect explicit exemptions.
- Offer concise output appropriate to the actual user interface.

## Findings grounded in the code

1. A literal Gemini API key is embedded in the source document. Do not copy it into this repository, a report, or a runtime secret. The owner should revoke it if still active. Its status was not checked and it was not used.
2. Empty habit values are normalized to `Fail`; this conflates missing data and an explicit miss. The beta separates unrecorded and missed states.
3. Daily score is extracted from model text with a regex rather than calculated from adopted habits. The beta computes it deterministically outside the model.
4. `numericScore || 'N/A'` treats a genuine zero score as unavailable. The new domain logic preserves zero.
5. The report window slices the last N rows, not a date-filtered N-day interval. Multiple entries or missing days can therefore distort the reporting period. A future report service must filter by user-local dates.
6. Memory writes append `[uuid, timestamp, type, content]`, while some reads use indexes consistent with `[timestamp, type, content]`. This can miss previous summaries or read the wrong field. The new implementation will use named, validated records.
7. The script selects Gemini response parts by array position and lacks robust response validation, a priced usage ledger, and duplicate-execution protection. None of that code has been ported or executed.
8. Personal destination/profile details are hardcoded. In the new architecture, those belong in isolated user records and preferences rather than source code.

The current AppSheet definition and current v2 Apps Script remain uninspected. They are not blockers for the independent beta. Original Google files were left unchanged. No email was sent and no provider call was made.
