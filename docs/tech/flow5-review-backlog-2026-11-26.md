# Flow 5 review backlog — 26 November 2026

**The current backlog cannot be cleared in five minutes.** Production held **4,240 visible pending review rows**, including **3,297 November 25 draft items on 93 videos** and **109 additional November 25 failure or hold records**. **12 of 50 sampled rows passed** the content and citation checks (**24%, against a 90% reference bar**). The narrower rate for rows containing content was **12/32 (37.5%)**. The owner’s **Keep held for review** decision applies.

The audit used the existing Supabase production connection between 03:46 and 04:00 UTC. Every data query ran in a `BEGIN READ ONLY` transaction with an explicit `ROLLBACK` and reported `transaction_read_only = on`. Bounded reads replaced a combined query that exceeded its statement timeout. Analysis and collection spend for this audit was **$0**. The [November replay](VIDEO-ANALYSIS-REPLAY-2026-11-26.md) and [owner decision](../DECISIONS.md#11-november-2026--founder-explicitly-keeps-the-corrected-recap-held) provide the starting context.

## What is pending

The inbox view is the denominator because it is what the operator sees. It contains **4,082 keywords and 158 recap proposals or failure records**, spanning **213 YouTube videos** and **12 other source groups** with **30 rows**. The 3,297 figure refers to nonempty proposals linked to November 25 automatic tasks in `review` state. Those tasks are a subset of the full pending inbox.

| Draft age at capture | Keyword rows | Recap rows | Total |
| --- | ---: | ---: | ---: |
| Up to 2 days | 3,309 | 97 | 3,406 |
| More than 2 through 14 days | 10 | 7 | 17 |
| More than 14 through 30 days | 727 | 54 | 781 |
| More than 30 days | 36 | 0 | 36 |
| **Total** | **4,082** | **158** | **4,240** |

The current archive hash matched every visible pending row with content. There were **0 superseded by a changed transcript, 0 with changed recap annotations, 0 extra exact duplicate proposals, 0 competing types for the same normalized keyword, and 0 missing or mismatched source records**. The scan compares same-reader, same-update, same-content proposals. A duplicate is the same normalized keyword and type or the same recap proposal JSON. Similar wording across different proposals requires judgment. The inbox view already suppresses **61 pending legacy shadow rows**. These remain recorded outside the 4,240. Age alone establishes no loss of source relevance.

The November 11 automatic cohort has **106 protected rows**. Another **35** have an unsettled model call on the same reader, update and content revision. These groups are disjoint at capture. The protected count covers the entire November 11 automatic cohort as a precaution around the specific owner-held proof. The ledger is the authority for charge reconciliation.

## Quality sample

I took 35 keyword rows and 15 recap rows from the visible inbox using a fixed ID-hash order within each type, channel and age band. The selection covered **22 of 23 channels, 36 channel × age cells and 50 distinct type × channel × age strata**, one row from each selected stratum. The full inbox had 82 strata. The takeaways quota gives recaps enough representation to see their failure modes. Small strata and empty attempt records are deliberately represented. The rates describe this audit sample. The V1 flow 4 proof tests whether **both drafts** on the same newly analyzed video are usable. It needs a separate paired test.

I checked saved archive identity, URL and source hash for each row. For keywords I required an exact recoverable mention, a sensible identity and the correct type in its local context. Newer keyword rows cite through the saved original and a recoverable literal mention. Legacy examples also have a saved quote. For recaps I required every takeaway to be useful and supported by its own exact attached quote, with attribution, numbers and qualifications intact. Nearby context could disqualify a claim. This was a single-reviewer check against bounded archive excerpts without external fact checking or exhaustive keyword recall analysis. [Keyword rubric](../design/KEYWORD-EXTRACTION-RULE.md)

| Sample | Passed | Reviewed | Rate |
| --- | ---: | ---: | ---: |
| Keywords | 12 | 35 | 34.3% |
| Recaps | 0 | 15 | 0% |
| **All pending rows sampled** | **12** | **50** | **24.0%** |
| Nonempty proposals | 12 | 32 | 37.5% |

- **18** empty attempts. Seven had unresolved charges, three invalid JSON, one insufficient output capacity, two altered findings, and five other named causes in the sample log.
- **15** literal keywords needed correction or rejection. Seven used the wrong category or naming role, five had ambiguous or faulty names, and three identified incidental people.
- **5** nonempty recaps had exact quotes in the correct archive. Four quotes left material parts of claims unsupported. One draft omitted a qualification visible in the adjacent context. An exact quote checks provenance. Entailment still requires reading it.

## What train 2 changes

| Candidate | Measured overlap with this backlog | Effect of shipping |
| --- | --- | --- |
| [#47 batch review](https://github.com/raduvlad92/recap/pull/47), `5317b4e` | **4,240** rows on the grouped screen. The score dry run found **2,729** at 100 across **61** video groups, **62** at 0 across **60** groups, and **615** at 50. The remaining **834** are outside its November cutoff and unscored. The two shortcut groups cover **111** distinct videos. All 28 November rows with a same-revision unresolved call scored 50. | Groups pending records six videos or source groups at a time. Staging is reversible until the owner presses Apply. Shipping writes zero decisions. Score 100 verifies checker output and saved evidence mechanics. It still needs contextual review. |
| [#50 paired recovery](https://github.com/raduvlad92/recap/pull/50), `2d7815f` | **69** pending rows across the **3** current videos with recorded storage-unavailable failures. **395** rows across **9** videos with a recap capacity failure are the broader capacity cohort. Their nine original settled checker calls contained four to six findings. The one single-finding recovery in the offline replay occurs after simulated splitting, so the original receipts supply no exact one-video match for it. | Improves later permitted attempts. Existing decisions and drafts are untouched by shipping. Three storage recoveries were simulated and the historical error may recur. |
| [#51 capped proof](https://github.com/raduvlad92/recap/pull/51), `6daf6af` | **0** pending rows on the **19** current archive records that pass the static per-video proof admission criteria. **0** overlap with the 93-video rerun cohort. | Adds an inert proof path for up to ten eligible, unattempted video revisions. An exact manifest and authorized run are needed to create any new pending rows. |

## Proposed triage

| Group | Rows | Proposed treatment |
| --- | ---: | --- |
| Confirmed stale, extra exact duplicate or missing original | **0 visible** | Archive from the active workload only after verifying a superseding revision or exact canonical counterpart and preserving history. The 61 hidden legacy shadows already stay out of the active inbox. |
| Owner-held or unsettled charge | **141** | Retain the hold, including all 106 November 11 automatic rows and all 35 flagged by the ledger. |
| Empty format failures eligible for grouped rejection | **62** | Once disposition is authorized, confirm the failure class and current revision, then stage rejection. These rows have no proposed content to inspect. Retain the native decision history. |
| Score-100 approval candidates | **2,729** | Inspect the terms, types and cited takeaways by video. Use staging only for a group whose whole approval set has been reviewed and explicitly authorized. |
| Remaining manual queue | **1,308** | Read the original evidence, then propose keep, correct or reject. Prioritize recent videos with both draft types and retain older valid material for history. |

A single owner session should work through one small, recent day when there is authorization for a timed proof. Start with up to six videos, use the desktop queue, and record elapsed wall time from opening the pending page through confirmed decisions and reader-library readback. A five-minute pass at six videos allows roughly 40 seconds per video for checking after navigation and a short batch settlement. Stop or record a miss when the day needs more time, a source changes or the batch contains unresolved cases. Use a separately authorized future cutoff to confirm citations and coverage in the reader’s daily recap.

## Review time model

The model uses the **2,791 mechanically eligible decisions** and the saved newest-first group order over **26 pages** containing November 25 groups. On each six-group page it considers approval and rejection as separate whole-video actions and packs them in page order. The smaller caps are planning scenarios. The shipped cap is **250 per request**, with **50** selected items in the existing manual UI. Estimate **5 seconds per stage action**, **10 seconds per apply and response check** and **6 seconds per page load or move**. Content judgment, conflicts and changes in page order on reload add time.

| Decisions per batch | Perfect-packing request floor for 2,791 | Whole-action decisions that fit | Page-aware applies | Modelled UI time for those that fit |
| ---: | ---: | ---: | ---: | ---: |
| 25 | 112 | 409 | 31 | 14.7 min |
| 50 | 56 | 1,113 | 39 | 17.7 min |
| 100 | 28 | 1,986 | 36 | 18.3 min |
| **250** | **12** | **2,520** | **26** | **16.9 min** |

One video has **271** score-100 rows. The entire stage action is disabled at 250, so **at least 21 individually decided rows** would have to come off that group before its remaining approval action can fit. The existing manual selection can help after those rows are checked. On the saved order, resolving that overflow then staging brings optimistic UI time to about **17 minutes**. Even allowing every other score-100 decision without extra inspection, the **1,308 manual rows** plus those 21 at an assumed **30 seconds each** bring the full session to about **11.4 hours**. For the **November 25 day alone**, the **587** manual rows plus 21 overflow would take about **5.4 hours** under the same optimistic model. These are planning estimates. Elapsed owner time remains unmeasured. A two-pass workflow or faster batching still needs acceptable draft quality.

## Reader acceptance

Production held **13 briefings awaiting review** and **0 with a publication timestamp**. The last saved briefing was dated **November 13**. A future explicitly authorized review can write approved material to the reader’s source archive. Verify it in the signed-in library, with the exact saved original citation. Daily briefing intake also requires eligible current-source keyword material, an approved recap matching the current hash, and the ordinary cutoff and visibility rules. The five-minute desktop review target, library readback and the first genuine published daily recap are three separate acceptance checks.


## Count and sample details

Channel and video aliases identify groups within this audit. Production row IDs, source URLs, payloads and archive excerpts belong in the private receipt.

<details>
<summary>Pending drafts by channel</summary>

| Channel | YouTube videos | Other rows | Keywords | Recaps | November draft items | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C01 | 0 | 11 | 6 | 5 | 0 | 11 |
| C02 | 0 | 4 | 2 | 2 | 0 | 4 |
| C03 | 7 | 0 | 127 | 6 | 81 | 133 |
| C04 | 7 | 0 | 88 | 7 | 88 | 95 |
| C05 | 5 | 0 | 70 | 2 | 63 | 72 |
| C06 | 9 | 0 | 141 | 12 | 133 | 153 |
| C07 | 10 | 0 | 79 | 9 | 76 | 88 |
| C08 | 6 | 0 | 86 | 3 | 79 | 89 |
| C09 | 15 | 0 | 24 | 1 | 0 | 25 |
| C10 | 10 | 0 | 574 | 4 | 347 | 578 |
| C11 | 9 | 0 | 372 | 8 | 369 | 380 |
| C12 | 14 | 0 | 263 | 12 | 191 | 275 |
| C13 | 12 | 0 | 114 | 3 | 57 | 117 |
| C14 | 6 | 0 | 72 | 4 | 66 | 76 |
| C15 | 15 | 0 | 524 | 21 | 462 | 545 |
| C16 | 1 | 0 | 4 | 1 | 0 | 5 |
| C17 | 14 | 0 | 187 | 20 | 189 | 207 |
| C18 | 0 | 15 | 10 | 5 | 0 | 15 |
| C19 | 15 | 0 | 546 | 13 | 537 | 559 |
| C20 | 11 | 0 | 262 | 3 | 192 | 265 |
| C21 | 33 | 0 | 303 | 5 | 229 | 308 |
| C22 | 9 | 0 | 214 | 9 | 137 | 223 |
| C23 | 5 | 0 | 14 | 3 | 1 | 17 |

</details>

<details>
<summary>Pending drafts by video (213 videos)</summary>

| Channel | Video | Keywords | Recaps | November draft items |
| --- | --- | ---: | ---: | ---: |
| C03 | V001 | 65 | 1 | 65 |
| C03 | V012 | 45 | 1 | 0 |
| C03 | V023 | 1 | 1 | 1 |
| C03 | V068 | 14 | 0 | 14 |
| C03 | V134 | 1 | 1 | 1 |
| C03 | V154 | 1 | 1 | 0 |
| C03 | V157 | 0 | 1 | 0 |
| C04 | V021 | 1 | 1 | 0 |
| C04 | V025 | 37 | 1 | 38 |
| C04 | V060 | 11 | 1 | 12 |
| C04 | V084 | 0 | 1 | 1 |
| C04 | V152 | 3 | 1 | 0 |
| C04 | V201 | 35 | 1 | 36 |
| C04 | V208 | 1 | 1 | 1 |
| C05 | V093 | 3 | 0 | 0 |
| C05 | V165 | 4 | 1 | 1 |
| C05 | V172 | 1 | 0 | 0 |
| C05 | V181 | 61 | 1 | 62 |
| C05 | V187 | 1 | 0 | 0 |
| C06 | V010 | 1 | 1 | 0 |
| C06 | V036 | 4 | 3 | 0 |
| C06 | V046 | 1 | 1 | 0 |
| C06 | V048 | 49 | 1 | 50 |
| C06 | V053 | 3 | 1 | 0 |
| C06 | V105 | 47 | 2 | 48 |
| C06 | V122 | 34 | 1 | 34 |
| C06 | V141 | 1 | 1 | 1 |
| C06 | V204 | 1 | 1 | 0 |
| C07 | V004 | 1 | 1 | 1 |
| C07 | V073 | 29 | 1 | 29 |
| C07 | V095 | 1 | 1 | 1 |
| C07 | V097 | 0 | 1 | 0 |
| C07 | V119 | 0 | 1 | 1 |
| C07 | V124 | 1 | 1 | 1 |
| C07 | V138 | 42 | 1 | 42 |
| C07 | V158 | 0 | 1 | 0 |
| C07 | V210 | 1 | 0 | 0 |
| C07 | V212 | 4 | 1 | 1 |
| C08 | V056 | 1 | 0 | 0 |
| C08 | V057 | 0 | 1 | 0 |
| C08 | V100 | 79 | 0 | 79 |
| C08 | V118 | 2 | 1 | 0 |
| C08 | V160 | 1 | 0 | 0 |
| C08 | V186 | 3 | 1 | 0 |
| C09 | V006 | 1 | 0 | 0 |
| C09 | V013 | 1 | 0 | 0 |
| C09 | V022 | 1 | 0 | 0 |
| C09 | V024 | 1 | 0 | 0 |
| C09 | V055 | 1 | 0 | 0 |
| C09 | V077 | 1 | 0 | 0 |
| C09 | V079 | 1 | 1 | 0 |
| C09 | V087 | 1 | 0 | 0 |
| C09 | V109 | 1 | 0 | 0 |
| C09 | V117 | 1 | 0 | 0 |
| C09 | V139 | 1 | 0 | 0 |
| C09 | V145 | 10 | 0 | 0 |
| C09 | V167 | 1 | 0 | 0 |
| C09 | V184 | 1 | 0 | 0 |
| C09 | V194 | 1 | 0 | 0 |
| C10 | V072 | 97 | 0 | 97 |
| C10 | V082 | 79 | 0 | 79 |
| C10 | V096 | 1 | 0 | 0 |
| C10 | V116 | 88 | 1 | 0 |
| C10 | V120 | 76 | 0 | 76 |
| C10 | V143 | 1 | 0 | 0 |
| C10 | V144 | 3 | 1 | 0 |
| C10 | V151 | 74 | 1 | 0 |
| C10 | V163 | 60 | 1 | 0 |
| C10 | V169 | 95 | 0 | 95 |
| C11 | V029 | 1 | 1 | 0 |
| C11 | V049 | 1 | 1 | 0 |
| C11 | V052 | 73 | 1 | 74 |
| C11 | V090 | 2 | 0 | 0 |
| C11 | V147 | 1 | 1 | 1 |
| C11 | V164 | 1 | 1 | 1 |
| C11 | V171 | 170 | 1 | 170 |
| C11 | V180 | 1 | 1 | 1 |
| C11 | V211 | 122 | 1 | 122 |
| C12 | V020 | 1 | 1 | 1 |
| C12 | V026 | 1 | 1 | 0 |
| C12 | V040 | 4 | 1 | 1 |
| C12 | V044 | 41 | 0 | 41 |
| C12 | V045 | 64 | 4 | 0 |
| C12 | V094 | 26 | 1 | 26 |
| C12 | V128 | 9 | 1 | 10 |
| C12 | V129 | 77 | 0 | 76 |
| C12 | V131 | 36 | 0 | 36 |
| C12 | V133 | 2 | 1 | 0 |
| C12 | V155 | 0 | 1 | 0 |
| C12 | V182 | 1 | 0 | 0 |
| C12 | V196 | 0 | 1 | 0 |
| C12 | V203 | 1 | 0 | 0 |
| C13 | V038 | 43 | 1 | 0 |
| C13 | V051 | 1 | 0 | 0 |
| C13 | V065 | 1 | 0 | 0 |
| C13 | V066 | 1 | 0 | 0 |
| C13 | V085 | 57 | 0 | 57 |
| C13 | V088 | 1 | 1 | 0 |
| C13 | V104 | 1 | 0 | 0 |
| C13 | V123 | 1 | 0 | 0 |
| C13 | V146 | 1 | 0 | 0 |
| C13 | V176 | 1 | 0 | 0 |
| C13 | V177 | 5 | 1 | 0 |
| C13 | V206 | 1 | 0 | 0 |
| C14 | V037 | 28 | 1 | 28 |
| C14 | V042 | 0 | 1 | 0 |
| C14 | V050 | 5 | 1 | 1 |
| C14 | V078 | 37 | 1 | 37 |
| C14 | V099 | 1 | 0 | 0 |
| C14 | V107 | 1 | 0 | 0 |
| C15 | V018 | 3 | 1 | 1 |
| C15 | V019 | 1 | 1 | 1 |
| C15 | V027 | 1 | 1 | 1 |
| C15 | V031 | 4 | 1 | 1 |
| C15 | V035 | 50 | 1 | 51 |
| C15 | V059 | 56 | 7 | 0 |
| C15 | V081 | 88 | 1 | 88 |
| C15 | V086 | 57 | 1 | 57 |
| C15 | V089 | 59 | 1 | 60 |
| C15 | V113 | 74 | 1 | 74 |
| C15 | V126 | 49 | 1 | 50 |
| C15 | V127 | 5 | 1 | 1 |
| C15 | V188 | 75 | 1 | 76 |
| C15 | V193 | 1 | 1 | 0 |
| C15 | V207 | 1 | 1 | 1 |
| C16 | V032 | 4 | 1 | 0 |
| C17 | V016 | 0 | 1 | 1 |
| C17 | V033 | 16 | 1 | 16 |
| C17 | V039 | 0 | 1 | 1 |
| C17 | V061 | 1 | 1 | 0 |
| C17 | V076 | 15 | 1 | 16 |
| C17 | V110 | 23 | 1 | 23 |
| C17 | V125 | 12 | 1 | 13 |
| C17 | V148 | 23 | 1 | 24 |
| C17 | V153 | 14 | 1 | 15 |
| C17 | V192 | 0 | 1 | 1 |
| C17 | V197 | 20 | 1 | 21 |
| C17 | V198 | 8 | 7 | 1 |
| C17 | V205 | 32 | 1 | 33 |
| C17 | V209 | 23 | 1 | 24 |
| C19 | V003 | 1 | 1 | 0 |
| C19 | V008 | 1 | 0 | 0 |
| C19 | V011 | 1 | 1 | 1 |
| C19 | V014 | 189 | 1 | 189 |
| C19 | V015 | 1 | 1 | 1 |
| C19 | V058 | 1 | 1 | 0 |
| C19 | V074 | 1 | 1 | 0 |
| C19 | V091 | 1 | 1 | 0 |
| C19 | V092 | 1 | 1 | 0 |
| C19 | V102 | 0 | 1 | 0 |
| C19 | V106 | 1 | 1 | 0 |
| C19 | V121 | 1 | 1 | 1 |
| C19 | V150 | 1 | 1 | 0 |
| C19 | V156 | 1 | 1 | 0 |
| C19 | V168 | 345 | 0 | 345 |
| C20 | V009 | 1 | 0 | 0 |
| C20 | V028 | 1 | 0 | 0 |
| C20 | V030 | 63 | 2 | 0 |
| C20 | V070 | 1 | 0 | 0 |
| C20 | V075 | 1 | 1 | 0 |
| C20 | V080 | 31 | 0 | 31 |
| C20 | V083 | 59 | 0 | 59 |
| C20 | V112 | 1 | 0 | 0 |
| C20 | V114 | 102 | 0 | 102 |
| C20 | V166 | 1 | 0 | 0 |
| C20 | V199 | 1 | 0 | 0 |
| C21 | V005 | 1 | 0 | 0 |
| C21 | V007 | 1 | 0 | 0 |
| C21 | V017 | 1 | 0 | 0 |
| C21 | V034 | 1 | 1 | 0 |
| C21 | V041 | 9 | 0 | 9 |
| C21 | V043 | 1 | 0 | 0 |
| C21 | V047 | 1 | 0 | 0 |
| C21 | V054 | 14 | 0 | 14 |
| C21 | V062 | 1 | 0 | 0 |
| C21 | V063 | 1 | 0 | 0 |
| C21 | V064 | 36 | 0 | 36 |
| C21 | V067 | 1 | 0 | 0 |
| C21 | V071 | 24 | 0 | 24 |
| C21 | V098 | 37 | 0 | 0 |
| C21 | V111 | 2 | 1 | 0 |
| C21 | V132 | 1 | 0 | 0 |
| C21 | V136 | 1 | 0 | 0 |
| C21 | V137 | 1 | 0 | 0 |
| C21 | V140 | 21 | 0 | 21 |
| C21 | V142 | 23 | 0 | 23 |
| C21 | V149 | 20 | 0 | 20 |
| C21 | V161 | 29 | 0 | 28 |
| C21 | V174 | 1 | 0 | 0 |
| C21 | V175 | 12 | 0 | 12 |
| C21 | V179 | 0 | 1 | 0 |
| C21 | V185 | 1 | 0 | 0 |
| C21 | V189 | 1 | 0 | 0 |
| C21 | V190 | 1 | 0 | 0 |
| C21 | V191 | 7 | 0 | 7 |
| C21 | V195 | 35 | 0 | 35 |
| C21 | V200 | 1 | 0 | 0 |
| C21 | V202 | 16 | 1 | 0 |
| C21 | V213 | 1 | 1 | 0 |
| C22 | V002 | 1 | 1 | 0 |
| C22 | V069 | 136 | 1 | 135 |
| C22 | V103 | 0 | 1 | 0 |
| C22 | V108 | 1 | 1 | 0 |
| C22 | V115 | 0 | 1 | 0 |
| C22 | V130 | 1 | 1 | 1 |
| C22 | V135 | 71 | 1 | 0 |
| C22 | V170 | 1 | 1 | 1 |
| C22 | V178 | 3 | 1 | 0 |
| C23 | V101 | 1 | 0 | 0 |
| C23 | V159 | 1 | 1 | 0 |
| C23 | V162 | 1 | 1 | 0 |
| C23 | V173 | 1 | 0 | 0 |
| C23 | V183 | 10 | 1 | 1 |

</details>

<details>
<summary>50 sampled rows and verdicts</summary>

| Sample | Type | Channel | Draft age | Verdict and reason |
| --- | --- | --- | --- | --- |
| S01 | keyword | C20 | 15–30d | K-TYPE. Brand label lifts a fragment from the name of a color standard. |
| S02 | keyword | C15 | 0–2d | PASS. Product generation is identified by explicit watch context. |
| S03 | keyword | C07 | 15–30d | K-NAME. Caption spelling leaves the branded rig identity ambiguous. |
| S04 | keyword | C06 | 0–2d | PASS. Brand is explicitly named in the discussion. |
| S05 | keyword | C09 | 0–2d | EMPTY. Invalid JSON. |
| S06 | keyword | C19 | 0–2d | PASS. Concrete home-video format is useful as a category. |
| S07 | keyword | C20 | 0–2d | K-TYPE. Named wallpaper is categorized as a general category. |
| S08 | keyword | C11 | 15–30d | PASS. The named work-surface product is explicit in context. |
| S09 | keyword | C04 | 0–2d | PASS. Vehicle brand is unambiguous in the introduction. |
| S10 | keyword | C17 | 0–2d | K-TYPE. Country abbreviation in a price is treated as a technology category. |
| S11 | keyword | C21 | 3–14d | EMPTY. Unresolved charge. |
| S12 | keyword | C10 | 15–30d | PASS. Operating-system technology is named explicitly. |
| S13 | keyword | C14 | 0–2d | K-TYPE. A generic device category is classified as a specific product. |
| S14 | keyword | C23 | 15–30d | K-PERSON. Incidental family nickname. |
| S15 | keyword | C23 | 0–2d | EMPTY. Unresolved charge. |
| S16 | keyword | C06 | 15–30d | EMPTY. Incomplete coverage. |
| S17 | keyword | C07 | 0–2d | K-PERSON. Incidental first name. |
| S18 | keyword | C22 | 0–2d | PASS. The connector standard is explicit. |
| S19 | keyword | C11 | 0–2d | PASS. The GPU model and its function are explicit. |
| S20 | keyword | C21 | 0–2d | PASS. Retailer brand is explicitly named. |
| S21 | keyword | C18 | 15–30d | K-PERSON. Person name is presented as a category. |
| S22 | keyword | C12 | 15–30d | PASS. Concrete technology is explicit and relevant. |
| S23 | keyword | C08 | 0–2d | PASS. Recognizable game franchise occurs in the full game title. |
| S24 | keyword | C03 | 0–2d | K-TYPE. Store compatibility badge is classified as a technology. |
| S25 | keyword | C02 | 3–14d | EMPTY. Unresolved charge. |
| S26 | keyword | C05 | 0–2d | K-TYPE. A named online platform is classified as a generic technology. |
| S27 | keyword | C21 | 31d+ | K-NAME. GPU series fragment leaves the intended model family ambiguous as written. |
| S28 | keyword | C21 | 15–30d | K-TYPE. Incidental crowdfunding reference is classified as a technology. |
| S29 | keyword | C05 | 15–30d | K-NAME. Transcribed product spelling requires correction. |
| S30 | keyword | C10 | 0–2d | PASS. Publisher name is explicit in the game discussion. |
| S31 | keyword | C20 | 3–14d | EMPTY. Unresolved charge. |
| S32 | keyword | C14 | 15–30d | K-NAME. Caption fragment fails to identify a credible brand. |
| S33 | keyword | C17 | 15–30d | EMPTY. Unsupported mention. |
| S34 | keyword | C02 | 15–30d | EMPTY. Unresolved charge. |
| S35 | keyword | C13 | 0–2d | K-NAME. Transcript spelling conflicts with the product name in the archived title. |
| S36 | recap | C20 | 15–30d | R-QUOTE. The quotes omit the named devices or announcement attribution. |
| S37 | recap | C15 | 0–2d | R-CONTEXT. Adjacent transcript qualifies the claim that every cable failed. |
| S38 | recap | C06 | 0–2d | EMPTY. No usable takeaway. |
| S39 | recap | C19 | 0–2d | EMPTY. Checker altered the finding. |
| S40 | recap | C16 | 0–2d | EMPTY. Unresolved charge. |
| S41 | recap | C04 | 0–2d | EMPTY. Output capacity. |
| S42 | recap | C17 | 0–2d | R-QUOTE. A quote explains the overload test and omits the claimed result. |
| S43 | recap | C10 | 15–30d | R-QUOTE. Quotes omit a promised fix and a regulatory detail asserted by the draft. |
| S44 | recap | C14 | 0–2d | EMPTY. Invalid JSON. |
| S45 | recap | C23 | 15–30d | EMPTY. Unsupported takeaway timing. |
| S46 | recap | C23 | 0–2d | EMPTY. Checker altered the finding. |
| S47 | recap | C06 | 15–30d | EMPTY. Budget stop. |
| S48 | recap | C07 | 0–2d | EMPTY. Unresolved charge. |
| S49 | recap | C22 | 0–2d | R-QUOTE. Attached quotes omit the causal lead-in and the named speaker. |
| S50 | recap | C11 | 0–2d | EMPTY. Invalid JSON. |

</details>

## Exact evidence SQL

The successful reads below return private audit fields for authorized local inspection. Keep raw results outside the repository. The inventory was captured at 03:52:53 UTC, the sample at 03:50:47 UTC, and the #47 dry run at 03:54:25 UTC. The protected and train-target reads completed before 04:00 UTC.

<details>
<summary>Inbox baseline and function presence</summary>

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '12s';
WITH archive_keys AS (
  SELECT DISTINCT jsonb_object_keys(record) AS key
  FROM (SELECT record FROM public.reader_source_updates WHERE record->>'contentKind' = 'transcript' LIMIT 30) a
)
SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at,
  (SELECT jsonb_object_agg(origin || '/' || kind, n) FROM (SELECT origin, kind, count(*) n FROM public.admin_analysis_review_queue WHERE status='pending' GROUP BY 1,2) x) AS visible_queue,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT coalesce(provenance->>'origin','(missing)') AS origin, kind,
    created_at::date AS utc_day, count(*) AS rows, count(DISTINCT (user_id, update_id)) AS updates
    FROM public.admin_analysis_reviews WHERE status='pending' GROUP BY 1,2,3 ORDER BY 3,1,2) x) AS analysis_pending,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT created_at::date AS utc_day, state, task, error_code, count(*) n
    FROM public.automatic_content_tasks GROUP BY 1,2,3,4 ORDER BY 1,2,3,4) x) AS auto_tasks,
  (SELECT jsonb_agg(key ORDER BY key) FROM archive_keys) AS archive_keys,
  (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.daily_briefings GROUP BY status) x) AS daily_status,
  (SELECT jsonb_agg(column_name ORDER BY ordinal_position) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='daily_briefings') AS daily_columns,
  to_regprocedure('public.admin_video_review_score(public.admin_analysis_reviews,public.reader_source_updates)') IS NOT NULL AS batch_score_installed,
  to_regprocedure('public.prepare_video_analysis_proof(uuid,text,text,jsonb)') IS NOT NULL AS proof_prepare_installed;
