# Catalogue import manifest

Prepared **2026-10-21**. Metadata seed only. **This script performs no database write, supplier run, schedule or activation.**

## Result

- **600 public platform accounts**: exactly 120 per requested platform.
- **560 canonical creators/pages**, with 33 evidenced creators/groups having multiple channels.
- **Seven disabled plans**; every channel is planned.
- No inferred memberships, presenters, sponsors, collected updates, audience figures or private participant records.

| Platform | Distinct accounts |
| --- | ---: |
| YouTube | 120 |
| Instagram | 120 |
| X | 120 |
| Substack | 120 |
| LinkedIn | 120 |

Evidence methods: public_directory: 506; official_crosslink: 94. These describe identity evidence, not a collection pass.

## Identity rules

Merge only on a shared evidenced official domain or exact official-profile anchor, a compatible public name and the same person/group kind. A matching name alone never merges records. Compatible names permit punctuation, diacritics and a middle initial (Codie A. Sanchez / Codie Sanchez); unrelated aliases are not automatically equated. Twelve extra bridges are saved in [identity-overrides.json](../../data/catalogue/identity-overrides.json), and their evidence is appended to affected compiled channels. Researcher source files remain unchanged.

Original URLs, descriptions, languages and evidence remain on channels. Topic labels are combined on canonical creators; the source research files preserve platform-specific topic assignments. Creator descriptions combine original channel-focus descriptions. Hash-derived IDs and readable hash-suffixed slugs are deterministic and unaffected by input ordering. Later changes to an identity anchor that merge already-published records need explicit redirects/migrations; this seed does not silently rewrite a database.

| Canonical creator | Kind | Channels | Evidenced anchor |
| --- | --- | ---: | --- |
| 3Blue1Brown | group | 2 | 3blue1brown.com |
| Ankur Warikoo | person | 2 | ankurwarikoo.com |
| Arun Maini | person | 3 | mrwhosetheboss.com |
| Austin Evans | person | 2 | https://youtube.com/channel/UCXGgrKt94gR6lmN4aN3mYTg |
| Bill Nye | person | 2 | billnye.com |
| Brian Tracy | person | 2 | briantracy.com |
| Chase Dimond | person | 2 | chasedimond.com |
| Christian LeBlanc | person | 3 | lostleblanc.com |
| Codie Sanchez | person | 3 | codiesanchez.com |
| Dave Lee | person | 2 | dave2d.com |
| Dianna Cowern | person | 2 | physicsgirl.org |
| Drew Binsky | person | 3 | drewbinsky.com |
| Eric Topol | person | 2 | https://scripps.edu/faculty/topol |
| Fitness Blender | group | 2 | fitnessblender.com |
| Gary Vaynerchuk | person | 2 | garyvaynerchuk.com |
| Jeff Nippard | person | 2 | jeffnippard.com |
| JerryRigEverything | person | 2 | jerryrigeverything.com |
| Jimmy Chin | person | 2 | jimmychin.com |
| Joe Wicks | person | 2 | thebodycoach.com |
| Justine Ezarik | person | 4 | ijustine.com |
| Kara and Nate | group | 2 | karaandnate.com |
| Kurzgesagt | group | 2 | kurzgesagt.org |
| Lenny Rachitsky | person | 2 | lennysnewsletter.com |
| Marc Randolph | person | 2 | marcrandolph.com |
| Marques Brownlee | person | 3 | mkbhd.com |
| Minimalist Baker | group | 2 | minimalistbaker.com |
| Paul Nicklen | person | 2 | paulnicklen.com |
| Rick Steves' Europe | group | 2 | ricksteves.com |
| Sahil Bloom | person | 2 | sahilbloom.com |
| Scott Herman | person | 2 | scotthermanfitness.com |
| Steve Mould | person | 2 | stevemould.com |
| The Bucket List Family | group | 2 | thebucketlistfamily.com |
| Unbox Therapy | group | 2 | unboxtherapy.com |

## Unresolved identity pairs

- **Ottolenghi**: The official restaurant site affirms its Instagram and mentions a Substack, but inspected pages did not link the precise publication domain; the publication describes the team. Retain separate group records until an exact bridge is inspected. Accounts: [https://www.instagram.com/ottolenghi/](https://www.instagram.com/ottolenghi/), [https://ottolenghi.substack.com/](https://ottolenghi.substack.com/).

A separate unresolved record is not proof of a separate real-world creator. Resolve this pair before treating its separate pages as authoritative distinct identities.

## Provider plan

YouTube: Apify $4/1,000 Free-tier video records. Instagram/LinkedIn: Bright Data $1.50/1,000 comparable public text rows. X: Apify $0.016/profile-search query; extras differ. Substack/Blog/Podcast: native public feed discovery, $0 scraper-supplier fee excluding hosting/body/audio processing. Fallback and transcript limits are saved on plans. These are quotes, not budgets or observed charges. See [cost research](COLLECTION-COSTS.md).

## Reproduction and integrity

Run node scripts/build-catalogue.mjs to regenerate, or node scripts/build-catalogue.mjs --check to detect drift without writing. Inputs are local research JSON, saved provider prices and reviewed identity overrides. No network, credentials, database client, collection trigger or scheduling is present in the build. Root separately imports the reviewed rows.

Compiled catalogue SHA-256: 121df103c3f4a5cf51550d259d81bc82b681f25ee834ee74f5b777d42e3724d8.

- research-youtube.json: e8ac62da9c6aefe4820eb9e2d81d73a949a79922c8d71268d41ebfffeb636708.
- research-instagram.json: 988f598123a2f9d17e50d35dab5c0908c5ca4ab8ae7ac58e2c5ed0386e8d0f14.
- research-x.json: 209fa02736a4b9980acd06071fc454be21ee819b88ce8f1cc58ffe1b901eb498.
- research-substack.json: 6a66d6d7755bffdceddf2147d9c8b3a38cafc83d214f47f2378ab29fd2b7e2cf.
- research-linkedin.json: 901e8064e7f1e21dca86ed6be533633bf853dcb3f80d9eae672e2137b2572180.
- provider-plans.json: 16293242690786f12753ea21cb03904206e424aed40e41cd85762d66238d78e0.
- identity-overrides.json: 9ad211a10fb78364aac7a16edd9981c820d83d3d0ef2529bede2d3855406af84.

Public directories/profiles establish identity only. Some platform pages are cached or blocked; affirmative cross-link evidence is described on the channel. SEO indexing/rank, source completeness and content generation are not validated by this import.
