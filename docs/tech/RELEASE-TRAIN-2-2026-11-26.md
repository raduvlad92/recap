# Release train 2

Base is the checked recovery branch for [#46](https://github.com/raduvlad92/recap/pull/46) at `68a71c9`. Wait for #46's checked release and restoration to pass. Rebase this train onto the resulting `main` and retarget the draft before review, especially if #46 lands as a squash. Review the resulting diff against `main` and require green checks on the new head. Merge the combined train once during the approved window. The source PRs are references for review. The Clerk guard ships with the train; its production configuration remains unchanged until the separate L2 handoff.

| Order | Source | In this train |
| --- | --- | --- |
| 1 | [#47](https://github.com/raduvlad92/recap/pull/47) | Apply additive `20261126004139_admin_video_review_batches.sql` before the review UI can call its RPCs. |
| 2 | [#50](https://github.com/raduvlad92/recap/pull/50) | Deploy November analysis recovery with both #46's provider acknowledgment and the exact-receipt readback for a transient write. |
| 3 | [#51](https://github.com/raduvlad92/recap/pull/51) | Apply additive `20261126010136_capped_video_analysis_proof.sql` before exposing its operator tooling. |
| 4 | [#52](https://github.com/raduvlad92/recap/pull/52) | Deploy source coverage and preview, plus the reader design fixes. |
| 5 | [#54](https://github.com/raduvlad92/recap/pull/54) | Ship the matched Clerk runtime/build configuration guard on the current development keys. This adds no migration. |
| 6 | [#55](https://github.com/raduvlad92/recap/pull/55) | Include the read-only Clerk cutover checks, tests and L2 handoff. This adds no migration. |

Apply `20261126004139` first, then `20261126010136`. Deploy the train application and #54 guard after both migrations. After the train is accepted, L2 follows the [Clerk dashboard and DNS handoff](CLERK-PRODUCTION-CUTOVER-2026-11-26.md#dashboard-and-dns-handoff). Normal processing restoration and the paid wave remain separate decisions. The wave stays off until explicitly approved after release acceptance. During release acceptance, recheck flow 2 in production through the unsaved preview and verify the review queue against the additive migration.

## Authenticated headless evidence

The audit uses `scripts/lib/reader-audit-telemetry.mjs`. Call `requireSafePlaywrightEnvironment` before browser launch. Register opaque tickets and other known credentials with `protect` before entering them in the browser. Use `observe` for console and page errors, `route` for async intercepted requests, and `error` for top-level failures. The route wrapper catches disposal errors whose Playwright call logs can contain headers. Browser console output retains severity only. Error output retains a bounded category. The redactor also masks authorization, cookie headers, Clerk ticket/cookie keys, JWTs and known opaque values in explicit diagnostics.

For authenticated audits, leave Playwright native tracing and HAR recording off. Native archives can store raw secrets in network bodies, snapshots and screenshots. Use the event trace sink, which records only event names, HTTP methods and status codes. Capture only individually checked, masked screenshots without the ticket URL, account details, or private item data. Never persist browser storage state for these audits.