ROLLBACK;
```

</details>

<details>
<summary>Counts, source integrity and broad train overlap</summary>

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH inbox AS MATERIALIZED (
  SELECT * FROM public.admin_analysis_review_queue WHERE status='pending'
), pending AS MATERIALIZED (
  SELECT q.*, coalesce(r.user_id, k.user_id) AS owner_key,
    coalesce(r.update_id, k.update_id) AS update_key,
    coalesce(r.source_id, k.source_id) AS channel_key,
    coalesce(r.content_hash, k.content_hash) AS draft_hash,
    r.annotation_snapshot,
    r.provenance->>'origin' AS provenance_origin,
    CASE WHEN split_part(r.dedupe_key, ':', 2) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      THEN split_part(r.dedupe_key, ':', 2)::uuid END AS task_id
  FROM inbox q
  LEFT JOIN public.admin_analysis_reviews r ON q.origin='analysis' AND r.id=q.id
  LEFT JOIN public.admin_keyword_reviews k ON q.origin='legacy_keyword' AND k.id=q.id
  WHERE q.status='pending'
), archive AS MATERIALIZED (
  SELECT a.user_id, a.id, a.source_id, a.record->>'url' AS archive_url,
    jsonb_build_object('videoHighlights',a.record->'videoHighlights','videoSummary',a.record->'videoSummary') AS annotation,
    encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') AS current_hash
  FROM (SELECT DISTINCT owner_key, update_key FROM pending) p
  JOIN public.reader_source_updates a ON (a.user_id,a.id)=(p.owner_key,p.update_key)
), task_context AS MATERIALIZED (
  SELECT t.user_id, t.update_id, t.content_hash, true AS attempted,
    bool_or(t.created_at >= timestamptz '2026-11-25T00:00:00Z' AND
      t.error_code='keyword_learning_storage_unavailable') AS storage_50,
    bool_or(t.created_at >= timestamptz '2026-11-25T00:00:00Z' AND
      t.error_code='analysis_output_capacity' AND t.task='recap') AS capacity_50,
    bool_or(c.id IS NOT NULL AND c.actual_usd IS NULL) AS unresolved
  FROM public.automatic_content_tasks t
  LEFT JOIN public.keyword_learning_requests req ON req.session_id=t.session_id
  LEFT JOIN public.reader_content_analysis_calls c ON c.id=req.call_id
  GROUP BY 1,2,3
), classified AS MATERIALIZED (
  SELECT p.*, a.current_hash, a.id IS NULL AS orphan,
    a.source_id IS DISTINCT FROM p.channel_key AS channel_changed,
    a.current_hash IS NOT NULL AND a.current_hash IS DISTINCT FROM p.draft_hash AS stale_text,
    p.kind='recap' AND p.annotation_snapshot IS DISTINCT FROM
      a.annotation AS annotation_changed,
    coalesce(nullif(p.source_url,''),p.origin||':'||p.id::text) AS ui_group,
    coalesce(substring(a.archive_url FROM '^https://(?:(?:www[.]|m[.])?youtube[.]com/(?:watch[?]v=|shorts/)|youtu[.]be/)([A-Za-z0-9_-]{11})(?:$|[?&#/])'),
      substring(p.source_url FROM '^https://(?:(?:www[.]|m[.])?youtube[.]com/(?:watch[?]v=|shorts/)|youtu[.]be/)([A-Za-z0-9_-]{11})(?:$|[?&#/])')) AS video_id,
    CASE WHEN p.created_at >= transaction_timestamp()-interval '2 days' THEN '0–2d'
      WHEN p.created_at >= transaction_timestamp()-interval '14 days' THEN '3–14d'
      WHEN p.created_at >= transaction_timestamp()-interval '30 days' THEN '15–30d' ELSE '31d+' END AS age,
    t.created_at AS task_created_at, t.state AS task_state, t.error_code AS task_error,
    p.provenance_origin='automatic_content' AND t.created_at >= timestamptz '2026-11-25T00:00:00Z' AS november_task,
    coalesce(p.provenance_origin='automatic_content' AND p.created_at >= timestamptz '2026-11-11T00:00:00Z'
      AND p.created_at < timestamptz '2026-11-12T00:00:00Z', false) AS nov11_protected_cohort,
    coalesce(saved.unresolved,false) AS unresolved_same_revision,
    coalesce(current_tasks.storage_50,false) AS storage_50_current,
    coalesce(current_tasks.capacity_50,false) AS capacity_50_current,
    coalesce(current_tasks.attempted,false) AS auto_attempt_current,
    CASE WHEN a.current_hash IS NOT NULL AND a.current_hash IS DISTINCT FROM p.draft_hash THEN EXISTS (
      SELECT 1 FROM public.admin_analysis_reviews n
      WHERE (n.user_id,n.update_id,n.content_hash,n.kind)=(p.owner_key,p.update_key,a.current_hash,p.kind)
        AND n.status IN ('pending','approved') AND n.proposal<>'{}'::jsonb
        AND (n.kind='recap' OR public.keyword_review_label_key(n.proposal->>'label')=
          public.keyword_review_label_key(p.proposal->>'label'))
    ) ELSE false END AS current_counterpart
  FROM pending p
  LEFT JOIN archive a ON (a.user_id,a.id)=(p.owner_key,p.update_key)
  LEFT JOIN public.automatic_content_tasks t ON t.id=p.task_id AND p.provenance_origin='automatic_content'
    AND (t.user_id,t.update_id,t.content_hash,t.task)=(p.owner_key,p.update_key,p.draft_hash,
      CASE p.kind WHEN 'keyword' THEN 'keywords' ELSE 'recap' END)
  LEFT JOIN task_context saved ON (saved.user_id,saved.update_id,saved.content_hash)=(p.owner_key,p.update_key,p.draft_hash)
  LEFT JOIN task_context current_tasks ON (current_tasks.user_id,current_tasks.update_id,current_tasks.content_hash)=(p.owner_key,p.update_key,a.current_hash)
), ranked AS MATERIALIZED (
  SELECT *,
    CASE WHEN proposal<>'{}'::jsonb THEN row_number() OVER (
      PARTITION BY owner_key,update_key,draft_hash,kind,
        CASE WHEN kind='keyword' THEN jsonb_build_array(public.keyword_review_label_key(proposal->>'label'),proposal->>'kind')
             ELSE proposal END
      ORDER BY (origin='analysis') DESC, created_at,id
    ) ELSE 1 END AS exact_copy_number,
    CASE WHEN kind='keyword' AND nullif(proposal->>'label','') IS NOT NULL THEN
      min(proposal->>'kind') OVER keyword_identity IS DISTINCT FROM max(proposal->>'kind') OVER keyword_identity
      ELSE false END AS competing_keyword_kind
  FROM classified
  WINDOW keyword_identity AS (PARTITION BY owner_key,update_key,draft_hash,public.keyword_review_label_key(proposal->>'label'))
), labeled AS MATERIALIZED (
  SELECT *,
    'C'||lpad(dense_rank() OVER (ORDER BY channel_key)::text,2,'0') AS channel_alias,
    CASE WHEN video_id IS NOT NULL THEN 'V'||lpad(dense_rank() OVER (ORDER BY video_id NULLS LAST)::text,3,'0') END AS video_alias,
    CASE WHEN nov11_protected_cohort OR unresolved_same_revision THEN '1 protected'
      WHEN orphan OR channel_changed THEN '2 orphan or channel changed'
      WHEN stale_text AND current_counterpart THEN '3 superseded with counterpart'
      WHEN stale_text OR annotation_changed THEN '4 other source or recap drift'
      WHEN exact_copy_number>1 AND NOT competing_keyword_kind THEN '5 extra exact duplicate'
      WHEN competing_keyword_kind THEN '6 competing keyword types'
      ELSE '7 remaining current or manual' END AS triage
  FROM ranked
)
SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT age, kind, count(*) AS rows,
    count(DISTINCT video_id) AS youtube_videos, count(DISTINCT ui_group) AS ui_groups
    FROM labeled GROUP BY 1,2 ORDER BY 1,2) x) AS by_age_type,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT channel_alias, min(channel_key) AS channel_key,
    count(*) AS rows, count(*) FILTER (WHERE video_id IS NULL) AS other_rows,
    count(DISTINCT video_id) AS youtube_videos, count(DISTINCT ui_group) AS ui_groups,
    count(*) FILTER (WHERE kind='keyword') AS keywords, count(*) FILTER (WHERE kind='recap') AS recaps,
    count(*) FILTER (WHERE november_task AND task_state='review' AND proposal<>'{}') AS november_drafts
    FROM labeled GROUP BY 1 ORDER BY 1) x) AS by_channel,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT channel_alias, video_alias,
    count(*) FILTER (WHERE kind='keyword') AS keywords, count(*) FILTER (WHERE kind='recap') AS recaps,
    count(*) FILTER (WHERE november_task AND task_state='review' AND proposal<>'{}') AS november_drafts
    FROM labeled WHERE video_id IS NOT NULL GROUP BY 1,2 ORDER BY 1,2) x) AS by_video,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT triage, count(*) AS rows, count(DISTINCT ui_group) AS ui_groups,
    count(DISTINCT video_id) AS youtube_videos, count(*) FILTER (WHERE kind='keyword') AS keywords,
    count(*) FILTER (WHERE kind='recap') AS recaps, count(*) FILTER (WHERE november_task) AS november_rows
    FROM labeled GROUP BY 1 ORDER BY 1) x) AS by_triage,
  (SELECT to_jsonb(x) FROM (SELECT count(*) AS rows, count(DISTINCT ui_group) AS ui_groups,
    count(DISTINCT video_id) AS youtube_videos,
    count(*) FILTER (WHERE video_id IS NULL) AS non_youtube_rows,
    count(*) FILTER (WHERE orphan) AS orphan_rows,
    count(*) FILTER (WHERE channel_changed AND NOT orphan) AS source_mismatch_rows,
    count(*) FILTER (WHERE stale_text) AS stale_text_rows,
    count(*) FILTER (WHERE annotation_changed) AS annotation_drift_rows,
    count(*) FILTER (WHERE stale_text AND annotation_changed) AS both_drift_rows,
    count(*) FILTER (WHERE stale_text AND current_counterpart) AS stale_with_counterpart_rows,
    count(*) FILTER (WHERE exact_copy_number>1) AS exact_duplicates,
    count(*) FILTER (WHERE competing_keyword_kind) AS conflicting_types,
    count(*) FILTER (WHERE unresolved_same_revision) AS unresolved_rows,
    count(*) FILTER (WHERE nov11_protected_cohort) AS nov11_rows,
    count(*) FILTER (WHERE november_task AND task_state='review' AND proposal<>'{}') AS november_drafts,
    count(DISTINCT video_id) FILTER (WHERE november_task AND task_state='review' AND proposal<>'{}') AS november_videos,
    count(*) FILTER (WHERE november_task AND (task_state<>'review' OR proposal='{}')) AS november_other,
    count(*) FILTER (WHERE proposal='{}') AS empty_rows,
    min(created_at) AS oldest, max(created_at) AS newest,
    count(*) FILTER (WHERE storage_50_current) AS pr50_storage_rows,
    count(DISTINCT video_id) FILTER (WHERE storage_50_current) AS pr50_storage_videos,
    count(*) FILTER (WHERE capacity_50_current) AS pr50_capacity_recap_rows,
    count(DISTINCT video_id) FILTER (WHERE capacity_50_current) AS pr50_capacity_recap_videos,
    count(*) FILTER (WHERE NOT auto_attempt_current AND video_id IS NOT NULL AND current_hash IS NOT NULL) AS pr51_pre_manifest_rows,
    count(DISTINCT video_id) FILTER (WHERE NOT auto_attempt_current AND video_id IS NOT NULL AND current_hash IS NOT NULL) AS pr51_pre_manifest_videos
    FROM labeled) x) AS totals,
  (SELECT count(*) FROM (SELECT id,'analysis' AS origin FROM public.admin_analysis_reviews WHERE status='pending'
    UNION ALL SELECT id,'legacy_keyword' FROM public.admin_keyword_reviews WHERE status='pending') raw
    WHERE NOT EXISTS (SELECT 1 FROM pending p WHERE (p.origin,p.id)=(raw.origin,raw.id))) AS hidden_pending,
  (SELECT to_jsonb(x) FROM (SELECT count(*) AS rows, count(published_at) AS published,
    count(*) FILTER (WHERE status='awaiting_review') AS held, max(local_date) AS last_date
    FROM public.daily_briefings) x) AS daily;
ROLLBACK;
```

