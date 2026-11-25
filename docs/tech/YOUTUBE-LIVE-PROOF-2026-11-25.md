# Live YouTube ingestion proof — 25 November 2026

Three immediate Apify runs collected six distinct videos with timed captions. All six were newly present in the production archive on the 01:29 UTC readback.

| Channel | Video | Caption segments |
| --- | --- | ---: |
| TechLinked | [Yaaay Number Go Back Up](https://www.youtube.com/watch?v=kibDx91B6eg) | 286 |
| TechLinked | [The “Good Guys” Just Sold Out](https://www.youtube.com/watch?v=lKfft75VvfQ) | 340 |
| ShortCircuit | [This Phone is Fire](https://www.youtube.com/watch?v=iTAsOxThOFA) | 582 |
| ShortCircuit | [Professional 3D Printing for less](https://www.youtube.com/watch?v=GBCfagEoRDI) | 517 |
| GamersNexus | [Jensen Returns to NVIDIA](https://www.youtube.com/watch?v=gF09cRVoX_w) | 1,396 |
| GamersNexus | [HW News](https://www.youtube.com/watch?v=l8qxFcaLSM4) | 1,036 |

The result covers existing timed captions. Video format is unknown for all six records. The test used the production source leases, provider reservations, normalization, and archive import. Supabase readback matched all six source/video identities and the three settled provider records.

The pinned build `0.0.319` was unavailable. Replacement build `0.0.340` passed the same Actor, authenticated account, input schema and pricing checks. The three exact-video reservations were USD 0.008 each. Final authenticated provider readbacks reported USD 0.008 per run. Two initially lower fees were corrected with immutable upward receipts, and the initially unknown fee was settled. The proof envelope closed at USD 0.024. The pre-existing 12 reader fee holds and daily and lifetime caps were preserved.

Both production Workers now serve the checked replacement configuration on application release `e6ce627`, epoch 8. The expired hourly job was recorded as uncertain. The other 135 stale ticks were recorded as superseded before start. One newly queued hourly frame completed at 01:28:57 UTC. The readback showed zero queued, running, or expired-running frames and anonymous admin HTTP 401. The transport check started zero additional Apify runs.

The recurring pilot covers TechLinked with a finite USD 0.04 reserved envelope, subject to the existing reader caps. The three-channel proof ran immediately through the live provider and archive. Future recurring acquisitions on the new configuration and broader scheduled coverage need their own evidence. The existing worker can still leave a stale hourly lease after cancellation. The transport repair in this operation recovered the specific expired frame.
