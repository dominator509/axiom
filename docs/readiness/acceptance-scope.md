# Acceptance scope correction

The audit at `d963c1c1a0585a9dd41c4eb585dd0432ec99fded` found three passed
criteria whose receipts established only part of the exact requirement. They
are now unverified. Historical receipts are preserved in the register's
`partialEvidenceAppendix`; they are excluded from passed-receipt verification.

| Criterion | Established evidence | Still required |
| --- | --- | --- |
| A1 | Native link-in-bio, provider configuration/composition and independent disable | Supported external FanLynks and Beacons.ai synchronization and lifecycle acceptance on dedicated authorized accounts |
| MATRIX-NFR-1 | Current-main L5 receipt at 1/5/10/20 models: four text batches and twenty synthetic targets/model; generation, ToS scan, approval, scheduling, per-job dispatch and queue-wait p95 are recorded | Sustained and burst measurement against every applicable L1.2/L4 budget, including approval-to-dispatch, mobile TTI, transcode, Relay delivery and retrieval |
| MATRIX-NFR-2 | Current-main scale cohort: 720/720 durable synthetic outcomes and 100% fixture availability at each scale, with per-scale windows | Permitted real-provider availability and production measurement; synthetic fixture results cannot establish external-provider availability |
| MATRIX-CI | Exact-SHA successful readback of the existing twelve jobs | Full L5.0 sections 1–4 coverage and acceptance; open provider, performance and feature-preservation rows cannot be replaced by job counts |

The [current-main runtime job](https://github.com/dominator509/axiom/actions/runs/40297468512/job/121486918609)
is bound to source SHA `e286c0943e7fdf20e4e0d880978a15473bd23048`; its receipt
passed 127 checks with zero failures or skips and verified fixture cleanup. One
scale cohort completed 720/720 durable synthetic targets at 1/5/10/20 models.
In that scale order, queue-wait p95 from burst start was 346.27/1875.09/6717.92/
19695.01 ms and per-job worker-dispatch p95 was 27.19/24.77/49.87/80.44 ms.
Generation, ToS scan, approval and scheduling timings are recorded separately in
the evidence register. At 20 models, the publishing window was 20.047 seconds
and the full workload window was 27.294 seconds. The second runtime repetition
contributes checks but no second scale cohort. This receipt does not measure
approval-to-dispatch directly: worker dispatch and queue wait have separate
boundaries, and future schedule timestamps are advanced only for fixture IDs.
The local Discord provider fixture is not Relay delivery, and external provider
availability, mobile TTI, media transcode, cold-query/retrieval, provider-backed
LLM/cache behavior, production resources and cost remain unmeasured. Both
MATRIX-NFR-1 and MATRIX-NFR-2 remain open.

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

The first PR runtime run also exposed a barrier mismatch in the existing
approval/draft race rehearsal: the wait helper returns once at least one request
is blocked, but its caller asserted exactly one. The observed count was two,
which satisfies the intended barrier. The caller now accepts at least one;
the unchanged checks still require both requests to remain pending before the
lock is released, one 200 and one 409 response afterward, and the correct durable
bundle, target, job and audit state. The failed run is retained; the new commit
requires a fresh complete runtime receipt rather than a retry of the old head.

Current canonical count: 28 accepted, 23 unverified, 3 blocked. The separate
historical Venice diagnostic remains a measured cache-threshold failure (see
`venice-cache-pilot.md`); it cannot be promoted by green CI or inferred from local
cache counters. Actual provider/native/owner evidence remains required. No
production deployment, shared database access or external publication occurred.