</details>

<details>
<summary>Deterministic sample and bounded supporting evidence</summary>

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH population AS MATERIALIZED (
  SELECT q.*, coalesce(r.user_id,k.user_id) AS owner_key,
    coalesce(r.update_id,k.update_id) AS update_key,
    coalesce(r.source_id,k.source_id) AS channel_key,
    coalesce(r.content_hash,k.content_hash) AS draft_hash,
    r.source_snapshot, r.job_id, k.evidence_quote AS legacy_quote,
    CASE WHEN q.created_at >= transaction_timestamp()-interval '2 days' THEN '0–2d'
      WHEN q.created_at >= transaction_timestamp()-interval '14 days' THEN '3–14d'
      WHEN q.created_at >= transaction_timestamp()-interval '30 days' THEN '15–30d' ELSE '31d+' END AS age
  FROM public.admin_analysis_review_queue q
  LEFT JOIN public.admin_analysis_reviews r ON q.origin='analysis' AND r.id=q.id
  LEFT JOIN public.admin_keyword_reviews k ON q.origin='legacy_keyword' AND k.id=q.id
  WHERE q.status='pending'
), within_stratum AS (
  SELECT *,
    'C'||lpad(dense_rank() OVER (ORDER BY channel_key)::text,2,'0') AS channel_alias,
    count(*) OVER (PARTITION BY kind,channel_key,age) AS stratum_size,
    row_number() OVER (PARTITION BY kind,channel_key,age
      ORDER BY md5('flow5-2026-11-26/'||id::text),id) AS stratum_rank
  FROM population
), by_kind AS (
  SELECT *, row_number() OVER (PARTITION BY kind ORDER BY
    (stratum_rank-1)::numeric/stratum_size, md5('flow5-stratum/'||channel_key||'/'||age),id) AS kind_rank
  FROM within_stratum
), chosen AS MATERIALIZED (
  SELECT *, row_number() OVER (ORDER BY kind,kind_rank) AS sample_number
  FROM by_kind WHERE kind_rank <= CASE kind WHEN 'keyword' THEN 35 ELSE 15 END
), bound AS MATERIALIZED (
  SELECT s.*, a.record AS current_record,
    a.source_id AS current_channel, a.id IS NOT NULL AS archive_exists,
    CASE WHEN encode(sha256(convert_to(s.source_snapshot->>'content','UTF8')),'hex')=s.draft_hash
      THEN s.source_snapshot
      WHEN encode(sha256(convert_to(p.source_snapshot->>'content','UTF8')),'hex')=s.draft_hash
      THEN p.source_snapshot
      WHEN encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=s.draft_hash THEN a.record
      END AS evidence_record,
    encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')=s.draft_hash AS current_text
  FROM chosen s
  LEFT JOIN public.reader_source_updates a ON (a.user_id,a.id)=(s.owner_key,s.update_key)
  LEFT JOIN LATERAL (
    SELECT p.source_snapshot FROM public.admin_analysis_prompt_receipts p
    WHERE p.job_id=s.job_id AND p.source_snapshot IS NOT NULL ORDER BY p.created_at,p.id LIMIT 1
  ) p ON s.source_snapshot IS NULL
), evidence AS (
  SELECT s.*, s.evidence_record->>'content' AS body,
    regexp_replace(s.evidence_record->>'content','[[:space:]]+',' ','g') AS flat_body,
    s.proposal->>'label' AS keyword
  FROM bound s
)
SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT kind, count(*) AS strata, sum(n) AS rows
    FROM (SELECT kind,channel_key,age,count(*) n FROM population GROUP BY 1,2,3) agg GROUP BY 1 ORDER BY 1) x) AS population,
  (SELECT jsonb_agg(to_jsonb(x) ORDER BY sample_number) FROM (
    SELECT sample_number, id, origin, kind, channel_alias, age, stratum_size, created_at,
      left(reason,240) AS reason, source_url, source_title, current_record->>'url' AS current_url,
      evidence_record->>'url' AS evidence_url, evidence_record->>'contentKind' AS evidence_kind,
      archive_exists, current_channel=channel_key AS channel_matches, current_text,
      body IS NOT NULL AS exact_evidence, proposal='{}'::jsonb AS empty_attempt, keyword,
      proposal->>'kind' AS keyword_kind,
      CASE WHEN kind='keyword' THEN legacy_quote END AS legacy_quote,
      CASE WHEN kind='keyword' AND nullif(keyword,'') IS NOT NULL THEN (
        SELECT jsonb_agg(context ORDER BY n) FROM (
          SELECT ord AS n,right(part,140)||keyword||left(next_part,140) AS context
          FROM (SELECT part,ord,lead(part) OVER (ORDER BY ord) AS next_part
                FROM unnest(string_to_array(flat_body,keyword)) WITH ORDINALITY u(part,ord)) exact
          WHERE next_part IS NOT NULL ORDER BY ord LIMIT 4
        ) snippets
      ) END AS keyword_contexts,
      CASE WHEN kind='recap' AND jsonb_typeof(proposal->'highlights')='array' THEN (
        SELECT jsonb_agg(jsonb_build_object(
          'claim', item->>'text', 'quote', item->>'evidenceQuote',
          'position', nullif(strpos(body,nullif(item->>'evidenceQuote','')),0),
          'context', CASE WHEN strpos(body,nullif(item->>'evidenceQuote','')) > 0 THEN
            substring(body FROM greatest(1,strpos(body,item->>'evidenceQuote')-165)
              FOR char_length(item->>'evidenceQuote')+330) END
        ) ORDER BY ord)
        FROM jsonb_array_elements(proposal->'highlights') WITH ORDINALITY highlights(item,ord)
      ) END AS recap_points
    FROM evidence
  ) x) AS sample;
