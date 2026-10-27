# Five-video named-mention improvement loop

**Execution update:** the founder subsequently approved implementation/testing and raised the cumulative cap to US$10. [The completed experiment, scores and actual costs](KEYWORD-LEARNING-RESULTS-2026-10-27.md) supersede the earlier unrun status and US$5 ceiling below. The original proposal is retained as the design checkpoint.

27 October 2026. **Proposed workflow; no new paid experiment or production change has run.** The founder wants five saved transcripts, a 1–10 quality score, diagnosis of failures, better prompts and repeated comparison. The founder clarified the target: **every named mention, including brief mentions and ads**. Importance, airtime and frequency must not decide inclusion.

Use a small evaluation runner and versioned prompt/result files in the existing project. Keep production analysis, twenty-video generation and backfill paused during development. This is prompt improvement with saved feedback, not training new model weights or letting a live service rewrite its own rules indefinitely.

## What changes from the current process

Current `analyzeKeywordsV4` runs two blind inventories using the same keyword policy. `resolveKeywordPasses` accepts a candidate only when both agree on identity/type and both scores clear the threshold. The latest failures show that useful source-present names can be lost behind incorrect first/last lexical-unit IDs, incomplete corrections and oversized request schemas. Existing review-confidence scores are not measured extraction accuracy.

The proposed extractors return literal names as written in the supplied text. Code finds their real occurrences, exact evidence and saved cue times, using the existing whole-identity/punctuation rules. It must distinguish C, C++ and C#, preserve product versions and avoid turning a substring into an unspoken model name. No model-calculated word IDs, character offsets or timestamps are needed from the new extraction prompts. Unmatched names and uncertain spelling/identity stay visible for review; they are not silently guessed or dropped.

Merge the **union** of candidates. A name found by only one method still reaches the checker. Deduplicate repetitions conservatively, retain every source occurrence, and keep parent brands, product families and versions separate when the source actually names them. Existing safeguards and financial history remain; the current production contract is not silently repurposed for new-format outputs.

## Five fixed saved sources

| Ordinal | Video | Saved characters | Role |
| ---: | --- | ---: | --- |
| 1 | Vetroo 850W Power Supply - LABS Test Report | 3,322 | Development: spelling noise, standards, sponsor/domain |
| 2 | Everything Apple Announced last week - M4 Macs | 6,441 | Development: model families, casual names, sponsor/payment mentions |
| 6 | Understanding graphics upscalers like DLSS and FSR | 7,781 | Development: acronyms, versions, aliases, possessives and closing names |
| 10 | Linus Got Fooled by AI Music | 4,385 | Final validation: conversational/service/artist names |
| 20 | Everything to know about SteamOS | 6,638 | Final validation: software, hardware, game and sponsor names |

Total: **28,567 saved characters**. All five hashes match the frozen source records. Complete original-video capture remains partial/unverified; the PSU text ends mid-phrase. Assess what exists in the saved text, not material that was never captured. This small English technology sample cannot prove general performance across platforms, subjects or languages.

A private source-only reference draft contains 132 named/technical surface rows plus eleven other named surfaces requiring identity/type review. All **143 surfaces / 356 recorded occurrences** match literal source substrings. These are not 143 distinct identities or an exhaustive human gold standard. Before scoring, independently audit eligibility, aliases, versions, required names and ambiguous spellings. Clear proper names, including people/characters when explicitly named, are collected without inventing a fuller identity. Existing useful technical terms can be assessed separately from the required-name coverage metric; no new topic-importance filter is introduced.

Keep sources 10 and 20, their reference names, baseline outputs, errors and scores out of the prompt writer's input/context until a candidate is frozen. Use a fresh isolated writer context if the curator has already seen them. A source curator/checker may inspect them; they are held out from this tuning loop, not historically unseen by every assistant. If their failures are then used to revise a prompt, they cease to be held out. Ordinals 14 (RAM) and 15 (Tesla) are reserved replacements; their bodies were not opened during this planning pass. They also have earlier whole-cohort reference history, so no claim of historically pristine data is made.

## Three methods first, a fourth available

