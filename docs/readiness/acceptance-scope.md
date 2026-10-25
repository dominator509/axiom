# Acceptance scope correction

The audit at `d963c1c1a0585a9dd41c4eb585dd0432ec99fded` found three passed
criteria whose receipts established only part of the exact requirement. They
are now unverified. Historical receipts are preserved in the register's
`partialEvidenceAppendix`; they are excluded from passed-receipt verification.

| Criterion | Established evidence | Still required |
| --- | --- | --- |
| A1 | Native link-in-bio, provider configuration/composition and independent disable | Supported external FanLynks and Beacons.ai synchronization and lifecycle acceptance on dedicated authorized accounts |
| MATRIX-NFR-1 | Four text prompt batches and twenty synthetic targets/model at 1/5/10/20 models; queue wait and per-job dispatch timing | Sustained and burst measurement against all applicable L1.2/L4 latency budgets, including approval-to-dispatch, mobile TTI, transcode, Relay delivery and retrieval |
| MATRIX-CI | Exact-SHA successful readback of the existing twelve jobs | Full L5.0 sections 1–4 coverage and acceptance; open provider, performance and feature-preservation rows cannot be replaced by job counts |

The [main runtime job](https://github.com/dominator509/axiom/actions/runs/40178065406/job/121122970105)
passed 127 checks with cleanup verified. Its twenty-model burst completed all
400 synthetic targets. Queue-wait p95 was 23,451.39 ms and individual dispatch
p95 was 95.95 ms. The harness advances fixture-only future schedule timestamps;
neither measurement is the required approval-to-dispatch interval. These numbers
do not prove the under-two-second budget, nor do they establish an exact live-SLO
failure with a different measurement boundary. The missing measurement remains
open. LLM enrichment, native-device timing and real provider delivery were not
measured by this cohort.

The evidence validator now derives the matrix dependency set from the normative
L5.0 requirement source. A passed `MATRIX-CI` requires every section 1–4 criterion
to be passed. This prevents an all-green job receipt from overriding failed,
blocked or unverified acceptance. Separate L5.2 owner sign-off remains required
for release even after matrix acceptance is complete.

Regression evidence: four narrow-job/full-matrix false passes were reproduced
before the guard. After the change, all 71 evidence-validator tests passed with
zero failures or skips, including the separate human-sign-off boundary. This
guard checks consistency, not the semantic sufficiency of every receipt; review
must still match each receipt's actual scope to its requirement.

Current canonical count: 28 accepted, 23 unverified, 3 blocked. The separate
historical Venice diagnostic remains a measured cache-threshold failure (see
`venice-cache-pilot.md`); it cannot be promoted by green CI or inferred from local
cache counters. Actual provider/native/owner evidence remains required. No
production deployment, shared database access or external publication occurred.