ROLLBACK;
```

</details>

<details>
<summary>Exact #47 scoring conditions and page order</summary>

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '18s';
WITH new_tasks AS MATERIALIZED (
  SELECT id, user_id, update_id, content_hash, task, state
  FROM public.automatic_content_tasks
  WHERE created_at >= timestamptz '2026-11-25T00:00:00Z'
), targets AS MATERIALIZED (
  SELECT r.id, r.kind, r.proposal, r.reason, r.user_id, r.update_id, r.source_id, r.content_hash,
    r.source_snapshot, r.provenance, r.created_at, t.state
  FROM public.admin_analysis_reviews r
  JOIN new_tasks t ON split_part(r.dedupe_key,':',2)=t.id::text
    AND (t.user_id,t.update_id,t.content_hash,t.task)=(r.user_id,r.update_id,r.content_hash,
      CASE r.kind WHEN 'keyword' THEN 'keywords' ELSE 'recap' END)
  WHERE r.status='pending' AND r.provenance->>'origin'='automatic_content'
    AND NOT (r.kind='keyword' AND EXISTS (
      SELECT 1 FROM public.admin_keyword_reviews k
      WHERE (k.user_id,k.update_id,k.content_hash)=(r.user_id,r.update_id,r.content_hash)
        AND k.status<>'pending'
        AND (k.normalized_label=public.keyword_review_label_key(r.proposal->>'label') OR
          (k.status='approved' AND public.keyword_review_label_key(k.resolved_label)=public.keyword_review_label_key(r.proposal->>'label')))
    ))
), archive AS MATERIALIZED (
  SELECT a.user_id, a.id, a.source_id, a.record->>'url' AS url, a.record->>'contentKind' AS content_kind,
    a.record->>'content' AS content, encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') AS current_hash
  FROM (SELECT DISTINCT user_id, update_id FROM targets) t
  JOIN public.reader_source_updates a ON (a.user_id,a.id)=(t.user_id,t.update_id)
), scored AS MATERIALIZED (
  SELECT r.id, r.kind, coalesce(nullif(coalesce(r.source_snapshot->>'url',a.url),''),'analysis:'||r.id::text) AS ui_group,
    r.created_at, r.state, r.proposal='{}'::jsonb AS empty,
    case when r.id is null or r.provenance->>'origin' is distinct from 'automatic_content'
      or a.content_kind is distinct from 'transcript'
      or coalesce(a.url, '') !~ '^https://(www[.]|m[.])?youtube[.]com/(watch[?]v=|shorts/)|^https://youtu[.]be/'
      or a.source_id is distinct from r.source_id
      or a.current_hash is distinct from r.content_hash
      or encode(sha256(convert_to(r.source_snapshot->>'content', 'UTF8')), 'hex') is distinct from r.content_hash
    then null
    when r.kind = 'keyword' and r.reason like 'The AI checker accepted this %'
      and (r.proposal->>'label') ~ '^[!-~]([ -~]{0,98}[!-~])?$'
      and (r.proposal->>'label') ~ '[A-Za-z0-9]'
      and coalesce(r.proposal->>'kind', '') in ('brand', 'product', 'game', 'technology', 'category')
      and exists (
        select 1 from (
          select part, ord, lead(part) over (order by ord) as next_part, count(*) over () as parts
          from unnest(string_to_array(a.content, r.proposal->>'label')) with ordinality as f(part, ord)
        ) matches
        where ord < parts
          and (right(part, 1) ~ '[[:space:],;:!?()"/-]' or (part = '' and ord = 1)
            or (right(part, 1) = '.' and left(r.proposal->>'label', 1) !~ '[0-9]'))
          and (left(next_part, 1) ~ '[[:space:],;:!?()"/-]' or (next_part = '' and ord = parts - 1)
            or (left(next_part, 1) = '.' and right(r.proposal->>'label', 1) !~ '[0-9]'))
      ) then 100
    when r.kind = 'recap' and (r.reason like 'The independent AI checker found quote-only support for each retained finding.%'
      or r.reason like 'The independent AI checker found quote-only support for every atomic claim.%')
      and jsonb_typeof(r.proposal->'highlights') = 'array'
      then case when jsonb_array_length(r.proposal->'highlights') between 1 and 6
        and not exists (select 1 from jsonb_array_elements(r.proposal->'highlights') point
          where coalesce(char_length(point->>'evidenceQuote'), 0) < 15
            or strpos(a.content, point->>'evidenceQuote') = 0) then 100 else 50 end
    when r.proposal = '{}'::jsonb and r.reason ~ '^Automatic generation could not provide a validated draft [(]analysis_(invalid_json|output_capacity)[)]' then 0
    else 50
  end AS score
  FROM targets r JOIN archive a ON (a.user_id,a.id)=(r.user_id,r.update_id)
), group_scores AS (
  SELECT ui_group, max(created_at) AS newest,
    count(*) FILTER (WHERE score=100) AS approve,
    count(*) FILTER (WHERE score=0) AS reject
  FROM scored GROUP BY 1
)
SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT score, kind, count(*) AS rows, count(DISTINCT ui_group) AS ui_groups,
    count(*) FILTER (WHERE state='review' AND NOT empty) AS november_drafts
    FROM scored GROUP BY 1,2 ORDER BY 1,2) x) AS by_score,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT score,count(*) AS rows,count(DISTINCT ui_group) AS ui_groups
    FROM scored GROUP BY 1 ORDER BY 1) x) AS by_score_total,
  (SELECT jsonb_agg(to_jsonb(g) ORDER BY newest DESC,ui_group) FROM group_scores g) AS batch_groups,
  (SELECT count(*) FROM scored) AS matched;
ROLLBACK;
```