| Method | Different way of finding the same required names |
| --- | --- |
| A — Direct reading | An AI reads the complete supplied text and lists every literal named mention, including examples, ads and the ending. |
| B — Type sweep | An independent AI invocation searches systematically by entity type: organizations/brands, products/models/versions, games, software/services, named technologies, domains and other clear proper names. It does not see A's output. |
| C — Pattern mining | Code finds literal domains, handles, model/version codes and possible proper-name phrases. This inexpensive method supplies candidates; it does not claim that every capitalized word is an entity. |
| D — Section sweep, optional | An independent invocation processes natural sections, including sponsor and closing sections, and combines their name lists. Use it for long inputs or persistent section-specific omissions. |

Start with A/B/C to keep the implementation and cost small. Test methods on the same inputs and keep the extraction model/settings fixed initially, so changes in the model do not masquerade as prompt improvements. Three methods do not require three new providers. Use only the four previously approved model IDs. A different approved model is preferable for checking when budget and compatibility allow.

This is a pool of complementary approaches. The experiment compares each method and the combined output. Later production can use the best affordable method/combination instead of paying for every approach on every item. Five cases alone are insufficient evidence for a sophisticated learned content router.

An initial direct-method prompt can be short: “Read every supplied transcript word. List every explicitly named brand, organization, product/model/version, game, software/service, named technology, domain and other clear proper name. Include brief examples, comparisons, ads and closing words. Return literal names as written; keep uncertain names separately. Do not guess spelling corrections, drop names for low importance, or calculate source IDs or timestamps.” This is a draft to test, not a rated or approved prompt.

Proposed extractor output:

```json
{"names":["AeroBox","AeroBox Plus"],"uncertainNames":[]}
```

The example names are synthetic. Host-side source matching and checker classification supply the remaining evidence and type work.

## One additional AI checker

The checker sees the complete saved source and the candidate union, with method names, model names, prior scores and favorite-version labels hidden. It checks each name's source support, eligibility, identity/version and duplicates, and looks for names all methods missed. Code verifies its quoted evidence/positions too. Checker-only discoveries remain recorded and checked; a single-method discovery is not rejected merely for lacking a second vote.

The checker is independent in role and invocation and blind to provenance, **not blind to the candidate list**. It can still anchor on that list or make mistakes. Calibrate its decisions against the independently reviewed source references and retain uncertain cases. It is not its own unquestionable ground truth. “One checker” describes one role; long inputs may require bounded batches rather than a false promise of one API call.

The same checker decisions can be mapped back to hidden host-side provenance to score A, B, C, optional D and the checked union separately. A higher score from the union must not hide a weak individual method.

## Scores and good/bad status

For a completed inventory, compute a 1–10 score with a fixed rubric:

| Criterion | Points | What is checked |
| --- | ---: | --- |
| Coverage | 4 | Required source names are retained, including brief/ad/outro mentions; pending clear names count as withheld rather than silently successful. |
| Correctness | 4 | Returned names are actual eligible mentions with valid evidence, rather than invented identities or generic filler. |
| Identity/version | 1 | Correct separation of brands, families, models, versions and ambiguous names. |
| Duplicate handling | 1 | Repetitions merge appropriately without collapsing different identities. |

After auditing and freezing canonical reference identities, define C as required identities correctly captured with the expected accepted/review disposition divided by required identities; P as grounded eligible returned identities divided by returned identities; I as correct type/version/identity decisions divided by grounded eligible returned identities; D as one minus redundant entity rows divided by returned entity rows. Keep actual repeated source occurrences as evidence, not duplicate keyword rows. Report `round( clamp(4C + 4P + I + D, 1, 10), 1 decimal )`. For these nonempty-reference cases, a completed empty result has zero components and scores 1; a failed delivery remains semantically unscored. Freeze denominators and alias rules for every comparison. Unexpected legitimate identities trigger a reference audit and regrading of all methods, not a one-sided score change.

Also record each method's unique correct discoveries and cost. A specialist pattern miner may score poorly alone yet improve the union; its marginal contribution should guide whether it stays.

Keep literal candidate coverage, accepted-name coverage and review rate visible so a list placing every name into review cannot appear production-ready. The current 0–100 confidence field must not be relabeled as this 1–10 quality score.

**Good:** at least 8/10 on every final validation case, all five complete, no unsupported accepted names, no missed known-required names from the audited reference, and no silent truncation. **Bad:** below threshold or a failed completion/evidence gate. Report average and worst-case scores; never hide a weak video in the average. These are proposed acceptance criteria, not measured results.

