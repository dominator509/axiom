# Release readiness: evidence register and execution order

Baseline: `490f01d16b2bba3bf4366b1b2706a4879df3004e` on main.
This register does not declare production readiness. Green build/test jobs,
`ALL_DONE`, and `verify: ok` do not close the L5 acceptance criteria.

## Verified baseline

Readback command: `gh run view 37161757957 --json headSha,status,conclusion,url,jobs`.
[CI 37161757957](https://github.com/dominator509/axiom/actions/runs/37161757957)
completed with 8 successful jobs, 0 failed and 0 cancelled at the baseline SHA.
Those are job counts, not test counts. Full output was retrieved with
`gh run view 37161757957 --log`; private local copies are under ignored
`var/release-baseline/`. Logs remain downloadable from the linked jobs while
GitHub retains them. Retention expiry means evidence must be renewed.

The [test job](https://github.com/dominator509/axiom/actions/runs/37161757957/job/111316474935)
records these exact commands and counts:

| Command | Passed | Failed | Skipped | Total |
| --- | ---: | ---: | ---: | ---: |
| `pnpm --filter @axiom/dashboard test` | 1094 | 0 | 0 | 1094 |
| `pnpm --filter @axiom/api test` | 1353 | 0 | 0 | 1353 |
| `pnpm test` | 4537 | 0 | 7 | 4544 |

The full workspace total sums its 12 package reports, excluding the two earlier
direct invocations. Its seven skips are five DB readiness cases and two gateway
cases; they are not accepted release assertions. The same job ran frozen install,
typecheck, lint, build and dependency audit successfully. These commands are
checks, not additional test counts. CI used Node 22.23.3, pnpm 9.14.0 and
`API_ORIGIN=http://127.0.0.1:3001`.

The [container job](https://github.com/dominator509/axiom/actions/runs/37161757957/job/111316474875)
built all seven images using the commands in `.github/workflows/ci.yml`. Build
output recorded these local image IDs (not published registry manifest digests):

| Image | SHA-256 image ID |
| --- | --- |
| hono | `1aad31bdd8d61888b282d56715462b323465a892b5e4bda8511d9fd30af6ce58` |
| dashboard | `b497f5b78160363fef7245df11de4120db36c59f4e0a6efd04845a9322351d17` |
| worker | `f13c8ed4630fb5ea7f5110f5d60df217e2fdf0170c0e05cce34b9db4069f3c12` |
| egress | `931a105eae31a2446090816b62f9175bbd47524de0c61b18e288d6a8027a0986` |
| media | `b1365d3ac4df020439a731507b807ab248cb790c8d10e7a2809f8ac00fc5fa82` |
| vision | `463fe79adf5b3c3aaac95ee699bf8d95037bc9abed2c9ddef37bcec39fe1166f` |
| scraper | `92043a998989eac17a2b11c87f40f45b4f7fa6014d1fa68e79eb300f2b984708` |

Vision container CI does not exercise model inference. Baseline browser and
egress results are available in their jobs; none proves live provider acceptance.

## Execution order

One focused PR at a time, verified green at its exact head before merging under
the owner's standing authorization. Recheck main CI after each merge.

1. Evidence register: complete L5 coverage, historical baseline and fail-closed
   validator. This PR; hosted validation is required before completion.
2. Effective RLS catalog: derive tenant tables from schema, inspect migrated flags,
   policies and runtime-role privileges, and run cross-tenant negative controls.
   Isolated acceptance passed at `d8bfb217b4549e8b53c513de71fd92c1ea499c95`;
   deployed-state inspection remains outside this lane.
3. L5 matrix: extend real isolated stack/browser journeys and negative controls;
   include pinned-model inference, unknown dispatch and durable audit outcomes.
4. Providers/Relay: real dedicated accounts or sandboxes and supported hardware;
   connection, dispatch, remote readback, reconciliation, revocation and cleanup.
5. Deployment/egress: exact images, readiness, restart/rollback, real network
   faults, <=5s kill switch and observable incidents in an owned environment.
6. Performance/cost: 1-20 models, recorded resources and workload, specified
   latency budgets, >97% measured provider token-cache hits, cost and availability.
7. Recovery: fresh-cluster PITR and object/key restoration, RPO <=5m/RTO <=60m,
   egress disabled, negative controls and two repeatable drills.
8. Product/sign-off: F01-F91, six locales, desktop/native-mobile actions, synthetic
   consent-vault controls, owner records attestation and release-specific sign-off.

Lane 2's isolated effective-RLS acceptance passed at main SHA
`d8bfb217b4549e8b53c513de71fd92c1ea499c95`: [CI run 37211855138](https://github.com/dominator509/axiom/actions/runs/37211855138),
[test job 111464478851](https://github.com/dominator509/axiom/actions/runs/37211855138/job/111464478851)
reported 20 passed/0 failed/0 skipped with cleanup verified. The evidence is
limited to its disposable migrated database and locale cross-tenant negative
controls; it does not inspect a deployed database or prove exhaustive CRUD for
every tenant table. The release register retains those exact-SHA receipts.

Items 3-8 remain open, and this does not authorize release. A Docker deployment
can establish isolated runtime proof. It cannot establish real provider
entitlement, real channel delivery, customer consent, month-long availability,
or the owner's deployed controls. Missing external prerequisites are blockers
for their rows; independent isolated work continues. No shared/production
database changes or migrations are permitted.

## Evidence format and gates

`release-evidence.json` contains 51 rows extracted from the normative sections of
L5.0 and L5.2. Dated checkpoint prose is excluded. Requirements are stored verbatim
with SHA-256 hashes. Any addition, removal or textual change requires explicit
reconciliation. Existing partial and historical tests are not blanket acceptance;
rows without accepted lane receipts remain unverified with owning lanes and
concrete next steps.

`node scripts/check-release-evidence.mjs --check` validates coverage and receipt
shape while permitting open rows. CI runs it and its negative-control suite.
It prints **NOT release approval** even when the register is valid.

Each evidence entry contains `criterion`, tested `sha`, exact `command`,
`environment`, `scope`, `limitations`, `observedAt`, `ciUrl`, `jobUrl`, `logSha256`,
`counts` (passed/failed/skipped/total and tests/assertions/checks unit), individually
documented `skips`, and immutable `images` references when images were used.
`logSha256` hashes the raw bytes from `gh api repos/dominator509/axiom/actions/jobs/<id>/logs`.
Do not hash a terminal transcript or normalized PowerShell output instead.
No secret values, authenticated URLs or private records belong in this register.

`node scripts/check-release-evidence.mjs --release <full-sha>` requires every row
passed with zero failures/skips, exact-SHA receipts, and `signoff` containing that
SHA, the owner identity and approval reference. It then reads GitHub run and job
metadata and raw logs, checks successful completion and exact source/run identity,
and verifies each log hash. Unavailable evidence fails closed.

This validates completeness, provenance and freshness, not the meaning of a test.
Reviewers must verify that the command/assertions cover the criterion, reported
counts match the logs, the environment is appropriate, and the approval reference
is genuine. The signoff field cannot grant permission or authorize deployment.
Re-run acceptance for a changed release SHA; do not copy historical receipts into
new acceptance rows. If a candidate passes and is then merged into a new commit,
post-merge execution supplies the release receipts for that new SHA.
