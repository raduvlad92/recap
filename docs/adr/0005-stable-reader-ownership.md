---
status: accepted
date: 2026-11-07
---

# Retain stable reader ownership across sign-in instances

Keep each existing application's reader owner key unchanged and bind a verified sign-in through an explicit, unique `(issuer, subject)` alias. Clerk development subjects cannot be carried into production unchanged; rewriting owner keys would also rewrite financial, job and audit history. This preserves that history at the cost of a private, audited linkage boundary and a separately reviewed account-recovery/enrollment process. Email and display-name matches never establish ownership.

Clerk user lookups and administrator checks use the actual verified provider subject; reader data, jobs and browser caches use the resolved owner. The foundation defaults to the existing legacy subject behavior. Linked mode requires exact issuer trust, an explicit alias and authoritative deletion checks; its lifecycle adapter fails closed without the actual account-deletion contract, and linked readiness starts off. Production activation, identity binding and the parent-owned deletion integration are separate work. [Implementation, evidence and integration limits](../tech/READER-IDENTITY-2026-11-07.md).
