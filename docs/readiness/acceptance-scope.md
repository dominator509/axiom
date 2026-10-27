# Acceptance scope correction

The audit at `d963c1c1a0585a9dd41c4eb585dd0432ec99fded` found three passed
criteria whose receipts established only part of the exact requirement. They
are now unverified. Historical receipts are preserved in the register's
`partialEvidenceAppendix`; they are excluded from passed-receipt verification.

| Criterion | Established evidence | Still required |
| --- | --- | --- |
| A1 | Native link-in-bio, provider configuration/composition and independent disable | Supported external FanLynks and Beacons.ai synchronization and lifecycle acceptance on dedicated authorized accounts |
| MATRIX-NFR-1 | Recorded L5 scale receipt at 1/5/10/20 models: four text batches and twenty synthetic targets/model; generation, ToS scan, approval, scheduling, per-job dispatch and queue-wait p95 are recorded. Post-merge exact-main M38 run 40459799462 on SHA `c199efb30dfc5941791dc8aa22a7a530dbfeba6f` measured hosted shared-buffer-cold retrieval p95 at 12.04/11.46/10.87/9.61ms at 1/5/10/20 models (50 samples/scale; all below 20ms). | Sustained and burst measurement against every applicable L1.2/L4 budget, including approval-to-dispatch, mobile TTI, target-host transcode/resources, actual Relay delivery, provider-backed cache telemetry and infrastructure cost; target-boundary retrieval if required |
| MATRIX-NFR-2 | Recorded scale cohort: 720/720 durable synthetic outcomes and 100% fixture availability at each scale, with per-scale windows | Permitted real-provider availability and production measurement; synthetic fixture results cannot establish external-provider availability |
| NONFUNCTIONAL-6 | Recorded isolated PITR run: 81/81 assertions, 14 expected rejections, cleanup verified; fixture RPO 295/300ms and database/API/worker restore 14844/14872ms; empty-WAL pg_verifybackup rejection passed in both drills | External R2 retention/KMS, production application/object recovery, real provider reconciliation, missing archived WAL during actual restore, and interrupted-base-backup behavior; repeat full acceptance at the final release SHA |
| MATRIX-CI | Post-merge exact-main run 40459799462 at SHA `c199efb30dfc5941791dc8aa22a7a530dbfeba6f`: all twelve jobs succeeded | Full L5.0 sections 1–4 coverage and acceptance; open provider, performance and feature-preservation rows cannot be replaced by job counts |

The [prior exact-main runtime job](https://github.com/dominator509/axiom/actions/runs/40297468512/job/121486918609)
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
availability, mobile TTI, media transcode, provider-backed LLM/cache behavior,
production resources and cost remain unmeasured. The post-merge exact-main [M38 cold retrieval job](https://github.com/dominator509/axiom/actions/runs/40459799462/job/122041435775)
on SHA `c199efb30dfc5941791dc8aa22a7a530dbfeba6f` measured shared-buffer-cold retrieval p95 of 12.04/11.46/10.87/9.61ms at
1/5/10/20 synthetic models (50 samples per scale). `pg_buffercache` verified application table, index
and TOAST pages absent before each sample, excluding free-space-map forks; the
hosted runner's OS page cache was not cleared and target-host resources were not
measured. This closes only the hosted retrieval submetric. Both MATRIX-NFR-1 and
MATRIX-NFR-2 remain open.

The [prior exact-main recovery job](https://github.com/dominator509/axiom/actions/runs/40307457559/job/121519989622)
is bound to source SHA `6f6706099b869a17bf7372f33310b5cc46dff227`; it passed 77
assertions with zero failures or skips and verified cleanup. Its two isolated
PITR drills reported fixture RPOs of 250/259 ms and database/API/worker restore
times of 14.265/14.297 seconds. The drills used Docker network isolation,
synthetic operator/provider state, and separate disposable media volumes. They
did not use Cloudflare R2, an external KMS/KEK, a production deployment or a
real provider; the provider-readback assertion was synthetic and no dispatch was
attempted. These fixture timings do not establish production RPO/RTO, and
NONFUNCTIONAL-6 remains unverified.

The [latest current-main recovery job](https://github.com/dominator509/axiom/actions/runs/40322076511/job/121569250600)
is bound to source SHA `a8506a8d757e523ab99a88be18f868838ac42729`; it passed 81
assertions with zero failures or skips and verified cleanup. Both isolated drills
reported fixture RPOs of 295/300 ms and database/API/worker restore times of
14.844/14.872 seconds. Each drill verified an empty external WAL directory and
confirmed pg_verifybackup rejects the base backup when required WAL is absent.
The new check does not simulate a PITR server blocked on a missing archived
segment or an interrupted pg_basebackup process. The runs used separate
disposable media volumes, synthetic operator/provider state and an in-memory
KEK; they did not use Cloudflare R2, external KMS/KEK, production deployment or
a real provider. These fixture timings do not establish production RPO/RTO, and
NONFUNCTIONAL-6 remains unverified.

The [latest current-main recovery job](https://github.com/dominator509/axiom/actions/runs/40343700326/job/121644874531)
is bound to source SHA `21465791aeb7bcec74f1adb00c7bc9d827d144f5`; it passed 83
assertions with zero failures or skips and verified cleanup, with 16 expected
rejections. The two isolated PITR drills reported fixture RPOs of 295/296 ms and
database/API/worker restore times of 16.577/16.722 seconds. Each fresh restore
with an empty archived-WAL volume exited with code 1 after PostgreSQL reported
that recovery ended before the configured target was reached. Both drills used
10 archived WAL segments, separate disposable media volumes, synthetic
operator/provider state, and an in-memory KEK. The missing-WAL control also
requires the post-backup target marker to be absent because PostgreSQL may
promote at the end of available WAL. Production still needs an operator-facing
target-integrity gate, an interrupted-base-backup rehearsal, Cloudflare R2
retention, external KMS, real provider reconciliation, and owner sign-off. These
fixture timings do not establish production RPO/RTO, and NONFUNCTIONAL-6 remains
unverified.

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
