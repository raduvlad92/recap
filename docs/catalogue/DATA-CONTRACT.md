# Creator research import contract

Authorized 21 October 2026: 120 distinct public accounts on each of YouTube, Instagram, X, Substack and LinkedIn (600 platform entries). A real creator can appear on several platforms and should receive one canonical page with multiple channels after evidenced entity resolution. Publishing groups are valid creators; people and groups remain distinct. No collection job may start from research/import/publication.

Research agents own only their assigned `data/catalogue/research-<platform>.json` files and `docs/catalogue/RESEARCH-<assignment>.md` evidence. Root owns import/schema/UI/build integration. Array of objects:

```json
[{"name":"Public creator or publication name","kind":"person","platform":"YouTube","handle":"@example","url":"https://www.youtube.com/@example","description":"Original factual one or two sentences about the public content focus; no unsupported achievements.","topics":["Technology"],"language":"en","evidence":[{"url":"https://official.example/about","note":"Official site links the channel"}],"checkedAt":"2026-10-21","verification":"official_crosslink","identityKey":"optional-shared-official-domain"}]
```

`platform` must be one of YouTube, Instagram, X, Substack, LinkedIn. `kind`: person or group (publications/studios/teams use group). `verification`: official_crosslink, official_profile or public_directory. Evidence must actually have been inspected during this task and support the precise account URL/name association; do not manufacture handles, verification dates or reference claims. A platform block/login is not proof of a dead account; a directory-supported record can be included with honest verification state. Prefer official cross-links. Exclude entries without any affirmative account evidence. Do not treat an HTTP200/login page alone as account verification. Use varied relevant subject areas; do not narrow the founder's three audience hypotheses to AI-only.

Descriptions are factual original editorial summaries, not scraped posts/creator endorsements. Avoid unverifiable audience/revenue numbers or computed sentiment. Do not include private participant/account data. No avatars or third-party copied media needed. No paid scraper execution. Root will preserve evidence, original platform URLs, collection-planned states and per-platform exact counts. If a source cannot support a record, replace it with a properly evidenced one rather than padding to120.
