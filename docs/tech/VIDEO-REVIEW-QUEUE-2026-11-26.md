# Review a video in one pass

The pending queue loads six whole source groups per page. Open a video to see the ranked drafts and inspect the original evidence. Use Up and Down to move between video headers or between visible drafts, Enter to open, and Tab to reach actions. Manual selection, individual editing and decision history are still available.

**Approve all grounded** stages a video's eligible proposals. **Reject low-score** stages empty malformed or truncated attempts. You can stage several videos and undo either action for a video or clear the whole selection. Each explicit **Apply and publish** or **Apply rejections** sends up to 250 decisions. After a confirmed response, the rest stay staged for a separate apply. If a response cannot be confirmed, reload to reconcile the attempted decisions, then stage any remaining decisions again.

The score describes saved evidence. 100 requires a supported automatic draft and a matching current transcript. 50 means the draft or failure needs individual review. 0 marks an empty, recoverable format failure. An old, legacy or unmatched review has no score. Proposals associated with tasks created before November 25 stay outside the shortcuts, including the November 11 proof the founder chose to keep held. Unresolved-charge cases require individual inspection. The server rechecks batch eligibility and the exact review revision. Each decision uses the existing publication and audit transaction. Conflicts are reported per item and unexpected errors roll back the request.

## Evidence and release

- Disposable PostgreSQL tests cover service-only access, source and review revision checks, score boundaries, held cases, publication and rejection. UI and handler tests cover explicit apply, undo and untrusted responses.
- Headless Chrome at [1440 px](evidence/video-review-2026-11-26/1440.png) and [390 px](evidence/video-review-2026-11-26/390.png) exercised the shipped review component with synthetic data. Both sizes passed keyboard movement, zero requests while staging and undoing, the fixture apply response, and nested width checks.
- Apply `20261126004139_admin_video_review_batches.sql` in the coordinated post-R1 window before serving this UI. The migration adds three service-role-only functions and performs zero existing-row writes. Check both environments together once released. No real review decision, provider call or deployment was part of this change. The owner's elapsed review time is still unmeasured.
