# Modular creators, studios, people and sources

Updated: **21 October 2026**. Founder requirement **D19**: a creator can be an entire studio/team, with drill-down into its presenters and multiple channels; the product must be modular. The behavior below is the recommended treatment in **SPEC/PLAN v1.1**, which remain approval candidates. This is a product model, not an implemented database or tested identity system.

## Identities and relationships

“Creator” remains the reader-facing umbrella term for a person or publishing group. Keep these concepts distinct:

- **Publishing group:** a studio, team or organization.
- **Person:** one identity across their roles, affiliations and channels. Presenter, host, author and guest describe roles, not new people.
- **Source:** an actual channel, account, newsletter, blog or podcast from which updates are collected. A studio can have several YouTube channels; one channel can contain work from several people.
- **Show, when useful:** a recurring programme or series. A show can span channels; a channel can carry several shows. A show is not an extra collection source by itself.
- **Affiliation/ownership:** how people, groups and sources relate, with effective dates and evidence where known. Membership does not establish ownership or participation in each update.
- **Update contribution:** who actually hosted, presented, authored or appeared in a particular update, with the role and supporting credit/evidence. Publishing a video and speaking in it are different relationships.

These are overlapping relationships, not a fixed tree. A person can work with two studios, a channel can be jointly operated, and a guest can appear without becoming a studio member. A brand mentioned in an update is not automatically its publisher, presenter or sponsor. Do not merge people simply because names match; distinguish uncertain identity from verified links.

Fictional example: **Northstar Studio** operates **Northstar Main** and **Northstar Clips** on YouTube and a podcast. **Maya Chen** presents on Main, co-hosts the podcast, and runs a personal newsletter. **Leo Ortiz** presents some Main episodes and guests on another show. The reader can start at Northstar and drill into a source or Maya's identified contributions; Maya's newsletter remains her own source, and Leo's guest role does not imply studio ownership or membership.

## Reader behavior and honest coverage

1. Offer studio/group, person and individual-source views, with optional show grouping where known. Support following the whole studio, selected channels, or a person within an explicit supported coverage set. A person view combines their publishing sources and identified contributions; it must distinguish authorship, hosting and guest appearances.
2. Before following a group/person, show the underlying supported sources that will be enabled, excluded sources and unknown coverage. Do not imply discovery of every appearance on the internet. An incomplete presenter credit stays unknown; the update remains reachable under its publishing source without invented attribution.
3. Show newly discovered channels as additions for confirmation, with allowance impact. Do not silently turn a studio follow into unlimited new collection or assume a new guest's personal accounts should be followed.
4. Count actual unique enabled sources toward source limits. Studio + Maya + Main can point to one enabled Main channel, counted once. A studio's five enabled channels count as five sources. Update allowance counts reflect updates actually analyzed, not the number of presenters credited. No allowance change is implied by this model.
5. The same source update reached through several follows appears once in the recap/inventory, retaining all inclusion reasons and credits. Distinct cross-posts/re-edits retain their original URLs and versions; similar titles/topics alone do not establish a duplicate or independent corroboration.
6. Preserve credits and known relationships as they applied to past updates when a person leaves a studio, a source is renamed or ownership changes. Make later corrections visible; present-day membership must not silently rewrite old recaps. An unfollow removes that route to future coverage; explain when another active follow still includes the source.
7. Keep chronological history, explicit interest controls, all-updates access and the daily cadence. Presenter/channel filters are visible exploration controls, not hidden ranking. Label filtered counts separately from total source/update coverage.

Publishing groups describe the content being followed. They do **not** add reader-team accounts, shared workspaces or organization billing to the first release.

## Modularity without a sprawling first release

Keep collection adapters, identity/relationship handling, content analysis, recap assembly and reading views as separate responsibilities with clear inputs/outputs. Platform-specific collection details should not determine what a person or studio is. New analysis modules can later add sentiment/comments/audience measures without redefining identities, sources or citations. These are recommended design boundaries; they do not require separate services or a particular hosting layout.

Start with curated or explicitly evidenced relationships and available update credits. Exhaustive organization charts, automatic internet-wide guest discovery, face/voice identification and a visual relationship explorer are outside this candidate. Represent unknowns rather than making those capabilities prerequisites.

Trade-off: a flat creator/channel record or strict parent-child tree is simpler initially but fails joint channels, guest appearances and changing affiliations. Separate identities and relationships add setup/verification work while preserving accurate attribution and independent drill-down. This remains compatible with the Supabase recommendation; it does not select or provision a backend.

## Saved future demo cases

- One studio, two YouTube channels, a podcast and two presenters; show studio → person and studio → channel views.
- One person with a personal newsletter and contributions in two groups; a named guest who is not a group member.
- Follow studio/person/channel together, then remove one follow; count sources/updates once and explain remaining coverage.
- New channel discovered while near the source cap; preview inclusion without silent collection.
- Unknown presenter, same-name people, member who did not appear, and someone merely mentioned.
- Presenter leaves a studio, channel changes name and a credit is corrected; preserve/correct old history visibly.

These scenarios are specified for M0–M5 after whole-version approval. No new demo, live collection, identity extraction, application code or spending occurred in this checkpoint.
