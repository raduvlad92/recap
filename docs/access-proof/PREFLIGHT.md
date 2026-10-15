# Source-proof preflight — 15 October 2026

Q6 approved the source-access experiment and up to €50 total. This report records actual preparation and initial checks, not a completed seven-day proof.

## What was done

- Fixed a sample of 35 public sources: five in each approved family. See [sources.json](sources.json).
- Verified the identity/source evidence and prepared five pinned Apify actor configurations. Social collection has not run; public catalog/schema requests are not paid scraper runs.
- Fetched and parsed all 15 written/podcast feeds, retaining five recent items per source: 75 sampled updates. The latest normalized evidence is [preflight-2026-10-15-final.json](results/preflight-2026-10-15-final.json).
- Separately checked ten public article pages during source selection. Those pages responded successfully; full-content/visual completeness is not established for every item.
- Verified a matching publisher transcript for the Acquired sample and the Freakonomics sample. No matching transcript was verified for the selected 99% Invisible, Vergecast and BBC episodes; that is not a claim that those shows never publish transcripts.
- Preserved raw feed responses in ignored `.local/access-proof/`, with hashes and small metadata reports tracked in Git. No bulk bodies or credentials are committed.

## Problems found and corrected

- A shared podcast homepage URL must not merge different episodes: stable episode GUIDs take precedence.
- RSS `-0000` timestamps represent UTC instants and must not lose their dates.
- An article discussing `DOCTYPE` inside CDATA is not itself an XML document-type declaration.
- Image enclosures are not audio files. Only audio MIME types enter the audio candidate list.
- A query-specific episode URL such as `/?p=...` is an item link, not a plain homepage.

The original diagnostic report and later processing revisions remain available. Fourteen responses were reparsed from disk; only the initially rejected GitHub response needed another public GET. Later parser revisions made no additional network requests. Targeted parser checks passed, and a separate agent checked counts, hashes, coverage claims and obvious credential patterns.

## What the results mean

Public feed access is demonstrated for the selected 15 sources at this point in time. Podcast show notes are labeled separately from spoken-content transcripts. Our World in Data's feed provides summaries and needs linked-article extraction. Some feed episode links are homepages or missing; source-specific resolution is still required for exact citations.

No completeness percentage, full-content pass or seven-day reliability pass is claimed. The other 20 selected social sources still need provider collection. The four social platform families cannot pass based on the existence of an actor or an owner-linked profile.

## Spending and duration

Actual external cash paid: **€0**. Provider credits consumed: **0**. Generated transcription: **0 of 150 minutes**. No audio body was downloaded. Podcast audio endpoints were checked with HEAD requests during selection; that does not demonstrate successful audio retrieval or transcription.

Formal seven-day observation window: **not started**, with **0 of 7 daily observations completed**. Starting the clock before the social baseline and charging controls are ready would misstate the result.

## Ready next

Apify and Bright Data both currently show login pages in the shared browser. The founder has been asked to sign into Apify; Q6 spending permission must not be requested again. Once access is ready:

1. Check plan, remaining credit, exact prices and automatic recharge/renewal settings.
2. Run one bounded item per social platform using the prepared pinned configurations. Start with native captions; keep comments and generated speech transcription off.
3. Inspect actual fields and billed events before increasing to the five-source baseline.
4. Reserve costs and any generated-audio minutes globally. Stop before the €50/150-minute cap could be exceeded.
5. After a complete baseline, start and save the seven-day repeat schedule, its end condition, next run time and ledger checks.

The [saved evidence walkthrough](../demos/source-proof-preflight.html) is a report of this experiment, not a product mockup or finished app.
