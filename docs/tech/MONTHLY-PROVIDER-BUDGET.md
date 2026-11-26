# Monthly provider budget

S2 replaces the per-reader lifetime stop for scheduled collection and automatic analysis with one USD 20 allowance for the app's Apify and OpenRouter work. A month runs from midnight UTC on its first day to midnight UTC on the next month's first day. Existing daily, per-call and per-session safeguards still apply. Independently authorized finite proof, legacy analysis and comparison operations keep their own tighter limits.

New paid work reserves its maximum before dispatch. The two existing financial ledgers use one transaction lock so concurrent providers cannot both take the same remaining allowance. Exact cached reads and known-run reconciliation remain available. Final charges are recorded against the original request month. Open reservations and unresolved observations still count against available capacity after the calendar rolls over. Proof envelopes count only their unused allocation, alongside separately recorded child jobs.

The admin collection costs screen shows recorded Apify and OpenRouter spend by provider, the combined commitment, and in-app alerts at 50%, 80% and 100% of the commitment limit. A reader sees a pause notice in the daily recap when the budget is full. Saved recaps and free reads remain available. An automatic task that reaches the spending stop keeps its existing requests. When it resumes, its finite session can reuse those saved results after checking the current source and unresolved charges.

The limit applies to admissions under Therecap's financial ledgers. Provider reports that exceed a reservation are preserved and suspend new spending when they consume the available allowance. Monthly cost totals are ledger-backed during the first release, with known legacy Apify runs included where they are absent from the reservation ledger.

## $18 operating stop for Flows 6 and 9

The candidate keeps the $20 approved UTC-month ceiling and stops new Apify and OpenRouter work at **$18 committed**, including unresolved holds carried into the month. The same transaction lock serializes both providers. A request below $18 may use up to the remaining headroom. At $18, new requests and new launches against an existing Apify hold are refused. Cached results, known-run reconciliation, settlement and late fees keep their existing paths. A late fee can still raise recorded commitment above the stop.

Collection costs shows the effective stop, current pause reason and the latest refusal recorded by the privileged server. The database returns a fixed reason for an admission that reached or would exceed $18. The server records it separately after the denied transaction rolls back. A receipt write failure leaves the original denial intact. Only the UTC month, reason and time are retained in the monthly refusal record.

Apply the operating-stop migration after the earlier train migrations while paused. Confirm the exact journal digest, then verify that the deployed Collection costs screen and budget readback show the $18 stop alongside the existing $20 accounting ceiling. Keep the review-first policy and the independent $0.75 analysis proof cap. The train owner decides which release carries this migration. Paid scope and flag activation still require the checked switch-on steps. [Switch-on plan](https://github.com/raduvlad92/recap/pull/60)

Disposable PostgreSQL 17 tests cover the last cent at $17.99, refusals at $18.00, two concurrent providers competing for one cent, rollover holds, a pre-funded launch refusal and successful settlement. The combined train tests also exercise the existing $0.75 analysis proof and free source import with paid work blocked.

## Release order

Apply the new SQL during the approved release window before enabling this worker build. Coordinate the merge with that migration because the main workflow can deploy automatically. The production pilot's existing finite Apify envelope still bounds any job that uses it. Moving the pilot onto the recurring allowance requires a separate checked runtime configuration change. Observe a scheduled ingestion and review-first analysis run with actual readback before enabling unattended briefing delivery.

## Verification

Disposable PostgreSQL tests use mocked costs. They cover exact budget exhaustion, both providers competing for one balance, UTC rollover, unresolved charges, envelope accounting, access controls and resuming a budget-paused analysis session without a second charge. Worker and UI tests cover the reader pause notice and the admin spend alerts.
