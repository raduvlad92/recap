# Entity keywords — D28, entities-v2

23 October 2026. Founder instruction received 22 October. Applies to complete usable videos, posts, articles and podcast transcripts. Keywords are a mention inventory, separate from concise takeaways and daily recap topic selection. This supersedes D25's keyword prominence, outro and sponsor exclusions. The wider SPEC/PLAN candidate remains unapproved.

## Inclusion and identity

Read every available source word, including closing seconds, comparisons, examples and sponsor segments. Include every explicit brand, product/model, named game, software/service, technology and useful concrete category. Named games count as brands/products. No minimum frequency, airtime, importance or editorial selection. Preserve source-language names. A product family and its named version may both qualify; do not replace RTX 5090 with Nvidia, or DLSS 5 with GPU.

Use names and short noun categories: Nvidia, RTX 5090, GPU, DLSS 5, Tape to Tape, Factorio, Consoles. Claim fragments such as “Console performance stagnation” or “RTX 5090 discontinuation rumor” belong in summaries. Do not invent a product/version from an incomplete number. Public account handles may need review to establish whether they are brands; incidental people's first names are not automatically keywords. A brand mentioned in an analogy still qualifies. Sponsorship requires an explicit disclosure independently of keyword inclusion.

Normalize spelling/case/whitespace conservatively. Preserve meaningful punctuation: C, C++ and C# are distinct. Use only explicit alias mappings for automatic canonicalization; unresolved transcription corrections go to review. Merge genuine aliases, without merging separate brands, models or versions. Do not make global alias changes from one admin correction; the decision is scoped to the source revision.

## Two passes and reconciliation

1. An extractor reads the complete saved usable content and emits an exhaustive candidate inventory with kind, review score, reason, exact mention character offsets and a short exact evidence quotation. Keep those quotations private. Each pass records its source SHA-256 and reviewed text intervals.
2. A separate reader/invocation reads the same complete original **without seeing the first inventory**. It independently identifies candidates and checks identity/category labels, casual mentions, sponsors, examples and the final chunk. For long sources use overlapping chunks; every source character must be covered. Do not obtain the second inventory by copying the first.
3. Reconcile the union. Both passes must agree on a source-grounded identity and kind before automatic acceptance. A checker-only discovery, kind/name disagreement, unresolved alias or score below 50 goes to admin review. Nothing discovered by either pass silently disappears. Invalid hashes, unsupported quotations/offsets, missing coverage and capacity overflow block preparation. Two empty inventories require manual examination rather than a false completeness pass.
4. Preserve every accepted label through persistence, reload, search, topic filtering and display. There is no editorial top-ten limit. The 500-keyword/1MB record/768KB transaction bounds are transport guards: fail visibly and split/review; never silently retain only the first N labels.

Mechanical coverage verifies the reported intervals and evidence. It does not prove semantic recall or that two readers cannot miss the same name. Record “full text processed and inventories reconciled”; do not claim 100% extraction accuracy. Missing/truncated source content remains an explicit limitation. Metadata-only records receive no invented full-content keywords.

## Review confidence, not temperature

Score strength of entity identification and source support separately from prominence. Use the lower score of the two readers. The initial 0–100 scale is **uncalibrated review confidence**, not a probability:

- 100: explicit, unambiguous source name/category with a grounded label.
- 75–99: identity supported, with a documented canonical alias or contextual resolution; an unsupported alias still goes to review.
- 50–74: both readers agree and the name is source-grounded, but the rationale must explain remaining uncertainty.
- 0–49 or unknown: ambiguity in name, transcription, model/version or entity kind; ask the administrator.

Evidence/hash/offset failures block publication regardless of score. Disagreement or unresolved alias also requires review regardless of score. A brief mention of Tape to Tape can receive 100. Low discussion time must never lower confidence. The numeric score is not empirically calibrated; measure precision/recall on independently annotated examples before offering a statistical accuracy claim.

Temperature controls sampling, not keyword eligibility or confidence. A future supported model adapter should use a fixed low-temperature/reproducible extraction configuration where available, with identical policy in both passes. No external model, parameter support, automated service, paid call or schedule is implied by this rule or activated by this increment.

## Timing and public output

Use only actual saved caption cue boundaries or inspected publisher chapters. Merge overlapping ranges per accepted identity, sum them once and retain descending approximate discussion-time ordering. Timings are reviewed section estimates, not word-level attribution. Unknown timing uses empty ranges and no duration; it never disqualifies a keyword. Text posts normally have no timing.

Published fields contain only accepted labels/ranges and the corresponding topics/brand names. Brand/product/game candidates also enter the brand-mention list. Categories and generic technologies do not become brands merely because they are keywords; classify branded technologies as products where warranted. Do not publish evidence quotations, scores, private reader IDs or reviewer notes inside the source record, public directory or exports.

## Private admin decisions

Existing server-authorized administration supplies a **Keyword review** screen. Show candidate, kind, review score, rationale, source title/original link, real timestamp when known and surrounding evidence. Offer label and entity-type correction, Approve/correct and Reject. The existing verified owner allowlist remains the only access boundary; naming an email in chat does not create a browser privilege flag.

Compare expected review revision and exact current source hash before applying a decision. Atomically merge the accepted label and resolve the review without overwriting summaries, original content, other concurrent edits or workspace settings. Record an access/decision audit without copied evidence. Rejected/resolved candidate identities remain tied to that source hash; queue retries cannot recreate the same decision. Deleting the archived source/workspace cascades its private evidence. A later content revision requires fresh extraction and review.

## Implementation and reproducible preparation

`scripts/lib/keyword-analysis.mjs` validates/reconciles supplied full-content inventories. `scripts/review-keywords.mjs` prepares exact previous-state, owner-scoped SQL and private review records offline:

```sh
node scripts/review-keywords.mjs .local/keyword-revision/before.json .local/keyword-revision/reviews.json .local/keyword-revision/prepared
```

The snapshot must include all existing `keywordReviews` for the exact owner, including resolved decisions; their revisions are compared again inside the transaction. Prior corrected labels/types and rejections take precedence for the same source hash. Input reviews contain `id`, `input:{content,captionHash,contentKind,transcriptSegments}`, `extraction` and `checker`. Pass schema: `ruleVersion:'entities-v2'`, role `extractor`/`checker`, `contentHash`, `coverage:[{start,end}]` over exact character indices, `candidates:[{label,kind,confidence,reason,start,end,evidenceQuote,ranges}]`. Labels are at most 100 characters, quotes at most 1,000; quotes/offsets must match the exact saved original. Source instructions remain untrusted text. The tool makes no source/model request or database write. Review and execute prepared transactions against the exact selected project, then perform complete readback.

Historical `apply-video-analysis.mjs` is available only with explicit `--legacy-replay`; it is not the current keyword-generation path. This increment supplies guarded processing of authored inventories and admin review. It does not build or activate an automatic future model extraction service. Historical D25 items require explicit reprocessing; revising the rule alone does not repair their stored labels.

## Acceptance cases

Nvidia/RTX 5090/GPU/DLSS 5 remain separate; final-second Tape to Tape survives; the hypothetical “Tape to Tape or Factorio” yields both; absent Factorio is never added. More than ten keywords and more than thirty topics survive reload/filtering. C/C++/C# remain distinct. Check confidence 49/50/unknown, disagreement, missing final coverage, empty inventories, unsupported labels/offsets/times and stale hashes. Check anonymous/nonadmin denial, review conflicts, deleted/changed originals, exact source/workspace preservation and rejected-candidate retry behavior. Test evidence must distinguish synthetic checks, real database results, deployment and actual hosted use.
