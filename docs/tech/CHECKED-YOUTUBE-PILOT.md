# Checked three-channel YouTube pilot

The initial installation is empty. The serving TechLinked bindings are the fallback when the private pilot row is absent. This candidate requires its exact checked main release and migration before the three-channel scope can be accepted. Review the existing [scope and cost proposal](https://github.com/raduvlad92/recap/pull/43) and [checked release procedure](CLOUDFLARE-RELEASE-CONTROLLER.md).

## Reviewed admission

The private pilot binds the existing reader, the live hosting epoch and release, and these public channel IDs.

| Channel | Exact ID |
| --- | --- |
| TechLinked | `UCeeFfhMcJa1kjtfZAGskOCA` |
| ShortCircuit | `UCdBK94H6oZT2Q7l0-b0xmMg` |
| GamersNexus | `UChIs72whgZI9w6d6FhwGGHA` |

The server admits one discovery reservation of $0.020 and at most one queued caption fallback of $0.005 per channel on each UTC day. The same limit holds across source aliases. A tick keeps its starting UTC day. A stale-day reservation fails before launch. Discovery has a hard ceiling of $0.060 per eligible tick, or $0.075 with captions. Thirty days of full reservations total $2.25 and 31 days total $2.325. The dedicated envelope holds $2.50 inside the shared $20 Apify and OpenRouter cap. The existing reader daily and lifetime constraints can stop it sooner. The existing settlement mechanism carries open or uncertain charges.

A discovery uses only the reviewed provider and can poll its own existing run briefly within the normal source deadline. It imports exact dated channel results and reuses bundled captions. If a trusted discovery record has a checked watch identity, an exact duration above 180 seconds and compatible timed captions beyond 180 seconds, it can enter the regular feed. A short duration supplies no positive Shorts evidence. Existing explicit format and unresolved outcomes still take precedence.

## Installation and rollback

1. Verify the accepted GitHub checkpoint and exact serving web and jobs versions. Keep the ordinary TechLinked bindings in both versions. Confirm that the new migration is present at its reviewed digest, the hourly queue is drained, and the checked release is paused with no pending intent. Confirm the reader source-state identities and read the live monthly commitment. Preserve current worker flags.
2. Save the epoch, serving release, current revision, a fresh resume UUID, the exact reader owner, reviewed channel IDs and initial proof UTC date privately. Start with `p_recurring=false`. Choose a date with an eligible future hourly slot and a second scheduled tick before UTC midnight. The service-role RPC `restore_hourly_youtube_pilot_checked(p_epoch, p_release, p_expected_revision, p_resume_revision, p_reader_id, p_channel_ids, p_recurring, p_proof_day)` validates the immutable reviewed list and follows, reserves the finite envelope, installs the scope and resumes through the existing checked transition in one transaction. Run once for the approved intent. Reconcile an ambiguous response by reading the same revision before further action. Verify the expected channel IDs, envelope cap and live revision.
3. Observe the first genuine hourly tick and its successor. Record provider run and fee receipts, exact source and upload IDs, publication times, archived transcripts, verified format and signed-in card placement. Check that the next tick has no duplicate discovery reservation or archive row. Empty, incomplete and denied checks have separate outcomes. The initial scope can reserve only on the reviewed proof UTC date. After successful proof, use a new checked paused revision and restore the same scope and proof date with `p_recurring=true` to enable later days within the same envelope.
4. On a failed or over-budget proof, quiesce through the existing checked path and drain. Call the same scope restoration with the new paused revision and resume UUID and both reader and channel arguments null. It removes the pilot, resumes the existing TechLinked-only bindings, and retains settlement history and holds. Reconcile outstanding fees independently.

On a later serving release change, an installed scope must be reattached or rolled back through the checked path. A release mismatch blocks admission. Applying the migration alone adds definitions and empty private tables. Activation, backfill and provider execution are independent.
