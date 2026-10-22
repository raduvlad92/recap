# Product specification

Version: **1.1 — APPROVAL CANDIDATE**. Updated: 21 October 2026. Owner: founder. **Broader specification not approved. A separately authorized functioning v0 is deployed under D20; see [v0 scope](docs/v0/PLAN.md). D21 separately authorizes the [admin and public creator catalogue increment](docs/admin/PLAN.md), with collection disabled.** Supersedes the unapproved v1.0 candidate by adding D19's modular studio/person/channel requirement. A separately authorized visual concept exists under D18; it does not approve this specification. Matching delivery plan: [PLAN.md v1.1](PLAN.md). Quick review: [docs/APPROVAL.md](docs/APPROVAL.md).

Q1–Q15 and D19 establish the direction below. Details marked **recommended default** are offered together for approval, not treated as answers already given. Approval of this specification and plan authorizes local implementation within this scope. Supplier execution, spending, outreach, trials and publication remain separately deferred or unauthorized.

## Purpose and business direction

Help busy people understand what changed across creators and publications they choose, without visiting every platform or consuming every original in full. The main experience is a short, cited daily briefing with a dated history.

Aim for rapid growth. Explore independent consultants, marketing/brand-monitoring buyers and general readers as separate customer hypotheses; choose a focus from evidence. The first product serves individual readers. Marketing buyers participate as readers in validation; team workspaces and campaign reporting are not implicitly included.

Demand, willingness to pay, retention, supplier reliability and acquisition costs remain unproven. Existing products overlap substantially. The proposed advantage to test is useful “what changed” synthesis, reader-controlled relevance and honest coverage across chosen sources. See [research](docs/RESEARCH.md) and [validation](docs/VALIDATION.md).

## Accepted founder requirements

| Area | Accepted direction |
| --- | --- |
| Sources | YouTube, X/Twitter, Instagram, LinkedIn, podcasts, Substack/newsletters and blogs. Public creators need not join or authorize the app. |
| Creator structure | A creator may be a studio/team with several presenters and channels. Support drill-down into people and individual sources through a modular model. D19. |
| Access | Broad usable content before a customer trial. Investigate Apify, Bright Data and alternatives. Titles/descriptions alone do not establish full-content analysis. |
| Current assumption | D08 assumes scraper capability for planning; provider execution, sign-in requests and spending are deferred. This is not verified access. |
| Surface and onboarding | Phone-friendly website; editable starter collections and pasted creator links. Automatic following-list import later. |
| Reader control | Date-ordered history, explicit interests for priority within each day, and all updates independent of interest filtering. |
| Briefing | About five minutes, up to five main topics, expandable details, what changed, why relevant, updated-source counts, snippets and original links. Quiet days stay short. |
| Delivery | One daily recap at the reader's chosen local time; optional email reminder linking to the website. |
| First analysis | Topics, brand mentions and explicitly disclosed sponsors. Source sentiment, comment sentiment and audience statistics later. |
| Languages | Multiple interface and recap languages at launch. Q13 rejected English-only; exact languages below are proposed. |
| History/references | Keep dated recaps until user/account deletion, with original-update citations and material explicitly linked by creators. Export/delete controls, visible corrections and unavailable-original notices. |
| Allowances | Clear limits with larger allowances than the rejected 15-source / 500-update / 60-minute proposal. Revised numbers below are proposed. |

Public scope does not imply private accounts, paid newsletter access, paywall circumvention, Stories/live streams or full historical backfill. Public Substack articles do not establish access to paid editions. Show supported formats and gaps per source. Credit and link original creators.

## Recommended defaults for approval

### Studios, people and channels

Keep publishing groups, people, sources and update-level contributions separate, with optional show grouping where useful. A presenter can participate in several groups/channels; a group can operate several channels; a guest appearance does not establish membership or ownership. Store known effective dates and attribution evidence; incomplete credits stay unknown rather than guessed. [CREATOR-MODEL.md](docs/CREATOR-MODEL.md) defines the relationships, follow behavior, examples and future demo cases.

Offer studio/person/source drill-down and follow scopes with a visible set of underlying supported sources. New channels require inclusion confirmation; a person follow does not promise every appearance across the internet. Count each actual enabled source once, including overlapping follows; count an analyzed update once regardless of its credited presenters. Removing one follow does not disable a source still included by another active follow; explain this. Distinct cross-posts keep their original provenance. Preserve historical credits when affiliations or ownership change and show later corrections. Presenter filters must be explicit and distinguish filtered from total counts.

