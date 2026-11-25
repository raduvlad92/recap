# Monthly provider budget

S2 replaces the per-reader lifetime stop for scheduled collection and automatic analysis with one USD 20 allowance for the app's Apify and OpenRouter work. A month runs from midnight UTC on its first day to midnight UTC on the next month's first day. Existing daily, per-call and per-session safeguards still apply. Independently authorized finite proof, legacy analysis and comparison operations keep their own tighter limits.

New paid work reserves its maximum before dispatch. The two existing financial ledgers use one transaction lock so concurrent providers cannot both take the same remaining allowance. Exact cached reads and known-run reconciliation remain available. Final charges are recorded against the original request month. Open reservations and unresolved observations still count against available capacity after the calendar rolls over. Proof envelopes count only their unused allocation, alongside separately recorded child jobs.

The admin collection costs screen shows recorded Apify and OpenRouter spend by provider, the combined commitment, and in-app alerts at 50%, 80% and 100% of the commitment limit. A reader sees a pause notice in the daily recap when the budget is full. Saved recaps and free reads remain available. An automatic task that reaches the spending stop keeps its existing requests. When it resumes, its finite session can reuse those saved results after checking the current source and unresolved charges.

The limit applies to admissions under Therecap's financial ledgers. Provider reports that exceed a reservation are preserved and suspend new spending when they consume the available allowance. Monthly cost totals are ledger-backed during the first release, with known legacy Apify runs included where they are absent from the reservation ledger.

## Release order

Apply the new SQL during the approved release window before enabling this worker build. Coordinate the merge with that migration because the main workflow can deploy automatically. The production pilot's existing finite Apify envelope still bounds any job that uses it. Moving the pilot onto the recurring allowance requires a separate checked runtime configuration change. Observe a scheduled ingestion and review-first analysis run with actual readback before enabling unattended briefing delivery.

## Verification

Disposable PostgreSQL tests use mocked costs. They cover exact budget exhaustion, both providers competing for one balance, UTC rollover, unresolved charges, envelope accounting, access controls and resuming a budget-paused analysis session without a second charge. Worker and UI tests cover the reader pause notice and the admin spend alerts.
