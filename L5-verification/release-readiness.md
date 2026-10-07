# Release readiness: evidence register and execution order

Implementation baseline for this plan: `7c83cd3f7ec31c776d9f1723942003cf9484cb7a` on main, before this evidence-register refresh. The original evidence baseline was `490f01d16b2bba3bf4366b1b2706a4879df3004e`; historical receipts below remain preserved.
This register does not declare production readiness. Green build/test jobs,
`ALL_DONE`, and `verify: ok` do not close the L5 acceptance criteria.

## Verified baseline

Historical baseline readback command: `gh run view 37161757957 --json headSha,status,conclusion,url,jobs`.
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

The implementation starting point was main SHA
`08dbcc8a2adaa9071dac5cd41228d86ab6118e35`. The exact readback command
`gh run view 37251590964 --json headSha,status,conclusion,url,jobs` confirmed
[CI run 37251590964](https://github.com/dominator509/axiom/actions/runs/37251590964)
at that SHA completed with 9 successful jobs, 0 failed and 0 cancelled. This
current-main receipt supplements, and does not replace, the historical baseline
receipts above.

An earlier refreshed main SHA was `89285e73359cdee3f0771bfbb2f70b53593ac2db`.
Readback `gh run view 37501810909 --json jobs --jq ".jobs[] | [.name,.conclusion,.databaseId] | @tsv"`
confirmed [post-merge CI run 37501810909](https://github.com/dominator509/axiom/actions/runs/37501810909)
completed with 10 successful jobs, 0 failed and 0 cancelled at that exact SHA.
The browser job was rerun after its first attempt failed; the successful retry is
[job 112407323906](https://github.com/dominator509/axiom/actions/runs/37501810909/job/112407323906)
and ran `node scripts/rehearse-browser.mjs --isolated-fixture` on GitHub Actions
ubuntu-24.04 with Node 22.23.3. Its four positive journey reports each passed
37/37 checks, with 0 failures and 0 skips. The negative-brand control reported
4 passed and 1 expected rejection; the negative-cookie control reported 7 passed
and 1 expected rejection; both had 0 skips. Fixture cleanup was verified. The
raw browser job log SHA-256 is
`5a36d3114f1cb679151c899e5dfe171fe3497842db0ade5bcfe61573d7474128`.
The first browser attempt's transient schedule-page failure did not reproduce on
the same-SHA retry, but its cause is not established; this historical receipt
does not substitute for later candidate or final-SHA validation.

The current implementation baseline is `7c83cd3f7ec31c776d9f1723942003cf9484cb7a`.
Readback command `gh run view 37551519602 --repo dominator509/axiom --json headSha,status,conclusion,url,jobs`
confirmed [post-merge CI run 37551519602](https://github.com/dominator509/axiom/actions/runs/37551519602)
completed at that exact SHA with 10 successful jobs, 0 failed and 0 cancelled.
Its [test job](https://github.com/dominator509/axiom/actions/runs/37551519602/job/112567879426)
ran these commands in the ordered JS/TS matrix:

| Command | Passed | Failed | Skipped | Total |
| --- | ---: | ---: | ---: | ---: |
| `pnpm --filter @axiom/dashboard test` | 1121 | 0 | 0 | 1121 |
| `pnpm --filter @axiom/api test` | 1392 | 0 | 0 | 1392 |
| `pnpm test` | 4632 | 0 | 7 | 4639 |

The workspace total sums the 12 package reports and excludes the two direct
package invocations. CI also ran the frozen install, typecheck, lint, build and
dependency audit. It used Node 22.23.3, pnpm 9.14.0 and
`API_ORIGIN=http://127.0.0.1:3001`. The raw test-job log SHA-256 is
`81e5c27c53f6947009ed4c7f377e08fa80b01980497df952f4337c113eaf7402`.

The current [browser job](https://github.com/dominator509/axiom/actions/runs/37551519602/job/112567879047)
ran `node scripts/rehearse-browser.mjs --isolated-fixture` on GitHub Actions
ubuntu-24.04 with Node 22.23.3. Two default and two configured journeys each
passed 38/38 checks; the negative-brand control reported 4 passed and 1 expected
rejection, and the negative-cookie control reported 7 passed and 1 expected
rejection. There were 152 positive checks, 2 expected negative rejections,
0 unexpected failures, 0 skips, and verified fixture cleanup. Its raw log
SHA-256 is `a15b90b1a0b7c12e706a1f18441fe9274eccc7286ff7a33144d9c72e0080aff0`.

The current [L5 runtime job](https://github.com/dominator509/axiom/actions/runs/37551519602/job/112567879223)
ran `node scripts/rehearse-l5-runtime.mjs --isolated-fixture` twice in labeled,
network-disabled Docker/PostgreSQL/model fixtures: 46 passed, 0 failed,
0 skipped, cleanup verified. It exercised pinned inference, worker ToS and
handoff, fail-closed publish gates, uncertain Relay outcomes and audit-chain
tamper detection. Its raw log SHA-256 is
`83a987826306796e728ce7a25925e013919a6a9e46561ae8de950dab67fb4907`.
The current [container job](https://github.com/dominator509/axiom/actions/runs/37551519602/job/112567879347)
also built and smoke-tested all seven application images. The job's raw log
SHA-256 is `76767e6e3c07ebfe71ca688cd31e1a712cc277032d44c743026c9fab3ab51229`.
These are immutable local Docker image IDs, not published registry manifest
digests:

| Image | Local Docker image ID |
| --- | --- |
| hono | `sha256:90f906d5a9b02dcb6eabf2025911071e709c04b2bb6163dcae6492a7aff2d71c` |
| dashboard | `sha256:0b429b29403e77a9424cba146aff32a2876b95f46a621dd4038908730f55152d` |
| worker | `sha256:ca2b5e2267333348c0bcd40761b33c9e9f0df4e6adccfe273d5a7e20036c7a5d` |
| egress-plane | `sha256:a1c36fb580657b4cf658ad5bab223be1f4d3b4d998932f256d5caf56286d828d` |
| media-plane | `sha256:46b3ac34c62e8737354cf7481222fb5dd8212fb59b7a2ff7aa55675843d600c1` |
| vision-engine | `sha256:e8ddceec727545164c20e89e5fad4eeb40193dbcf657ecb3108613d578716fff` |
| scraper | `sha256:61d4747b0e3f10634eb4165259afec28d0bb2b3a4d0e00dba7e2a2fa8ff287d2` |

The container smoke receipt confirms service health/auth boundaries and recovery
after a database restart. The image-only vision check deliberately lacks the
external model artifact and does not prove inference; the separate L5 runtime
job above uses the checksum-pinned model. These hosted Docker checks establish
isolated behavior only; they do not establish real provider entitlement,
external delivery, or owner-deployed controls.

The same current-main [test job](https://github.com/dominator509/axiom/actions/runs/37551519602/job/112567879426)
ran `node scripts/rehearse-rls-catalog.mjs --isolated-fixture`: 20 passed,
0 failed, 0 skipped, with cleanup verified. This is an additional exact-SHA
disposable RLS receipt; deployed database state remains outside the evidence.
The raw log digest is the test-job digest above.

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

The refreshed main-SHA rehearsal at `09824ea15e07dba159b09ee1675cd9d2c6214e0d`
also passed 20/20 assertions with zero failures or skips and verified cleanup:
[CI run 37339600690](https://github.com/dominator509/axiom/actions/runs/37339600690),
[test job 111862985676](https://github.com/dominator509/axiom/actions/runs/37339600690/job/111862985676).
Its receipt preserves the earlier SHA and records the pinned PostgreSQL image and
raw-log digest. The required repeat on the eventual final release SHA remains open.

Items 3-8 remain open, and this does not authorize release. A Docker deployment
can establish isolated runtime proof. It cannot establish real provider
entitlement, real channel delivery, customer consent, month-long availability,
or the owner's deployed controls. Missing external prerequisites are blockers
for their rows; independent isolated work continues. No shared/production
database changes or migrations are permitted.

## Evidence format and gates

`release-evidence.json` contains 52 rows extracted from the normative sections of
L5.0 and L5.2. Dated checkpoint prose is excluded. Requirements are stored verbatim
with SHA-256 hashes. Each row also records its planned test, isolated environment,
prior-lane dependencies, required receipt contents, and exact completion condition.
Any addition, removal or textual change requires explicit reconciliation. Existing
partial and historical tests are not blanket acceptance; rows without accepted
lane receipts remain unverified with owning lanes and concrete next steps.

`release-evidence-invariant-crosswalk.json` maps every stable acceptance ID to
the exact canonical LBI property or marks it as independent acceptance. The
evidence gate derives the canonical ID/property catalog from `L0.0`, compares
the LBI numbering and names in `L5.0`, requires exact criterion coverage, and
rejects missing, unknown, duplicate, renamed, or mismatched references. A
criterion with no LBI citation remains an explicit independent acceptance row;
no invariant is invented to make the numbering appear continuous. This
crosswalk does not change normative requirement text or historical receipt
hashes.

`node scripts/check-release-evidence.mjs --check` validates coverage and receipt
shape while permitting open rows. CI runs it and its negative-control suite.
It prints **NOT release approval** even when the register is valid.

Each evidence entry contains `criterion`, tested `sha`, exact `command`,
`environment`, `scope`, `limitations`, `observedAt`, `ciUrl`, `jobUrl`, `logSha256`,
`counts` (passed/failed/skipped/total and tests/assertions/checks unit), individually
documented `skips`, and immutable `images` identities when images were used:
registry references use `name@sha256:<digest>`, while local Docker builds may
use the image ID reported as `sha256:<digest>`.
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
