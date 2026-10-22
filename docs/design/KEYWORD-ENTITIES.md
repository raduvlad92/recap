# D28 keyword correction and private review

23 October 2026. The founder rejected summary-style keyword labels and required every brand, product, named game, technology and clear category, including casual mentions and closing seconds. Explicit examples: Nvidia, RTX 5090, GPU, DLSS 5 and Tape to Tape; the hypothetical mention of Tape to Tape or Factorio must yield both games. [Current rule](KEYWORD-EXTRACTION-RULE.md), [summary rule](VIDEO-SUMMARY-RULE.md).

## Implemented scope

An offline reconciliation tool validates two authored full-content inventories against the exact saved source hash, character offsets, quotations, coverage and caption boundaries. A separate blind reader checked the complete reference without reading the first inventory. Both originals and the explicit taxonomy reconciliation remain private. All discovered candidates are accepted or preserved for review. Below 50, unknown confidence, unrecognized aliases and inventory disagreements require review; unsupported evidence and empty/incomplete inventories block processing. Confidence is uncalibrated reviewer judgment, not probability or airtime. Temperature is not an eligibility rule.

The ten-keyword validation/client truncation and independent topic/brand caps are replaced with explicit transport limits. Restored approvals are revalidated against final capacity/schema. C/C++/C# preserve their identities; explicit aliases can unify parent-prefixed product names. All accepted keywords remain in topics for working filters. Existing concise summaries are separate.

The private admin screen uses the existing verified primary-identity allowlist. It shows pending/approved/rejected pages, source evidence, scores and reasons, label/type correction and atomic approve/reject. Resolved entries are read-only. Source/review revisions prevent stale decisions, private access fails closed if auditing fails, and the table/RPC are unavailable to normal readers. Queue evidence is separate from archive/public/export data and cascades with source/workspace deletion. Prior rejected/corrected decisions survive a later batch for the same source hash.

This is guarded processing of model-authored inventories, not an automatic ongoing model service. No new source retrieval, provider job, generated transcription, external model API call or schedule is activated. The remaining historical LMG batch has not been reprocessed under entities-v2.

## Actual database changes and preservation

Existing recap project `zlfdqzabsfndifxiqguo`; three scoped migrations add private reviews, align Unicode/punctuation normalization, keep nonvideo approvals in topics/brands and preserve corrected kinds separately from proposed kinds. The original migration had already been applied before the normalization improvement; follow-up changes use separate migration history.

The reference [The RTX 5090 is Reportedly Dead](https://www.youtube.com/watch?v=iCQ7zSJ8lf8) now has **26 accepted keywords** including all five requested actual names and no “Console performance stagnation” label. The saved transcript contains Tape to Tape at **11:12**; Factorio is absent and was not invented. **36 candidates** wait in private review: **18 below 50/100**, with 18 additional checker-only discoveries/disagreements. A high review score on a checker-only discovery is not agreement by both readers.

Exact readback verified all **278 archive rows**, the one intended patch, every other record, the source transcript/highlights/summary and the complete workspace/revision. [Sanitized readback](evidence/keyword-entities-readback.json). The public source names/URL and accepted labels are safe evidence; private quotations, IDs, follows, before/after snapshots and prepared SQL remain ignored.

## Verification and release

Local keyword/admin unit checks and typecheck pass. Disposable PostgreSQL migration, transaction and concurrency tests covered collision/range merges, exact long Unicode content hashes, review races, deletion/no-resurrection and audit rollback. Actual recap database transaction checks passed for RLS/ACL denial, approve/reject, stale review/source hash rejection, source/workspace preservation, unknown timing, post handling and corrected kinds. Those disposable synthetic rows were rolled back; they are not source-collection evidence. Security advisors reported no issues. Full release suite, CI, deployment and signed-in desktop/phone checks are recorded below when obtained.

Supplier spend added: zero supplier jobs/calls. Hosting/build/database usage remains unmeasured. Wider SPEC/PLAN v1.1, customer outreach, payment and recurring generation remain outside this increment.