</details>

<details>
<summary>Same-revision unsettled rows checked against #47 shortcuts</summary>

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
WITH new_tasks AS MATERIALIZED (
  SELECT id, user_id, update_id, content_hash, task, state
  FROM public.automatic_content_tasks
  WHERE created_at >= timestamptz '2026-11-25T00:00:00Z'
), unresolved AS MATERIALIZED (
  SELECT DISTINCT t.user_id,t.update_id,t.content_hash
  FROM public.automatic_content_tasks t
  JOIN public.keyword_learning_requests req ON req.session_id=t.session_id
  JOIN public.reader_content_analysis_calls c ON c.id=req.call_id
  WHERE c.actual_usd IS NULL
), targets AS MATERIALIZED (
  SELECT r.id, r.kind, r.proposal, r.reason, r.user_id, r.update_id, r.source_id, r.content_hash,
    r.source_snapshot, r.provenance, r.created_at, t.state
  FROM public.admin_analysis_reviews r
  JOIN new_tasks t ON split_part(r.dedupe_key,':',2)=t.id::text
    AND (t.user_id,t.update_id,t.content_hash,t.task)=(r.user_id,r.update_id,r.content_hash,
      CASE r.kind WHEN 'keyword' THEN 'keywords' ELSE 'recap' END)
  JOIN unresolved hold ON (hold.user_id,hold.update_id,hold.content_hash)=(r.user_id,r.update_id,r.content_hash)
  WHERE r.status='pending' AND r.provenance->>'origin'='automatic_content'
    AND NOT (r.kind='keyword' AND EXISTS (
      SELECT 1 FROM public.admin_keyword_reviews k
      WHERE (k.user_id,k.update_id,k.content_hash)=(r.user_id,r.update_id,r.content_hash)
        AND k.status<>'pending'
        AND (k.normalized_label=public.keyword_review_label_key(r.proposal->>'label') OR
          (k.status='approved' AND public.keyword_review_label_key(k.resolved_label)=public.keyword_review_label_key(r.proposal->>'label')))
    ))
), archive AS MATERIALIZED (
  SELECT a.user_id, a.id, a.source_id, a.record->>'url' AS url, a.record->>'contentKind' AS content_kind,
    a.record->>'content' AS content, encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') AS current_hash
  FROM (SELECT DISTINCT user_id, update_id FROM targets) t
  JOIN public.reader_source_updates a ON (a.user_id,a.id)=(t.user_id,t.update_id)
), scored AS MATERIALIZED (
  SELECT r.id, r.kind, coalesce(nullif(coalesce(r.source_snapshot->>'url',a.url),''),'analysis:'||r.id::text) AS ui_group,
    r.created_at, r.state, r.proposal='{}'::jsonb AS empty, true AS unresolved,
    case when r.id is null or r.provenance->>'origin' is distinct from 'automatic_content'
      or a.content_kind is distinct from 'transcript'
      or coalesce(a.url, '') !~ '^https://(www[.]|m[.])?youtube[.]com/(watch[?]v=|shorts/)|^https://youtu[.]be/'
      or a.source_id is distinct from r.source_id
      or a.current_hash is distinct from r.content_hash
      or encode(sha256(convert_to(r.source_snapshot->>'content', 'UTF8')), 'hex') is distinct from r.content_hash
    then null
    when r.kind = 'keyword' and r.reason like 'The AI checker accepted this %'
      and (r.proposal->>'label') ~ '^[!-~]([ -~]{0,98}[!-~])?$'
      and (r.proposal->>'label') ~ '[A-Za-z0-9]'
      and coalesce(r.proposal->>'kind', '') in ('brand', 'product', 'game', 'technology', 'category')
      and exists (
        select 1 from (
          select part, ord, lead(part) over (order by ord) as next_part, count(*) over () as parts
          from unnest(string_to_array(a.content, r.proposal->>'label')) with ordinality as f(part, ord)
        ) matches
        where ord < parts
          and (right(part, 1) ~ '[[:space:],;:!?()"/-]' or (part = '' and ord = 1)
            or (right(part, 1) = '.' and left(r.proposal->>'label', 1) !~ '[0-9]'))
          and (left(next_part, 1) ~ '[[:space:],;:!?()"/-]' or (next_part = '' and ord = parts - 1)
            or (left(next_part, 1) = '.' and right(r.proposal->>'label', 1) !~ '[0-9]'))
      ) then 100
    when r.kind = 'recap' and (r.reason like 'The independent AI checker found quote-only support for each retained finding.%'
      or r.reason like 'The independent AI checker found quote-only support for every atomic claim.%')
      and jsonb_typeof(r.proposal->'highlights') = 'array'
      then case when jsonb_array_length(r.proposal->'highlights') between 1 and 6
        and not exists (select 1 from jsonb_array_elements(r.proposal->'highlights') point
          where coalesce(char_length(point->>'evidenceQuote'), 0) < 15
            or strpos(a.content, point->>'evidenceQuote') = 0) then 100 else 50 end
    when r.proposal = '{}'::jsonb and r.reason ~ '^Automatic generation could not provide a validated draft [(]analysis_(invalid_json|output_capacity)[)]' then 0
    else 50
  end AS score
  FROM targets r JOIN archive a ON (a.user_id,a.id)=(r.user_id,r.update_id)

), group_scores AS (
  SELECT ui_group, max(created_at) AS newest,
    count(*) FILTER (WHERE score=100) AS approve,
    count(*) FILTER (WHERE score=0) AS reject,
    count(*) FILTER (WHERE score=100 AND unresolved) AS protected_approve,
    count(*) FILTER (WHERE score=0 AND unresolved) AS protected_reject
  FROM scored GROUP BY 1
)
SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at,
  count(*) AS matched_protected,
  count(*) FILTER (WHERE score=100) AS protected_approve,
  count(*) FILTER (WHERE score=0) AS protected_reject,
  count(*) FILTER (WHERE score=50) AS protected_manual,
  count(*) FILTER (WHERE score IS NULL) AS protected_unscored
