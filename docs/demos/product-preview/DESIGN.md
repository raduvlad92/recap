# Visitor demo design brief

Prepared: 19 October 2026. Authorized by the founder's request for a visual, nonfunctional demo using the design skill. This is a separate design task; SPEC/PLAN v1.0 remain approval candidates. No backend, supplier connection, publication or trial is included.

## Purpose

Help a first-time visitor understand and want a daily, source-linked recap by letting them read one. Show chosen sources becoming connected topics, original attribution, explicit interests and dated history. Do not substitute generic AI marketing, feature promises or invented testimonials for the product.

## Design tokens

- Paper #FFFFFF: reading surface.
- Mist #F1F5FC: quiet page/utility surface.
- Ink #16243A: text and navigation.
- Cobalt #2858DD: selected state and principal actions.
- Lilac #E8E3FA: secondary context and reference accent.
- Slate #5E6C82: secondary copy; use readable contrast.

Type: Onest, one deliberate sans family, 400–700, with system sans fallback. Large tightly set headline; 16px reading text and a disciplined 12/14/16/20/28/40/64 scale. No serif/cream/clay treatment, tracked uppercase labels or decorative mono metadata.

## Layout options considered

A. Hero + three feature cards + dashboard screenshot: familiar, but defers understanding and could sell any summary product. Rejected.

B. A compact split editorial introduction followed by an actual explorable reading surface: chosen. All major copy is left aligned. Desktop keeps a dated left rail, readable central recap and right-hand source context. Mobile turns date history into a horizontal day chooser and moves secondary controls below the recap.

```text
brand        How it works       Explore the sample
large promise                  short explanation / sample CTA
chosen platform formats
┌ date history ┬ daily recap and all updates ┬ chosen sources ┐
│ Mon / Sun   │ 3 connected topics          │ original links │
│ Sat quiet  │ expandable evidence         │ your interests │
└─────────────┴─────────────────────────────┴────────────────┘
choose people → read connected topics → keep the thread
closing invitation to explore this sample, no signup collection
```

## Review before build

Revised the initial generic 'control dashboard' concept into a reading-first page. Removed feature-card grids, savings numbers, testimonial avatars, pricing and signup forms. The memorable element is the transformation from recognisable source formats into one calm dated brief. Structure comes from the actual information: date rail, topic hierarchy, source attribution and creator-linked references. Varied surface sizes reflect those roles instead of uniform cards.

## Content and local interactions

All creators, products, updates, snippets and references are fictional. A persistent but small notice makes this clear. Use seven updated sources across the seven planned families, plus one checked/quiet and one delayed source to keep coverage honest: nine followed, eight checked, seven updated, seven analyzed. These are fixture counts, not actual collection.

Local interactions only: recap/all-updates/source views, three dates including quiet day, expanded source evidence, fictional-original/reference previews, preferences preview showing future-only changes, and explanatory source selection. No simulated signup, account connection, fresh sync, email delivery or payment. Buttons name what they really do.

## Finish and evidence

Review screenshots at desktop, 728px and 360px; verify local controls, coverage counts, reduced motion, keyboard focus, layout overflow and original/reference distinction. Save exact evidence and review notes in this folder and docs/DEMO-LOG.md. Keep the source self-contained for reopening without a build tool. Nothing is published.