Keep collection, identity/relationships, analysis and recap assembly modular; do not tie creator identity to one platform or supplier. Curated/evidenced relationships and available credits are sufficient for local fixtures. Exhaustive people discovery, face/voice recognition, automatic internet-wide guest tracking and visual relationship graphs are outside this candidate. Publishing teams do not imply reader-team accounts.

### Six launch languages

- Interface, recap and supported source languages: **English, German, Spanish, French, Italian and Portuguese (Brazil)**. The exact set/variant is a recommendation, not a founder-selected list or verified language capability.
- Interface and recap languages are independent persisted choices, initially defaulted together. One reader gets one daily recap in their chosen language, combining usable sources among the six languages. Do not generate six recaps per reader.
- Show original source language and preserve names, brands, numbers, uncertainty, negation and URLs. Label translated snippets; make original wording inspectable where available. A translated paraphrase is not a verbatim original quotation.
- Unsupported/uncertain languages and mixed-language coverage gaps must be visible, not silently skipped or summarized from titles.
- Interface changes apply immediately; recap-language changes apply to future recaps. Past recaps retain their generation language. Bulk archive translation/regeneration is outside v1.0.
- Every language must pass interface and recap-quality checks before a six-language launch claim. Failures require a recorded scope change, not a silent English fallback.

### Larger starting allowances

These are configurable design allowances per reader, not a public offer, recurring cash budget or measured operating ceiling.

| Allowance | v1.0 recommendation |
| --- | --- |
| Followed sources | **50 total, including at most 15 X accounts** |
| Collection cadence | At most one scheduled check per reader/source/local day; reuse a successful shared check from the six hours before cutoff. No manual-refresh loop/backfill. |
| New updates analyzed | **200/day and 3,000 per monthly usage period**, both apply |
| Generated transcription | **300 audio minutes per monthly usage period** |
| Personal recap | One daily recap in one chosen language; optional reminder |
| Extra charges | None automatically; limits and omissions visible |

Existing usable captions/publisher transcripts do not consume generated minutes; retrieval and analysis still cost work. Shared processing must not reduce the stated reader allowance or expose reader data. See [cost scenarios](docs/ALLOWANCES.md).

Use a visible monthly reset anchored to the reader's start date and daily limits in their selected timezone. Source/timezone/language changes do not reset usage. Deduplicate the same update; retries and corrections do not consume another reader update slot. Explain counters.

At a processing limit, prioritize by explicit interests, then publication time, and show available unprocessed items/reasons in all updates. Do not silently queue omissions for another day or run extra paid jobs. If a full episode exceeds remaining generated minutes, skip it visibly rather than describing a fragment as complete. Unknown duration needs a bounded stop and truthful partial status. If capture limits prevent knowing how many items were missed, say the check was incomplete.

A separate operator cash ceiling/stop is required before live operation. No quota is permission to spend. The deferred experiment's global €50/150-minute ceiling is separate.

## Reader journey

1. **Set up.** Create a private individual account; choose languages, timezone, delivery time and explicit interests. Reminder email starts off. Edit a starter collection or paste sources; choose supported studio/person/source scope with the actual enabled channels visible. See duplicates, unsupported/private formats, languages and pending checks. Do not request social passwords.
2. **See value.** Show the reader's latest completed recap for their followed sources where one exists. Collections only help select sources; they do not create separate recaps. Otherwise explain when the first scheduled recap will arrive; do not trigger unapproved on-demand supplier jobs. A fixture preview is labeled a sample, not personal/live coverage.
3. **Understand coverage.** Distinguish followed sources, successful checks, sources with new updates and analyzed updates. Failed, delayed, quiet, partial and limit-reached states differ. Adapters/fixtures do not establish seven-family live support.
4. **Read and expand.** Up to five main topics explain what changed and why relevant to selected interests, with attributed snippets and original citations. Expansion reveals source contributions, disagreements, brands, disclosed sponsors and creator-linked references. Drill into a studio, presenter or channel with known roles/coverage visible. Extra topics/items remain reachable in all updates; avoid full-original reproduction. Repetition is not independent corroboration.
5. **Explore history.** Keep days in date order. Profile edits affect future recaps; delivered briefings remain snapshots. All updates for a day ignores interests but retains access/usage gaps. Unfollowing stops future coverage through that follow and preserves earlier recaps unless deleted; a source included by another active follow remains enabled, with that reason visible.
6. **Manage.** Edit settings, opt into/out of reminders, inspect usage, export history/profile/source lists, delete a recap or account. No surprise upgrade or overage.

