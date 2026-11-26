# November paired-video replay follow-up

The candidate produces both structurally valid drafts for **72/72 admission-eligible pairs**, up from **69/72 (95.8%)**. The full frozen cohort advances from **69/88 (78.4%) to 72/88 (81.8%)**. Sixteen pairs still have admission holds. The full-cohort 90% target requires 80 pairs. Even clearing the one budget stop while all charge holds persist would bring the ceiling to 73/88.

This replay uses the identical private 241-job input from the [first run](VIDEO-ANALYSIS-REPLAY-2026-11-26.md), with both drafts requested on 88 videos. The [aggregate replay receipt](evidence/november-paired-replay-2026-11-26.json) has the same input digest. Source/video and financial identities stay private.

| Reason for an incomplete pair | Before | After |
| --- | ---: | ---: |
| Unresolved charge on either task | 15 | 15 |
| Budget admission stop | 1 | 1 |
| Storage unavailable on recap | 2 | 0 |
| Single recap finding ran out of checker output | 1 | 0 |
| **Total** | **19** | **16** |

The 26 charge holds are **tasks on 20 distinct videos**, not 26 paired videos. Fifteen of the affected videos belong to the 88 paired cohort, including six where both tasks were held. A pair stays in the full denominator whenever either draft is missing. The analysis-only rate excludes a pair only when unresolved billing or the recorded budget gate prevented admission. No hold was released, retried, cleared by age or classified as a successful draft.

## Changes verified offline

- A settled checker truncation on a single recap finding can take one expanded-output request. It retains the earlier receipt and the same evidence, transcript window and atomic validation schema. The new request is admitted only when it fits the original per-call ceiling. A second truncation still stops.
- Automatic video generation retries bounded transient storage errors using the same request identity. After ambiguous settlement it reads the exact persisted receipt first. A completed write returns that receipt, and an incomplete one can receive the same settlement once. Unknown charges, budget, permission and state conflicts still stop.
- The first replay modeled storage stops conservatively. The records do not identify their underlying database error, so the new replay exercises a one-time statement timeout as a recoverable case. Three storage tasks now pass under that simulation. Persistent errors remain a terminal stop. No real inference or settlement was attempted.

Across all 241 jobs, structurally valid drafts increase **210 → 214**. Output capacity improves **18/19 → 19/19** and storage **0/3 → 3/3** in the simulated transient case. Malformed JSON stays **44/44**, over-limit recaps **17/17**, unresolved charge **0/26**, and the existing budget stop **0/1**. Recorded corrupt output, real transcript bytes and exact known holds were reused. Successful replacement responses and checker judgments are simulated.

165 focused tests passed, including the private retained fixtures. The broader live quality target still requires the approved real-call sample with independently reviewed usefulness and attributable evidence. This work spent $0 and made no production writes.
