# Substack creator research — 120 public publications

Checked **21 October 2026**. Research/import metadata only; **no source-content collection job, paid Actor run, subscription, account signup or collection schedule** was started by this research.

The import file is [research-substack.json](../../data/catalogue/research-substack.json). It contains **120 distinct public publication URLs**, represented as **90 people and 30 publishing groups**. The public material inspected spans English, Italian, French and Lithuanian; language labels describe the inspected publication, not a promise that the app already creates recaps in that language.

## How the account identities were established

1. Opened Substack's own public category directories below. Each directory pairs a publication name, its named writer when provided, and a clickable publication domain.
2. Followed all **120 publication links**. The returned primary publication pages identified the publication in their titles, including custom domains. This is affirmative directory/profile evidence, not an inference from an HTTP 200 response or a login page.
3. Wrote short original descriptions of subject matter. No post bodies, copied biographies, subscriber counts, avatar images, endorsement claims or private account records are in the import.
4. Saved the inspected directory URL and exact linked publication URL on every row. All rows use `verification: public_directory`: that label identifies the evidence method, not a platform verification badge or a completed scraper test.

The directory order changed while researching (for example, FOUND appeared in Travel). The saved set follows the actual entries inspected and is **not a persistent ranking**. Publication URLs were retained as actually linked, including custom domains; no guessed personal Substack handle is substituted. The `handle` field intentionally contains the publication domain because that is the affirmed channel address, not the writer's personal Notes handle.

## Subject coverage and primary directories

| Subject | Entries | Official directory |
| --- | ---: | --- |
| Technology | 10 | [Substack directory](https://substack.com/top/technology) |
| Business | 10 | [Substack directory](https://substack.com/top/business) |
| Finance | 10 | [Substack directory](https://substack.com/top/finance) |
| Food | 10 | [Substack directory](https://substack.com/top/food) |
| Science | 10 | [Substack directory](https://substack.com/top/science) |
| Culture | 10 | [Substack directory](https://substack.com/top/culture) |
| Health | 10 | [Substack directory](https://substack.com/top/health) |
| Sports | 10 | [Substack directory](https://substack.com/top/sports) |
| Literature | 10 | [Substack directory](https://substack.com/top/literature) |
| History | 10 | [Substack directory](https://substack.com/top/history) |
| Travel | 10 | [Substack directory](https://substack.com/top/travel) |
| Design | 10 | [Substack directory](https://substack.com/top/design) |
| **Total** | **120** | **120 unique publication URLs** |

## People, groups and identity resolution

A person's channel is separate from the person: for example, Gergely Orosz publishes The Pragmatic Engineer; Katelyn Jetelina publishes Your Local Epidemiologist. Multi-author publications and studios such as SemiAnalysis, ByteByteGo, Newcomer, Prof G Media, Sensible Medicine, Vittles and Design Better are groups. Never Sponsored is a group because the inspected directory describes both Christopher Schwarz and Megan Fitzpatrick as contributors, even though the publication page title highlights one of them. This preserves the founder's modular studio/person/channel requirement.

First-name or pseudonymous creators (Claire / bite club, Katie / the sunday stack, Le Shrub, James Bulltard, BowTied Bum and Tic Toc Trading) must **not be merged with unrelated people solely because of a similar name**. Cross-platform grouping needs matching official cross-links or another affirmative identity bridge. The publication source URL remains stable regardless of later canonical-creator grouping. These rows alone do not establish membership relationships between the groups and all their presenters.

## Collection and page-copy boundaries

These entries are a directory of real public destinations, **not 120 collected feeds**. Content completeness, current accessibility, custom-domain behavior, free-versus-paywalled posts, deletion handling and refresh reliability still require future bounded checks. Substack directory inclusion is not a creator partnership or permission to reproduce full posts. Creator pages should link the original source and label collection **planned / not started**. No fabricated recap, sponsor list or “last collected” date should be generated from this metadata.

The cheapest planned route is public publisher RSS for discovery, followed only where necessary by public-body extraction. An RSS headline/preview or a paid-post teaser is not enough for a complete recap. See [collection costs](COLLECTION-COSTS.md) and the disabled [provider plan metadata](../../data/catalogue/provider-plans.json).

## Validation of the saved research file

- Exactly 120 array entries, all platform `Substack`.
- Exactly 120 unique HTTPS publication URLs.
- All required name/kind/platform/handle/url/description/topics/language/evidence/checkedAt/verification fields populated.
- Every row has two inspected primary evidence URLs: the official directory and the clicked publication page.
- No social supplier execution; **new research collection spend: $0**.
