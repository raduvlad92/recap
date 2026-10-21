# Tech source inventory and execution safeguards

Researched and checked **21 October 2026**. This document records public identity research, a reproducible source manifest, and local database/budget evidence. It does not claim a completed 30-day collection or usable transcript coverage. This research task did not launch any supplier job.

## Reviewed inventory

[data/tech/sources.json](../../data/tech/sources.json) contains **39 included sources: 21 YouTube channels, 10 X accounts and eight Instagram accounts**. Nine unresolved relationships remain separate; no optional source is excluded by topic alone. The running first controller retains its original 38-source input; GNSteve is a separately bounded follow-up, not a retroactive claim about that run. This expands the earlier 17-YouTube/five-social checkpoint in [CHANNEL-RESEARCH.md](CHANNEL-RESEARCH.md); the earlier document remains the evidence of that earlier pass.

The manifest has three publishing groups, six person/group identities, stable source IDs, exact original-account aliases, observed YouTube channel IDs, and inspected first-party evidence per source. Four exact existing D21 catalogue channel IDs are reused; the other source IDs derive deterministically from their canonical platform account or observed YouTube channel ID. This does not rewrite D21 identity anchors, overwrite live operator edits or import a new catalogue seed.

| Publishing group | Included YouTube properties | Included X / Instagram accounts |
| --- | --- | --- |
| Linus Media Group | Linus Tech Tips; ShortCircuit; TechLinked; WAN Show; LMG Clips; Techquickie; GameLinked; Mac Address; Channel Super Fun; They're Just Movies; PSU Circuit | Main LTT accounts on both platforms; ShortCircuit on both; TechLinked on both; GameLinked on both; Mac Address on both; Channel Super Fun on both; They're Just Movies on X. |
| MKBHD studio | Marques Brownlee; The Studio; Waveform; Auto Focus; Waveform Clips; MKBHD Shorts | Main Marques accounts on both platforms and Waveform on both. |
| GamersNexus | GamersNexus; GNCA – GamersNexus Consumer Advocacy; GN Extras; GNSteve (separate personal identity) | Main GamersNexus X. No Instagram account was affirmed. |

All sources are still marked `planned` / `not_collected` in this identity inventory. Included means the public account belongs in the requested collection inventory; it does not assert recent activity, functioning scraping, complete pagination or usable captions. YouTube videos, Shorts and streams are recorded as formats to check, rather than silently excluding the latter two.

## Additional primary evidence inspected