Transport, parsing, request-size and missing-response failures receive a separate delivery-failure status. Whole-video semantic quality is unscored when no complete inventory exists. Available partial names can receive an explicitly provisional score against only the input actually supplied; do not report that as full-video accuracy. Unexpected extra names may expose an incomplete reference: review them against the source rather than automatically marking them wrong. Any reference correction is versioned and applied to all compared methods.

## The improvement loop

1. Run the current keyword process on the five frozen cases to establish the baseline. Exact settled cached replies may be reused and labeled as replay; unknown calls/holds are never retried or guessed free. The current saved baseline covers only ordinals 1/2/6 and failed before final inventories; 10/20 have not been run for this experiment.
2. Run A/B/C on the three development cases, combine candidates and check them. Score each method/prompt and the union.
3. Save the mistakes by cause: missed name/section, invented identity, wrong version/type, duplicate, bad source matching, incomplete output, transport or capacity. A network/schema failure is not fixed by endlessly rewriting the relevance prompt.
4. Create one candidate prompt revision addressing the observed pattern, using general examples. Keep the source texts, reference, grading rubric and checker fixed. Do not paste the final-validation answer list into the prompt.
5. Rerun affected development cases and compare candidate versus the saved winner. Keep the earlier prompt if the candidate regresses. Save prompt text/hash, model/settings/schema, source hashes, raw outputs, judgments, score components, costs and error evidence.
6. Stop after at most three improvement rounds, earlier if the reserved cash is insufficient, the criteria pass or two rounds improve by less than 0.5 points. Freeze the winner, then test all five with the two validation cases still withheld from the writer. If validation informs another revision, replace the validation set.

This is the requested “learning”: accumulated, reviewable mistake cases and better prompt versions. It does not fine-tune model weights. No automatic promise of endless improvement or new allowance follows from reaching a stopping point.

## Smallest implementation

Add method-specific prompt files, a literal-name output schema, one code-based occurrence matcher, the checker prompt, the scoring/reference files and a private evaluation runner. Calls go through the existing private server-side provider adapter; the production key stays on Netlify and is never copied into local scripts. Keep current production jobs and annotations untouched while comparing candidates. A bounded evaluation session should permit prompt revisions under one finite budget without another production schema migration for every wording change. Every call still needs its own exact request/model/prompt/source binding and durable financial record; all existing holds stay included.

Keep accepted names, rejected/ambiguous candidates and actual operational errors separately inspectable in private results. Promote a version to “good” only after the defined gates. Production prompt/configuration changes are a separate release with recorded results; no output is published merely because the checker assigns a high score. No new agent framework, fine-tuning service, subscription or large admin redesign is needed for the first experiment.

## Spending and current status

Existing limits remain **US$0.10 per call, US$5/day and the original US$5 cumulative evaluation total**. The last verified record is US$3.551447750 committed, including US$0.013753066 old holds, leaving US$1.448552250. Refresh actual controls/ledger and preflight exact model inputs before paid execution. Include extraction, checking and any AI prompt-rewrite calls in one experiment cap; never create a fresh allowance per iteration. The proposed first experiment cap is US$1.00 with at most three rounds, stopping visibly if the cap prevents completion. Set aside preflighted baseline and final-validation/checker costs before allocating cash to improvement rounds; never mark a candidate good when validation was unaffordable. This does not guarantee all planned rounds fit.

This session prepared the five-source draft, checked literal occurrences and designed the process. **No five-video baseline, new method run, AI checker score, optimizer round or paid call has been executed.** Production analysis remains paused as last verified; no runtime/budget configuration was changed. [Plan metadata and selected-source hashes](evidence/keyword-learning-plan-2026-10-27.json). Raw sources/reference identities stay in ignored private paths.

## Comparison with the current approach

| Process | Design assessment | Reason |
| --- | ---: | --- |
| Current | 4/10 | Strong safeguards, but repeated strategy, fragile model-supplied references and no scored prompt feedback loop. |
| Proposed | 8/10 | Complementary coverage, one checker, explicit scores, retained mistakes and controlled revisions. Actual effectiveness is unmeasured. |

These are design judgments, not keyword-accuracy measurements or the eventual prompt scores. A five-case success is a small gate, not proof of perfect extraction in production.

Official OpenAI guidance supports task-specific evals, retained logs, explicit criteria and calibrating model judgments with human review; it also warns about judge bias. [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices). The evaluate–revise–retest loop is prompt optimization; model-weight training is a different operation. [Model optimization](https://developers.openai.com/api/docs/guides/model-optimization).
