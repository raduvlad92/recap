# Flow 5 draft quality — 26 November 2026

The local replay flagged all 35 drafts the [lane A2 audit](https://github.com/raduvlad92/recap/pull/62) found invalid and kept all 15 it passed. Every flagged draft remains available for individual review. Production writes and provider spend were both zero.

| Draft | A2 valid before | A2 failures flagged | A2 passes kept | Valid among unflagged |
| --- | ---: | ---: | ---: | ---: |
| Keywords | 15/35 (42.9%) | 20/20 (100%) | 15/15 (100%) | 15/15 (100%) |
| Recaps | 0/15 (0%) | 15/15 (100%) | No passing examples | No unflagged recaps |
| Total | 15/50 (30%) | 35/35 (100%) | 15/15 (100%) | 15/15 (100%) |

The guards met the 90% threshold for each rate with a denominator. The guard design used the audit's failure modes, so these are replay results on the development sample. A separate, blinded sample with valid recaps is needed to measure recap retention and check for false holds, especially for paraphrases and languages beyond the English audit. These checks measure review triage. The V1 paired-video gate still needs both usable draft types on each selected video.

## When drafts enter the inbox

The automatic video and social workers both use `generateAutomaticContent`. The extra checks run after existing generation and evidence checks. Saved keyword labels must occur literally in the saved text as whole mentions, with source context consistent with the proposed entity type. A saved title may corroborate an identity when the name also occurs in the original. Each recap sentence is checked against its own exact quote for named subjects, figures, qualifiers, causation and enough matching terms in order. A nearby correction can veto a broad claim. These are conservative lexical checks with limited contextual cues. Some legitimate paraphrases and unfamiliar names will need manual review. Subtle changes in meaning can still slip through.

A flagged row starts its reason with **Needs manual review**, followed by the affected keyword check or point numbers and the prior checker explanation. The worker keeps the proposal, quotes and call keys. In train 2's grouped video queue this reason moves an otherwise eligible row to 50, which keeps it out of the score-100 batch approval shortcut. Deliberate individual review and correction remain available. Earlier rows retain their original reasons and decisions. The offline replay measures potential flags on those historical rows.

This branch uses `origin/t3/train2-on-46` because the worker and its tests overlap [train 2 staging](https://github.com/raduvlad92/recap/pull/57). It belongs in train 3.

## Replay evidence

The export used fixed D01–D50 UUIDs and origin values from A2's private receipt captured at `2026-11-26 04:02:44.981555 UTC`. It matched the saved verdict for every alias to the original row ID, type and origin. The production query selected only those 50 rows and linked each to its archive through reader, update and source keys. It used `BEGIN READ ONLY`, a 12-second local statement timeout and explicit `ROLLBACK`. The capture at `2026-11-26 04:17:02.486459 UTC` returned `transaction_read_only = on` on all 50 rows.

Exact evidence came from the saved review snapshot, its saved prompt snapshot or the matching archive, in that order, using the draft's SHA-256. All 50 also matched the current archive hash. Keyword labels and types and recap claims and quotes matched the earlier private receipt. The sample contains 47 transcripts and three saved feed posts. Both passes used the feed text for those three posts. The mode-0600 fixture held only aliases, verdicts, source text and title, and the proposal fields needed for the guard. Its SHA-256 was `6787e62e625ca687e7362a36050a735f3690348b7c160d17249c65fcf9d00257`. The temporary export and fixture were deleted after scoring.

To reproduce with an authorized private export, use A2's frozen alias-to-row mapping and verdicts. Join `admin_analysis_reviews` or `admin_keyword_reviews` by exact ID and origin, then join `reader_source_updates` by owner, update and source. Check the archived text and any saved review or prompt snapshot against the draft's content hash. Compare the exported proposals to A2's receipt before running the scorer. Pass the results in D01–D50 order, with `id`, `kind`, `expected` (`pass` or `fail`), `source` (`content` and `title`), and `proposal` (`label` and `kind` for keywords, `highlights` with `text` and `evidenceQuote` for recaps).

```sh
node --experimental-strip-types scripts/score-flow5-drafts.mts .local/flow5-a3/fixture.json
```

The scorer runs the same guard functions as the worker. It reads a local file, reports counts and anonymized mismatches, and exits nonzero when a measurable failure or retention rate falls below 90%. An absent denominator is reported as `null`. The production replay spends $0 and generates no new drafts. Separate mocked worker tests check retention of flagged text and receipts. Disposable PostgreSQL tests check that flagged rows stay pending and cannot be batch-approved.