### Citations, references, brands and sponsors

Every factual recap claim must trace to a supporting original update; a creator homepage alone is insufficient. The recap reports what sources say, not automatic independent verification of their claims.

A **creator-linked reference** is material explicitly linked in usable source content/show notes, such as a study or article. Keep URL, available title and which update/creator linked it. Distinguish references from supporting original-update citations. A named study without a URL does not justify inventing a link. Do not automatically subscribe to destinations, crawl their bibliography or independently analyze every linked website. Sponsor/shop/navigation links must not masquerade as supporting evidence. Unavailable/paywalled destinations remain labeled references.

D28 scoped clarification (23 October): keywords identify explicit brands, products, named games, technologies and concrete categories throughout usable content, including casual comparisons, sponsor segments and closing seconds. They are distinct from summarized claims. The [keyword rule](docs/design/KEYWORD-EXTRACTION-RULE.md) defines separate completeness review and private low-confidence decisions; this does not imply that all historical items or an automatic future model service are complete.

Brand mentions do not prove sponsorship. Label sponsors only from an explicit disclosure, retaining supporting wording/citation. No detected disclosure does not prove an update was unsponsored.

### Daily cutoff, late items and corrections

Use the reader's timezone/delivery time as the daily cutoff. The once-daily collection allowance is per reader/source/local day, not a promise of one global check serving every timezone. A successful shared check may replace that reader's check only if it occurred within the six hours before cutoff; otherwise schedule their one check. This six-hour freshness window is a recommended design target, not measured capability. Readers at different times may require different paid checks; reuse savings depend on scheduling overlap too. Display actual last-check/recap times and stale/failed coverage. Do not silently retry indefinitely or add refreshes; supplier jobs remain deferred and later require an operator budget.

For daylight-saving gaps, use the next valid local time; for repeated times, trigger once. Settings changes affect the next not-yet-created recap and cannot create a second daily recap/reminder. Quiet days stay short; failures are not quiet days.

Delayed collection produces visible partial/delayed coverage. Late discoveries appear in the next recap with original publication time and a late-arrival label. Corrections identify what changed and when; no silent rewrite of historical meaning or second daily reminder. A deleted recap cannot be recreated by a retry/backfill.

### Lasting history, privacy and trust

Keep recaps/reference metadata until user/account deletion, not a full original-content archive. Preserve correction provenance. A failed request does not establish that an original was deleted: distinguish confirmed unavailable, temporarily unreachable and unknown, with last-known status/check date. Continuous checking of every historical link is not promised. When a snippet must be removed, redact it with an explanation while retaining permissible history metadata.

Recommended data targets: remove raw fetched bodies/transcripts within **seven days of collection**, including pending, failed and limit-omitted inputs. Exclude these temporary inputs from durable backups. Retain recap text, permitted brief snippets, citations, references, coverage metadata and a minimal dated update inventory (available title, URL, publication time, analyzed/partial/skipped state and reason). This inventory supports historical all updates after raw inputs expire; it is deleted with the reader's recap/account. More raw retention requires a recorded reason/scope change; supplier retention/reuse restrictions remain unverified under D08.

Export readable recaps plus structured dates, languages, topics, citations, creator-linked references, corrections, availability notices, source lists and profile. Recap deletion removes that reader's copy; account deletion revokes access, cancels pending reminders and removes active personal data. Backups must expire within a documented maximum of **30 days** and cannot restore deleted records into use. These are proposed implementation targets, not an existing system's verified behavior.

Keep accounts/profiles isolated. Reuse public-source analysis only where appropriate/permitted, without another reader's interests/history/private inputs. Source content is untrusted data: embedded instructions cannot change behavior, reveal secrets or trigger external actions. Open external references safely. No credentials or participant identities in Git.

## Revenue, validation and release boundaries

Recommended revenue model: subscriptions, with no paid placement affecting relevance. Price is unsettled. The larger package needs observed collection overlap, transcription and support costs before an offer; the earlier €12/month example is not a commitment. Local demonstrations do not require billing/payment integration.

The cheapest useful business test remains a manually checked **14-day daily briefing trial**, five participants in each of the three audiences, after broad access is actually secured and a separate offer/budget is approved. This tests usefulness before full automation. No recruiting/charging is authorized. The [validation brief](docs/VALIDATION.md) defines payment, repeat-use, trust, renewal and acquisition hypotheses by audience. Fourteen consecutive days align with accepted daily delivery; this replaces the earlier ten-weekday design.