FROM scored;
ROLLBACK;
```

</details>

<details>
<summary>Static #51 per-video admission and pending overlap</summary>

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
WITH eligible_51 AS MATERIALIZED (
  SELECT a.user_id, a.id
  FROM public.reader_source_updates a
  JOIN public.automatic_content_policies p ON p.user_id=a.user_id AND p.enabled
  JOIN public.reader_workspaces w ON w.user_id=a.user_id
  CROSS JOIN LATERAL (SELECT encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') AS source_hash,
    public.content_analysis_source_revision(a.record) AS source_revision) h
  WHERE a.collected_at >= p.starts_at AND a.record->>'format'='video' AND a.record->>'contentKind'='transcript'
    AND a.record->>'url' ~ '^https://(?:www[.]|m[.])?youtube[.]com/watch[?]v=([A-Za-z0-9_-]{11})(?:[&#]|$)'
    AND public.content_analysis_eligible(w.state,a.record)
    AND NOT EXISTS (SELECT 1 FROM public.automatic_content_tasks t
      WHERE (t.user_id,t.update_id,t.content_hash)=(a.user_id,a.id,h.source_hash))
    AND NOT EXISTS (SELECT 1 FROM public.reader_content_analysis_calls c
      WHERE c.user_id=a.user_id AND c.actual_usd IS NULL
        AND c.source_revision IN (h.source_hash,h.source_revision))
), eligible_raw AS MATERIALIZED (
  SELECT r.id, 'analysis' AS origin
  FROM eligible_51 e JOIN public.admin_analysis_reviews r ON (r.user_id,r.update_id)=(e.user_id,e.id)
  WHERE r.status='pending'
  UNION ALL
  SELECT k.id, 'legacy_keyword'
  FROM eligible_51 e JOIN public.admin_keyword_reviews k ON (k.user_id,k.update_id)=(e.user_id,e.id)
  WHERE k.status='pending'
)
SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at,
  (SELECT count(*) FROM eligible_51) AS pr51_eligible_archives,
  (SELECT count(*) FROM eligible_raw) AS raw_pending_on_eligible_archives;
ROLLBACK;
```

