# Blind recap labelling rubric — 26 November 2026

Label the complete draft against the frozen source and the exact quote attached to each takeaway. Judge what the original speaker reported and how the draft conveys it. Use only the packet and this rubric during blind review.

## Material unsupported claims

A factual addition, omission or change is material if correcting it would change a reasonable reader’s understanding of who or what the speaker meant, what happened, the scope or strength of the finding, or how the finding applies. Check attribution, comparisons, scope, numbers and units, timing, conditions, causation and certainty. Test each factual clause, including clauses joined by “and” or “but.”

1. Find the attached quote in the saved source. Allow whitespace normalization. The span must be recoverable as one continuous excerpt from that source.
2. Ask whether the quote supports each material clause. Use surrounding text to resolve a reference already in the quote, such as “that screen,” or to qualify, contradict or retract a statement. If the takeaway adds a separate observation, result or comparison, the attached span must include the words that support it. This applies even when the additional words are in the next sentence.
3. Accept faithful paraphrase, reordered facts, equivalent quantities in the same supported unit and attributed opinions with the same meaning. Preserve qualifications that change meaning. An omitted “about” before the same reported rounded estimate can be harmless if the draft still presents it as a reported estimate. An exact total, new unit or changed payment status is material.
4. Mark a known missing or contradicted material claim invalid. If the source leaves a term ambiguous and the draft picks a specific meaning, that specific assertion needs evidence. Use `uncertain` when the evidence leaves the annotator unable to decide whether a material claim is supported after checking the exact passage and context. Record what would resolve it.

| Label | Apply to the complete draft |
| --- | --- |
| `valid` | Every takeaway is useful, accurately attributed and supported by its attached quote in context. |
| `invalid` | Any takeaway makes a material unsupported or misleading claim, has an unusable citation, or offers no substantive finding. Name the claim and what the evidence establishes. |
| `uncertain` | A material support question remains unresolved after inspection. Name the claim and the ambiguity. |

## Calibration cases

Use these examples before a new blind round. Use unseen cases to measure agreement with this rubric. The [archived evaluation](recap-guard-retune-2026-11-26.md) records all eight disagreements and 11 guard misses, with their original decisions.

| Cases | How to decide |
| --- | --- |
| C01 | **Valid.** An explicit contrast in the quote refers back to the screen already under discussion. Use the surrounding remarks to identify that screen and understand the contrast. |
| C03, C08 | **Invalid.** Software lineage cannot be assigned to the hardware. A response also cannot be extended to cover a specific score or attributed disagreement without evidence for those details. |
| C06 | **Invalid.** A relative judgment that an update had the least impact does not support a claim of no downsides. The separate conclusion also has a personal-use caveat that affects its scope. |
| C12 | **Invalid.** The captions leave the measurement unit ambiguous. The takeaway assigns a specific unit without enough evidence. |
| C02, C14 | **Invalid.** Charge time and percentage do not establish battery chemistry or wattage disclosure. The disappearance of a sport-mode sound does not establish what the remaining sound resembled. |
| C17, C18, C21 | **Invalid.** A force-quit example does not establish retained context after suspension. A new camera specification does not establish the old one. A measured efficiency does not establish performance relative to peers. Each added comparison or mechanism needs a supporting span. |
| C13, C20 | **Invalid.** Making selected metadata available is narrower than requiring storage and transfer of sensitive data. A reason for avoiding wall studs does not identify the anchor or mounting method. |
| C10 | **Invalid.** A note that the source offered no substantive material does not on its own give the reader a substantive takeaway. |

## Independent review and agreement

Give both annotators the same frozen blind packet with case aliases, complete sources, drafts and their citations. Keep each annotator’s labels private until both have locked them. Return one `id`, `label` and `reason` per case. Costs, model identities, historical labels and checker verdicts stay out of the packet. Keep source text, drafts and review files outside Git.

Report each annotator’s counts, raw agreement, Cohen’s κ including `uncertain` if used, and all disagreements. Target **κ ≥0.60** on the next independent calibration round. Adjudicate after recording agreement. For each disagreement, document the exact claim at issue, the applicable quote boundary or context and the reason for the consensus label. Leave a case uncertain if the evidence still leaves it unresolved. The prior κ was **0.385**. This revision has yet to be measured.

## Post-V1 experiment · queued

After V1 and the PM’s authorization following accepted train 2, test a claim-by-claim LLM support check on the two archived holdouts. Freeze both manifests and consensus labels. For each material claim, ask whether its exact cited span entails it, with surrounding context used only as above. Return supported, unsupported or uncertain with the span and claim under review. Report hold precision, invalid recall and valid retention separately on the tuning set and the fresh production set. Keep results advisory and private for individual review.

The experiment is unstarted. Its ceiling is **$0.25 total** across paid attempts and retries. Count outstanding reservations toward that ceiling and verify room against the shared **$18** operating stop and existing limits before any launch. [Budget and paid-wave plan](analysis-enablement-2026-11-26.md)