Approving SPEC v1.1 and PLAN v1.1 permits local milestones with labeled fixtures and assumed suppliers. It does not reopen D08, run metered collection, send external emails, start a customer trial or publish. Local completion, verified integrations and public readiness are separate evidence. No fixed launch date or all-in development quote is promised.

## Deferred roadmap retained

- Source sentiment/stance; comment sentiment with sample size/time/selection and no population-opinion claim from a small sample.
- Named, dated views/likes/audience measures; do not sum them and call the result unique reach.
- Automatic following-list import, native apps, paid/private-source access, source backfill and more languages.
- Reader-team workspaces, real-time alerts, archive translation and billing may be considered later; they are not accepted v1.1 requirements.

## Acceptance criteria

Fixtures prove local behavior only; live collection/delivery remain separate gates. Milestone IDs refer to PLAN.md.

| ID | Criterion | Required evidence |
| --- | --- | --- |
| AC01 | Collection claims match provenance. | Fixture/assumed labels throughout; per-family live evidence only when D08 is reopened. M1 / A02–A03. |
| AC02 | Sources can be selected, edited, removed. | Collection, paste, duplicate/unsupported source and stop-future-collection cases. M1. |
| AC03 | Topics preserve meaning, attribution and disagreement. | Human-reviewed overlapping, contradictory and repeated-source examples. M2. |
| AC04 | Factual claims have supporting citations; creator-linked references retain origin. | Citation audit, shared paper linked by two creators, unavailable destination and non-supporting reference. M2. |
| AC05 | Quiet, failed, delayed, partial and limited states differ. | Known events and truthful source/update counts. M1–M3. |
| AC06 | Explicit relevance is explainable. | Two profiles/same updates; no hidden behavioral ranking. M2. |
| AC07 | History, corrections, export and deletion follow policy. | Multi-date snapshots, unfollow, missing vs unreachable original, correction, export, deletion/restore cases. M3. |
| AC08 | Account isolation and content trust controls hold. | Cross-account attempts and malicious source instructions cannot expose data or trigger actions. M3. |
| AC09 | Reader allowances and operator costs are controlled separately. | Daily/monthly limits, retries/deduplication, unknown-duration stop, simulated cash stop; measured billing only when live authorized. M3 / A02. |
| AC10 | Paid operation is separately approved/verified. | Offer, cancellation, privacy and checkout checks before any paid launch. L01. |
| AC11 | Core journey works on phone/desktop with keyboard/touch. | 360px/desktop and long-label checks in every launch language. M1–M5. |
| AC12 | Onboarding distinguishes sources from platform/follow-list access. | Editable collection/pasted-link flow and unsupported/private cases. M1. |
| AC13 | Historical dates and delivered snapshots remain stable. | Change interests/timezone/language; inspect old dates and all updates. M2–M4. |
| AC14 | Main recap has at most five topics, expandable detail, counts, snippets and links. | Busy/quiet days, extra topics reachable; reader timing later. M2 / V02. |
| AC15 | Daily local-time recap; reminder separately opt in/out. | DST, changed settings, retries, delayed/quiet days, disabled reminders; local email preview only. M4. |
| AC16 | Brand mention and disclosed sponsor remain distinct. | Mention-only, disclosed/unclear sponsor cases across languages. M2 / M5. |
| AC17 | Six-language interface/recap/source support is credible. | Locale matrix, mixed-language topics, preserved numbers/negation, labeled translations, unsupported language and future-only setting change. Qualified language review before public support claims. M1–M5 / L01. |
| AC18 | Data lifecycle targets are enforceable. | Seven-day-from-collection raw expiry including never-analyzed inputs, retained historical inventory, active-data deletion and 30-day backup expiry/restore checks; deployment dependencies recorded separately. M3 / L01. |
| AC19 | Studio/person/source drill-down preserves identities, coverage and historical attribution. | One studio/multiple channels/presenters; one person across groups; guest vs member vs mention; unknown credits; overlapping follows/source quotas; new-channel confirmation; unfollow with another active route; dated departure/rename/correction. M0–M3 / M5. Fixtures prove navigation/rules, not automatic identity discovery. |

## Approval and change control

Approve **SPEC v1.1 and PLAN v1.1 together**, or name changes. The [approval brief](docs/APPROVAL.md) isolates recommended defaults. Until explicit approval, only documentation/research continues, alongside separately authorized visual concepts. Record the actual response/date in the decision register; silence is not approval. Material scope changes require a new version/plan. Routine technical choices within approved scope are the assistant's responsibility.
