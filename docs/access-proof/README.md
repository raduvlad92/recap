# Source-proof execution evidence

The founder approved [ACCESS-PROOF.md v0.1](../ACCESS-PROOF.md) in Q6. The full product specification remains a draft.

Current direction D08 defers all live scraper checks and authentication; supplier capability is assumed for product planning. No recurring job is running, and no further collection/spending is requested now.

The candidate source files are research inputs. The normalized `sources.json` is the frozen 35-source sample once preparation is complete. Changes need a recorded reason; a failing source must not silently disappear from the denominator.

The sample is now frozen. Start with [PREFLIGHT.md](PREFLIGHT.md) and `results/preflight-2026-10-15-final.json` for the reviewed 15-feed check. Earlier reports preserve parser diagnostics; they are superseded for interpretation by the final report. Social-provider jobs have not run.

`cost-ledger.json` records actual cash, known provider credit and generated-audio minutes. Unknown balances remain unknown. The cap is €50 total and 150 generated-audio minutes. No recurring paid collection starts without verified account/charging controls.

`scripts/access_proof.py` runs bounded public-feed checks without paid APIs or audio downloads. It stores raw responses in ignored `.local/access-proof/` and small metadata/hash reports in `results/`. A successful feed fetch establishes access to that feed, not the original item's completeness or spoken podcast content.

Example after the normalized manifest is saved:

```sh
python3 scripts/access_proof.py --label preflight-2026-10-15 --families blogs,newsletters,podcasts
```

Run labels are unique; the script refuses to overwrite evidence. Existing descriptions/show notes never count as full podcast understanding. The formal seven-day observation window starts only after all platform baseline routes and repeat-run controls are ready; earlier checks are preflight diagnostics.

Record provider run IDs, scraper/build versions, exact inputs and billed events for social results. Never store account credentials, cookies or full personal datasets in Git. A missing response is not proof of deletion. No report may call a single successful fetch a seven-day pass.
