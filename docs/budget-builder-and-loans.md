# Budget builder and loans — September 14, 2026

Budget now includes **Build with AI** for pasted text or a budget screenshot. The
result is a saved, editable draft: category allowances, monthly recurring income
and expenses, and loans when the source supplies enough details. No transactions
are created by generation or adoption. Existing allowances stay unchanged unless
the user edits them or chooses **Use imported allowances**. Matching recurring
items begin unchecked; their saved IDs cannot be imported again as new records.

The review uses the same item-level comparison and bounded CAS merge as manual
budget edits. All selected changes commit in one month update. A conflict leaves
the entire draft available; unrelated edits are retained. New categories and
recurring items receive durable IDs when the AI result is first saved, so exact
retries cannot duplicate them. Category limits remain 30 and recurring items 60.

## Images and AI accounting

JPEG, PNG and WebP uploads, or a screenshot pasted into the text box, are resized
in the browser to a maximum 1,800-pixel side and encoded as JPEG. Source files are
limited to 10 MB/25 million pixels. The server independently checks base64, media
signature, dimensions (2,048-pixel sides), attachment length and bounded streamed
request size. No URL downloads, image hosting, storage service or new permissions
are needed. The image is sent only when the user chooses Build with AI.

Gemini receives the pasted text, selected month, Money/budget goals and optional
inline image. It does not receive journal or workout context. The server keeps an
image fingerprint for retry identity, not image bytes. Drafts use the existing
`life_routine_builds` table with a `budget:` namespace; routine, written-workout and
training listings stay separate. Export/import validation and central Trash
recognize budget drafts. Account deletion and the seven-day purge remove their
content while retaining minimal AI accounting.

Existing reservations, archived usage, user/global caps, daily admission limits,
the cost circuit breaker and unknown-outcome holds apply. A malformed/truncated
response records its measured cost and produces no usable plan. Unknown outcomes
keep the reservation and cannot be resent as a new request. Output is constrained
by a JSON schema and independently validated. Unknown amounts remain zero in a
draft and must be corrected before saving a recurring item. Unsupported frequencies
and incomplete loan details must be identified in the draft notes.

## Schedules and loan records

Recurring items support an optional start date, an inclusive end date, or 1–600
monthly installments. Installments count eligible scheduled occurrences beginning
on or after the start date; missed payments do not extend a contract. Day-of-month
schedules clamp to the last day of shorter months. First/second/third/fourth/last
weekday schedules also respect the boundaries. Expiration removes future
forecasts, never recorded expenses.

Loans have their own compact **Loans & payoff** section and editor fields. A loan
is stored as optional `debt` details on its monthly recurring payment, preserving
one payment identity rather than creating a second expense. The record includes
original principal, a statement principal balance and its end-of-day date, annual
interest rate, monthly or daily-simple accrual, and the payment portion attributable
to taxes/insurance/fees. Statement updates reset the estimate baseline. Delete uses
the existing recurring-item Trash path; purge replaces the complete item with its
minimal tombstone, removing all loan details.

The loan card distinguishes an estimated balance/payoff from confirmed payments.
Only recorded, nonvoided, nondeleted expenses linked to that recurrence after the
statement date enter its estimate. Confirming a payment saves the ordinary monthly
transaction; edits and void/delete actions in History therefore update the same
payment. One linked payment record exists per month; multiple payments can be
represented by their combined monthly amount. Unlinked generic transactions do
not silently reduce a loan. The cross-month read refuses to calculate from more
than 5,000 records instead of presenting partial totals.

Monthly estimates charge rate/12 on principal at each due-date boundary; daily
simple estimates use actual elapsed days/365 and principal. Payments first cover
estimated interest, then principal, after subtracting taxes/insurance/fees. Unpaid
interest is tracked separately and is not automatically capitalized. Projections
assume future scheduled payments, stop after 50 years, and identify insufficient
payments or a remaining balance when a finite schedule ends. Progress can decline
when interest increases the balance. Forecasts do not mark a loan paid off or stop
payments automatically; a confirmed zero statement balance can do that.

These are fixed-rate estimates. They do not model rate resets, deferred promotional
interest, accrued interest predating the statement baseline, lender-specific
rounding, capitalization, penalties or variable repayment plans. Use the interest
rate, not APR, and refresh statement information as needed. Historical monthly
plans remain snapshots. Edits apply to the selected month and future months copied
from it; they do not rewrite other already-saved monthly plans.

## Sources and verification

The interest/principal distinction and mortgage payment components follow the
[CFPB amortization explanation](https://www.consumerfinance.gov/ask-cfpb/how-does-paying-down-a-mortgage-work-en-1943/)
and [principal/interest versus total payment](https://www.consumerfinance.gov/ask-cfpb/on-a-mortgage-whats-the-difference-between-my-principal-and-interest-payment-and-my-total-monthly-payment-en-1941/).
Daily simple interest uses the method described in
[Federal Student Aid entrance counseling](https://studentaid.gov/sa/sites/default/files/loan-entrance-counseling.pdf).
These sources establish the calculation methods, not accuracy for every lender.
Image and structured extraction use the official
[Gemini image input documentation](https://ai.google.dev/gemini-api/docs/image-understanding)
and [structured outputs documentation](https://ai.google.dev/gemini-api/docs/structured-output).

Synthetic source tests cover schedule boundaries, zero-interest payoff, missed
installments, interest allocation, statement resets, privacy/image bounds, consent,
account isolation, malformed output, shared limits, concurrent retries, atomic
adoption/conflicts, cross-month reads, export and Trash. Browser verification uses
the compiled app and a mocked provider; no owner data or paid Gemini calls are used.
No database migration or runtime flag change is required.

Rollback: once new fields or budget drafts have been saved, use a compatible forward fix. Older strict schemas and build-namespace validators cannot read them. A recovery tag preserves prior source; it does not authorize deleting new data or restoring an old database over later writes.