</details>

<details>
<summary>Settled #50 checker request shapes</summary>

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '8s';
WITH eligible_51 AS MATERIALIZED (
  SELECT a.user_id, a.id
  FROM public.reader_source_updates a
  JOIN public.automatic_content_policies p ON p.user_id=a.user_id AND p.enabled
  JOIN public.reader_workspaces w ON w.user_id=a.user_id
  CROSS JOIN LATERAL (SELECT encode(sha256(convert_to(a.record->>'content','UTF8')),'hex') AS source_hash,
    public.content_analysis_source_revision(a.record) AS source_revision) h
  WHERE a.collected_at >= p.starts_at AND a.record->>'format'='video' AND a.record->>'contentKind'='transcript'
    AND a.record->>'url' ~ '^https://(?:www[.]|m[.])?youtube[.]com/watch[?]v=([A-Za-z0-9_-]{11})(?:[&#]|$)'
    AND public.content_analysis_eligible(w.state,a.record)
    AND NOT EXISTS (SELECT 1 FROM public.automatic_content_tasks t
      WHERE (t.user_id,t.update_id,t.content_hash)=(a.user_id,a.id,h.source_hash))
    AND NOT EXISTS (SELECT 1 FROM public.reader_content_analysis_calls c
      WHERE c.user_id=a.user_id AND c.actual_usd IS NULL
        AND c.source_revision IN (h.source_hash,h.source_revision))
), truncations AS MATERIALIZED (
  SELECT t.user_id, t.update_id, t.content_hash, req.request_payload#>>'{request,role}' AS role,
    CASE WHEN pg_input_is_valid(req.request_payload#>>'{request,prompt}','jsonb')
      THEN (req.request_payload#>>'{request,prompt}')::jsonb END AS prompt
  FROM public.automatic_content_tasks t
  JOIN public.keyword_learning_requests req ON req.session_id=t.session_id
  JOIN public.reader_content_analysis_calls c ON c.id=req.call_id
  WHERE t.created_at >= timestamptz '2026-11-25T00:00:00Z'
    AND t.task='recap' AND t.error_code='analysis_output_capacity'
    AND req.error_code='analysis_output_capacity' AND c.actual_usd IS NOT NULL
), single_50 AS MATERIALIZED (
  SELECT DISTINCT user_id, update_id, content_hash FROM truncations WHERE role='checker'
    AND CASE WHEN jsonb_typeof(prompt->'findings')='array' THEN jsonb_array_length(prompt->'findings') END=1
)
SELECT current_setting('transaction_read_only') AS read_only, transaction_timestamp() AS captured_at,
  (SELECT count(*) FROM eligible_51) AS pr51_eligible_archives,
  (SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT role, (prompt IS NOT NULL) AS parsed,
    CASE WHEN jsonb_typeof(prompt->'findings')='array' THEN jsonb_array_length(prompt->'findings') END AS findings,
    count(*) AS calls FROM truncations GROUP BY 1,2,3 ORDER BY 1,2,3) x) AS pr50_saved_truncated_calls,
  (SELECT count(*) FROM single_50) AS pr50_saved_single_archives,
  (SELECT count(*) FROM single_50 s JOIN public.reader_source_updates a ON (a.user_id,a.id)=(s.user_id,s.update_id)
    JOIN public.admin_analysis_reviews r ON (r.user_id,r.update_id)=(s.user_id,s.update_id)
    WHERE s.content_hash=encode(sha256(convert_to(a.record->>'content','UTF8')),'hex')
      AND r.status='pending'
      AND NOT (r.kind='keyword' AND EXISTS (
        SELECT 1 FROM public.admin_keyword_reviews k
        WHERE (k.user_id,k.update_id,k.content_hash)=(r.user_id,r.update_id,r.content_hash) AND k.status<>'pending'
          AND (k.normalized_label=public.keyword_review_label_key(r.proposal->>'label') OR
            (k.status='approved' AND public.keyword_review_label_key(k.resolved_label)=public.keyword_review_label_key(r.proposal->>'label')))
      ))) AS pr50_saved_single_visible_analysis_rows;
ROLLBACK;
```

</details>