- [LMG corporate site](https://linusmediagroup.com/) links its named channels and main social accounts. The [official LTT profile](https://www.youtube.com/@LinusTechTips/about) supplies featured-channel identities. The current WAN Show profile resolves the distinct channel to `UCVlfe3MRSCZSeIWByrWHhkg`.
- [LTT Labs' own article](https://www.lttlabs.com/articles/2024/05/31/gary-promised-mice-so-heres-a-sneak-peek) explicitly links **PSU Circuit**. [That account's profile](https://www.youtube.com/@PSUCircuit/about) resolves `UCeQwQIoGPvEQFZ3jJ1NEJMQ` and links back to LTT Labs. This resolves the earlier candidate; it is included.
- Property-specific public social links were inspected on the official profiles for [ShortCircuit](https://www.youtube.com/@ShortCircuit/about), [TechLinked](https://www.youtube.com/@techlinked/about), [GameLinked](https://www.youtube.com/@GameLinked/about), [Mac Address](https://www.youtube.com/@macaddress/about), [Channel Super Fun](https://www.youtube.com/@ChannelSuperFun/about) and [They're Just Movies](https://www.youtube.com/@TheyreJustMovies/about). Their exact outbound account URLs are retained in the manifest, including legacy Twitter aliases.
- [MKBHD's official site](https://mkbhd.com/) links four main YouTube properties. The [official Waveform profile](https://www.youtube.com/@Waveform/about) additionally features **Waveform Clips** (`UCc_ycus0q7DSd85ZkmEY5ig`) and **MKBHD Shorts** (`UC1DoqbBY6dl8CEMVV9SK2FA`). Their own profiles resolve those exact identities, and the Shorts account identifies itself as official.
- [Vox's official Waveform show page](https://podcasts.voxmedia.com/show/waveform-the-mkbhd-podcast) links the [publisher's RSS feed](https://feeds.megaphone.fm/STU4418364045). Publisher-authored show notes label X `WVFRM` and Instagram `waveformpodcast` as Waveform social accounts. Individual host, guest, sponsor and referenced-company links are not treated as studio publishing accounts.
- [GamersNexus' official main profile](https://www.youtube.com/@GamersNexus/about) links GNCA, GN Extras and GNSteve under its other-channel section. [GNCA](https://www.youtube.com/@GNCAInvestigates/about) links back to the publication and states its consumer-advocacy purpose; [GN Extras](https://www.youtube.com/@gnextras/about) identifies itself as an official GamersNexus property.

Profile identity metadata and outgoing links were inspected through public HTTP responses; no historical feed was backfilled by this research assignment. Some LTT Labs pages rejected the simple HTTP client, so their rendered public browser-search representation and exact outbound links were inspected instead. HTTP 200, a login screen or a matching name alone was never treated as an identity bridge.

## Confirmed ownership and unresolved boundaries

**GNSteve is separate and included.** Its [own profile](https://www.youtube.com/@gnsteve8846/about) describes mountain biking and explicitly states that GamersNexus LLC owns the channel. That is evidence of association/ownership; it is not a reason to invent presenter credits, employment dates or contributions to every studio update. The founder asked for all media from these publishers, so its confirmed company ownership warrants inclusion despite its non-tech subject. It retains a separate personal/source identity and no invented contribution credits.

Four language-branded exLinus accounts are affirmatively featured by LTT, but present ownership/licensing and duplicate-language coverage remain unresolved. **LinusCatTips** resolves to an exact historical account (`UCL81YHgzH8tcrFfOJJwlSQw`), whose profile describes cat videos. The [historical official community discussion](https://linustechtips.com/topic/178711-which-of-linus-content-do-you-watch/) distinguishes it from LMG, but does not provide a current first-party corporate/main-profile ownership bridge. The account remains visible as an unresolved candidate and is not automatically collected under LMG.

No separate Labs-branded YouTube channel, GamersNexus Instagram, or studio-specific The Studio/AutoFocus X/Instagram account was affirmed by the inspected first-party links. Their absence from confirmed execution inputs is an explicit uncertainty, not proof that no such account exists. No guessed handles were inserted.

Activity is deliberately unknown: paused, historical, deleted and no updates found in a selected period are different states. The collection report must determine those states separately and show incomplete coverage when it cannot reach the cutoff.

## Reproducible input preparation

[scripts/tech-source-manifest.mjs](../../scripts/tech-source-manifest.mjs) validates this public inventory offline. `--check` prints the confirmed counts; `--actor-sources` emits only included public source inputs. Neither mode makes network requests, writes a database, starts an Actor or enables a schedule.

Validation checks exact stable IDs, canonical channel IDs, person/group relationships, evidence, public HTTPS URLs, original aliases, and explicit uncertainty. It rejects private identity/credential fields and email addresses. Ten adversarial local checks rejected mutated IDs, unknown creators, duplicate accounts, unsafe URLs, false coverage claims and execution flags.

## Durable shared spending control

[Budget migration](../../supabase/migrations/20261021104211_collection_budget_reservations.sql) and [server helper](../../netlify/functions/_shared/budget-ledger.ts) add a **single non-recurring USD45 technical ceiling** shared by every reader/session and paid collection provider. It is an additional conservative guard within the existing €50 source-proof approval, not a new spending authorization or a recurring allowance. Previous settled supplier charges continue to count.

The root process reserves an envelope before provider work. Its own Actor/build allowances and every child reservation consume that envelope; they do not each get a new USD45 budget. Database functions lock the same account row, so simultaneous requests cannot both spend the last available allowance. Stable request keys make retries idempotent.

The supported sequence is:

1. `reserveBudget` holds the global envelope and the root job allowance.
2. `claimBudgetLaunch` must return `claimed: true` immediately before the root paid POST. A replay returns false and must not launch again. Ambiguous starts remain held.
3. The Actor keeps one durable writer for child holds before each paid child call. No Supabase secret is sent to Apify. The available child ceiling subtracts the root allowance and **all prior settled or held build commitments**.
4. The trusted root process reconciles the complete Actor/KVS/provider run inventory into both budget reservations and the operational job ledger. Recording only `collection_jobs` is insufficient to release the budget envelope. Import-time database claim timestamps do not stand in for actual provider start timestamps.
5. `settleBudget` accepts final provider charges with an actual run reference. A null/unreported cost retains its full reservation. Small reported charges retain up to 12 decimal places; unknown charges are never invented as zero.
6. `closeBudgetEnvelope` requires explicit complete-provider-inventory confirmation and no unresolved child holds. If the Actor crashes, its inventory is incomplete, or any final charge is missing, keep the full envelope held. Only a never-launched reservation can be released normally; there is no expiry/TTL reset.

Known overruns are recorded honestly and stop additional reservations; accounting cannot retroactively prevent a provider charging more than its claimed maximum. The runtime must also enforce supplier hard limits, memory/time bounds and child-level caps before launching. A top-level platform maximum is not proof that independently billed child runs are included.

All budget tables have RLS, explicit revoked client grants and no ordinary-reader policies. Only server `service_role` can use the budget RPCs. Functions use security invoker and an empty search path. Business conflicts use `PT409`, not retry-triggering serialization failures.

## Private source-history archive

[Archive migration](../../supabase/migrations/20261021104534_reader_source_update_archive.sql) stores actual source updates separately from the two-megabyte workspace document. Each row is scoped by reader and update ID, with a user/collection/publication-date index. JSON IDs and publication timestamp must match the indexed columns. The initial per-record cap was 150,000 UTF-8 bytes; subsequent capacity changes belong to the parent's archive migration/evidence. This document does not override that live limit.

Ordinary signed-in readers may only select/delete their own archive rows. Server imports/upserts use the service role; anonymous access and ordinary INSERT/UPDATE are denied. Raw posts/captions and private reader identifiers stay in the private database, never this manifest or Git. An oversized record fails explicitly; the import must not truncate a transcript silently to force it through the limit.

The parent's [atomic history-clear migration](../../supabase/migrations/20261021105734_atomic_reader_history_clear.sql) couples an owner-scoped, revision-checked workspace reset with deletion of that owner's archive. Its stale and invalid-reset cases are included in the verification prepared below.

## Verification and handoff

- **30 budget-helper unit tests passed**, along with TypeScript checking.
- Both budget/archive migrations were compiled and exercised on an isolated, disposable **PostgreSQL 17.11** instance. **23 local checks passed**, including a real two-connection reservation race, concurrent one-shot launch claims, unknown-cost retention, immutable settlement, overrun handling, service-only permissions, archive owner isolation/deletion, record identity/date checks and oversize rejection. The local server and fixtures were removed.
- The exact rollback-only hosted verification file `.local/tech-hosted-safety.sql` also passed locally against a synthetic counterpart of the already-held D22 envelope. It preserves existing real budget rows, accounts for their baseline commitments, and rolls back its new fixtures. It additionally checks anonymous workspace-clear denial, stale-revision conflict preserving history, failed next-state constraint rollback, successful owner-only clear returning a new revision, another account's preservation, and admin archive-count deduplication/non-array metadata handling.
- The parent task reports applying the budget, archive and atomic-clear migrations to the exact existing recap project. **This child did not apply hosted migrations or run the hosted safety SQL**; the parent owns that live evidence and the subsequent supplier preflight.
- Public source-manifest validation and ten unsafe-input cases passed offline. These are input/safety checks, not supplier-content evidence.

No provider job, Actor deployment, paid collection, account change or hosted database mutation was performed by this child task. The parent separately reported capped Actor build charges; those belong in its actual ledger and reduce the remaining envelope. Future delivery evidence must separate build charges, actual runs, usable content, historical cutoff completeness and final billed cost. No collection success is asserted here.

## Incremental activity reconciliation

[scripts/reconcile-tech-activity.mjs](../../scripts/reconcile-tech-activity.mjs) prepares or applies activity accounting for an already-running controller and its known child runs. It defaults to **preview**: authenticated provider GETs and database reads only. Its provider reader accepts only `/users/me` and exact `/actor-runs/{id}` paths, sends no start/build/abort request, and refuses redirects. `--apply` permits database ledger/consumer/budget writes; it still cannot mutate a provider job.

The CLI accepts `--identity-file`, `--manifest`, `--controller-file`, `--checkpoint` and `--envelope-file` using the private file contract in the parent task. Identity/controller/checkpoint/envelope files must resolve inside ignored `.local`. Environment names are `VITE_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `APIFY_API_TOKEN`; values must never be passed into reports or committed.

The reconciler checks the exact recap project, authenticated DeleteCookies provider owner, controller actor/build/run, checkpoint parent and budget identity, and each child's source/reviewed actor/build/actual owner/run/cap before preparing writes. A newer manifest may be a superset of the actual checkpoint: only actual known run entries get child activity, so the original38-source controller and separately bounded GNSteve follow-up remain separate evidence.

Existing jobs are matched by unique provider run reference and their reader/source/provider identities are checked again before updating. New inserts handle a uniqueness race by re-reading and validating, never blindly overwriting another reader. Updates use the server revision, including running-to-running observations. Provider start/finish timestamps are retained; accepted item counts come from completed normalized checkpoint coverage, not raw dataset counts. Missing fees stay null unless an earlier actual observation exists; stale lower observations do not erase a higher fee already seen (final credits require a separate final reconciliation); explicit provider-reported zero is distinct from an absent charge. Later observed fees can rise after terminal status and remain refreshable in the operational ledger.

Every actual child receives its full checkpoint reservation under the existing global envelope. The reconciliation claim binds an existing verified run; it is never authorization to launch another. Every budget binding sends **`actual=null`**, including terminal outcomes. No final budget settlement or envelope close is performed, because provider billing may still change. The parent's [cost precision migration](../../supabase/migrations/20261021111858_collection_cost_precision.sql) preserves up to12 decimal places for observed operational fees.

Stdout contains only aggregate counts and charges. Optional `--private-output .local/tech-reconciled-provider.json` writes provider identity, fresh controller/child metadata and summary with mode0600; it contains no source-post archive or application-owner input object and must remain ignored/private. Errors emit only fixed safe codes. Do not attach the private file to an issue or commit it.

**42 pure reconciliation tests and TypeScript passed**, covering identity/build/owner mismatches, unsafe paths and fees, absent versus explicit-zero costs, rising terminal observations, bounded reservations, manifest/checkpoint subsets, normalized item counts, duplicate runs, another-reader insert races and concurrent revision conflicts. Read-only validation of the then-current actual local input files also passed with23 known child runs; that was not a provider/API refresh or database apply. The child task did not execute the CLI against live services. Actual preview/apply evidence belongs to the parent run report.

The reconciler now resolves each checkpoint's **actual platform + Actor ID + build ID** through the Actor module's immutable review lookup, rather than comparing historical runs with the current default. The legacy apidojo X review and newly selected Xquik review are both accepted only as their exact reviewed pairs; crossed or unknown pairs are rejected. Actor slug, build number and pricing fingerprint must also match that resolved review. Unrelated same-envelope proof holds remain in the budget baseline and do not become checkpoint source activity. The then-completed original38-entry private checkpoint passed read-only local validation after the X default changed; no provider or database request was made by that check. The parent's actual X proof and provider choice remain separate from this compatibility evidence.
