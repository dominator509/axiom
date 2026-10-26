# Release readiness: evidence register and execution order

The 2026-10-25 scope audit corrects the current register to **28 accepted and
26 open criteria (23 unverified, 3 blocked)**. `A1`, `MATRIX-NFR-1` and
`MATRIX-CI` are reopened: local provider configuration does not establish live
external synchronization, synthetic per-job timing does not establish all load
budgets, and successful existing jobs do not establish the full matrix. Their
original receipts remain in `partialEvidenceAppendix` with their actual SHAs.
No normative requirement was weakened. The validator now rejects a passed
`MATRIX-CI` while any criterion in L5.0 sections 1–4 is open.

The application baseline is `d963c1c1a0585a9dd41c4eb585dd0432ec99fded`:
[post-merge CI](https://github.com/dominator509/axiom/actions/runs/40178065406)
passed all 12 jobs. An external source-bound packet with these conservative
statuses passed hosted receipt verification; this is not release approval.
See [the scope audit](../docs/readiness/acceptance-scope.md) for evidence limits.
The checkpoints below are historical, including their earlier acceptance counts.

The post-M23 exact-main checkpoint (2026-10-26) is SHA
`9c26d5726ca01ad59e9dded8fe74a76ee26b96d4`. Post-merge CI run
[40291129200](https://github.com/dominator509/axiom/actions/runs/40291129200)
completed with 12/12 jobs successful. Its `ci (test)` job ran
`node scripts/rehearse-rls-catalog.mjs --isolated-fixture` against the pinned
TimescaleDB PostgreSQL 16 image: 32 assertions passed, 0 failed, 0 skipped, and
cleanup verified. Raw job-log SHA-256:
`aaa9ad88eb5f5a61131b635f7c89bea0cc1e403f57ca6be1b78597f8ad32af60`. The
source-bound RLS receipt is recorded for LBI-01, NONFUNCTIONAL-2, and SECURITY-2.
It covers an owned disposable database only; deployed/shared database
acceptance, exhaustive CRUD for every tenant table, and final-release-SHA replay
remain open. The register remains 28 accepted and 26 open, valid, and **not
release approval**. Full `--verify-receipts` at this SHA correctly fails closed
at LBI-02 because its accepted receipt still has a stale evidence SHA; complete
exact-SHA verification of the accepted set remains open.

Application-code baseline for this evidence refresh (2026-10-24) is `f140fe0b2ec9b8c23fd15f6b0035f2e2e0954ebf`, merged from PR #203. A fresh fetch confirmed main and origin/main at this SHA with zero divergence and a clean checkout before the documentation change. `rtk node scripts/check-release-evidence.mjs --check` reports 54 criteria: 31 accepted and 23 open (20 unverified, 3 blocked); the register is valid and is **not release approval**. Hosted metadata readback confirms that exact-main [CI run 38366040912](https://github.com/dominator509/axiom/actions/runs/38366040912) completed with 12 successful jobs, 0 failed, 0 cancelled, and 0 skipped jobs. This is job-status readback, not a new assertion/log audit or an exact-SHA acceptance receipt. Accepted rows retain their actual tested SHAs and still need replay against the eventual final release SHA.

PR #203 recorded the existing synthetic browser receipts for LBI-12 and
SECURITY-7, moving the register from 29 accepted/25 open to 31 accepted/23 open.
Those receipts target `8c165bed97d8a18d2a5b6441aae7c29e626f42a8`, not this
refresh's baseline. Their recorded scope covers isolated consent enforcement,
model-scoped access and encrypted 25 MiB DNG upload/download; it does not prove
native-device acceptance, production vault population, owner attestation, or
release sign-off. No receipt or normative requirement is changed by this refresh.

The 2026-10-24 candidate [CI run 40158198520](https://github.com/dominator509/axiom/actions/runs/40158198520)
at `2f1be6627f4cf845a5127606472d90a9d9a5d7be` failed its security job:
`cargo audit` found eight advisories in five locked dependencies, published
after the baseline. The follow-up pins `ctutils` 0.4.4, `rustls` 0.23.46,
`rustls-webpki` 0.103.16, `webpki-root-certs` 1.0.10 and `webpki-roots` 1.0.10.
It also pins Tokio 1.53.3 to resolve the newly reported AsyncFd I/O-safety warning.
The subsequent candidate run 40158631893 exposed the JavaScript audit failures:
Next.js is updated to 15.5.28, Vite to 6.4.4, Undici to 6.29.1/8.12.2 and Zod v4
to 4.6.6. Zod 3.25.76 retains the app's v3 APIs with the bounded-collection
backport described in `patches/zod-size-backport.md`; source integrity and
runtime/negative-control checks are mandatory before exact-advisory recognition.
These dependency changes require fresh exact-head CI before merge; the
historical green baseline does not establish current dependency security.

This register does not declare production readiness. Green build/test jobs,
`ALL_DONE`, and `verify: ok` do not close the L5 acceptance criteria. At the
historical 2026-10-09 checkpoint `69c97cb814e93410af53219d634537b436a395d1`,
`rtk node scripts/check-release-evidence.mjs --check` reported 54 criteria,
22 accepted, and 32 open; the register was structurally valid but not release
approval. At that historical baseline, the release gate remained blocked by
stale receipts for other passed criteria and by open criteria. Earlier RLS
checkpoints, including `11d970c1486a83dfae4e65a86915605437c5cad3`, are retained
below as history. Repeat the complete RLS matrix on the final release SHA after
the remaining lanes. Accepted rows retain their actual tested SHAs. A post-run
external register cannot redefine acceptance criteria, and this document does
not authorize release.

PR #139 records the owner's permanent removal of a fixed 30-day availability
observation period. The ≥99.5% target remains; acceptance reports the actual
sample window, denominator, and provider availability separately.

## Previous exact-main checkpoint (2026-10-12; SHA 29de9f3)

Exact-main [CI run 38189597974](https://github.com/dominator509/axiom/actions/runs/38189597974)
completed 12/12 jobs successfully (0 failed, 0 cancelled, 0 skipped). The
`ci (test)` job ran `node scripts/rehearse-rls-catalog.mjs --isolated-fixture`
against network-disabled disposable PostgreSQL with Node 22.23.3 and the pinned
TimescaleDB PostgreSQL 16 image. It checked the migrated forced-RLS catalog and
application role, rollback-only RLS fault controls, tenant isolation, rollback,
and cleanup: 20 assertions passed, 0 failed, 0 skipped. The raw job-log SHA-256
is `7743d8082fa20c836eca1286f5cd31862c3388a75021cdaef190cc550254620f`; the
job is [ci (test)](https://github.com/dominator509/axiom/actions/runs/38189597974/job/114619287785).
The source-bound receipt is recorded for LBI-01, NONFUNCTIONAL-2, and SECURITY-2.
This is disposable-database evidence only; deployed/shared database state and
the final-release-SHA replay remain open.

The same run's [browser job](https://github.com/dominator509/axiom/actions/runs/38189597974/job/114619287747)
ran `node scripts/rehearse-browser.mjs --isolated-fixture`. The default and
configured journeys each reported 39 passed, 0 failed, 0 skipped. The
negative-brand control reported 4 passed, 1 expected failure, 0 skipped; the
negative-cookie control reported 7 passed, 1 expected failure, 0 skipped. The
journeys cover schedule navigation, synthetic 25 MiB DNG consent upload and
publishing boundaries, persona and handoff, safe Patreon/Snapchat setup states,
scrape validation, automation explanations, link-in-bio provider boundaries,
and mobile Relay action labels. The browser environment is isolated; this does
not verify the deployed test domain, live provider credentials, or native-device
acceptance. The raw browser job-log SHA-256 is
`a86d00b756eb4db4ca5b05c108437ca6782f6033aefd2ffdf4e73b543552e9a1`.

## Previous exact-main RLS refresh (2026-10-11; SHA fb25f47)

This earlier effective-RLS rehearsal was run against exact main
`fb25f47f9eda2940e5dcdbe608e6d127c8f393b5`. Exact-main
[CI run 38158846335](https://github.com/dominator509/axiom/actions/runs/38158846335)
completed 12/12 jobs successfully (0 failed, 0 cancelled). Its `ci (test)` job
ran `node scripts/rehearse-rls-catalog.mjs --isolated-fixture`: 20 assertions
passed, 0 failed, 0 skipped, with cleanup verified. The job used a
network-disabled disposable PostgreSQL instance and the pinned Timescale image.
The raw job-log SHA-256 is
`c409ab9c7bd9f4e3e1fdade579fee1afc91e70a808699ef3e64ad2dca92410a7`. The
source-bound receipt is recorded for LBI-01, NONFUNCTIONAL-2, and SECURITY-2 in
`release-evidence.json`. Deployed-database state and exact-final-release-SHA
verification remain open.

## Previous exact-main RLS refresh (2026-10-11; SHA 11d970c)

The RLS receipt below was run against `11d970c1486a83dfae4e65a86915605437c5cad3`
after PR #169. Main later advanced to PR #171 at
`8cab6d61a4494246ee3f7615daa686d41a316bd3`; the RLS rehearsal remains to be
repeated on the final release SHA. Exact-main
[CI run 38137713092](https://github.com/dominator509/axiom/actions/runs/38137713092)
completed 12/12 jobs successfully (0 failed, 0 cancelled). The release-register
check `rtk node scripts/check-release-evidence.mjs --check` reports 54 criteria,
28 accepted, 23 unverified, 3 blocked, and 26 open; this is a structural check,
not release approval.

- `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` passed 20
  assertions, 0 failed, 0 skipped, with cleanup verified in
  [ci (test)](https://github.com/dominator509/axiom/actions/runs/38137713092/job/114464900061).
  Raw job-log SHA-256:
  `ce9e279ea5fcadae5282f6cb446d49d41c5fd038a9242148ab4f5f73b1df26ab`.
  This checkpoint covers only the owned, network-disabled disposable database;
  deployed/shared database state and the final-release-SHA replay remain open.

## Earlier exact-main acceptance refresh (2026-10-11; SHA 47637d8)

All receipts below target application SHA
`47637d8a5e82cb9f7bd7ccd55f9c2c33ad4870db` and are from hosted
[CI run 38125889370](https://github.com/dominator509/axiom/actions/runs/38125889370),
which completed 12/12 jobs successfully (0 failed, 0 cancelled). The register
check command was `rtk node scripts/check-release-evidence.mjs --check`; it
reported 54 criteria, 28 accepted, 23 unverified, 3 blocked, and 26 open. This
checks register structure only, not release approval.

- `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` passed 20
  assertions, 0 failed, 0 skipped, with cleanup verified in
  [ci (test)](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053792).
  Raw job-log SHA-256:
  `998290f8acaebacb68db07a45fd356bbad602f6f77e6f7bccc83e479e71f14b8`.
- `node scripts/rehearse-l5-runtime.mjs --isolated-fixture` passed 118
  assertions, 0 failed, 0 skipped, with cleanup verified in
  [l5-runtime](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053611).
  Raw job-log SHA-256:
  `1b1ae00510809c85bc3073e0f824216955bf5f7cd7fcf75e76dafc85c61bac74`.
- `node scripts/rehearse-egress.mjs --isolated-fixture` passed 96 checks,
  including 17 required assertions, 0 failed, 0 skipped, with cleanup verified
  in [egress-rehearsal](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053634).
  Raw job-log SHA-256:
  `3553f2c7d8b9d6ad094a1cadabc3f4d7598d38e1fd1bad354a64d5a4bf47def2`.
- `node scripts/rehearse-glitchtip-observability.mjs --isolated-fixture`
  passed 15 assertions, 0 failed, 0 skipped; two run-owned containers and one
  network were removed and verified in
  [observability](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053610).
  Raw job-log SHA-256:
  `fcad89d116f2523d301110c071eb5eddad23e4dec4103a26305d68f54710c60f`.
- `node scripts/rehearse-pitr-recovery.mjs --isolated-fixture --tested-sha 47637d8a5e82cb9f7bd7ccd55f9c2c33ad4870db`
  passed 47 assertions, 0 failed, 0 skipped, including 10 expected negative
  control rejections, with cleanup verified in
  [recovery-dr](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053419).
  Raw job-log SHA-256:
  `a14872b7184d41111f7f41357493bb94ef3d310202fc303d789a4252936dc56c`.
  This remains database-only partial evidence: no Cloudflare R2 retention,
  external KMS/KEK, restored application/worker stack, or provider reconciliation
  was exercised, so `NONFUNCTIONAL-6` remains unverified.
- `node scripts/rehearse-browser.mjs --isolated-fixture` passed 39 checks in
  both default and configured-brand modes (0 failed, 0 skipped each). The
  invalid-brand control had 4 passes and 1 expected failure; the unassigned
  identity control had 7 passes and 1 expected failure; both controls passed
  their intended rejection. The hosted browser job is
  [browser](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053640);
  raw job-log SHA-256:
  `a90197dbd0422ac46e111090b9ea6796628b16269d2e17a4e3e4bd4b472bdec0`.
  This covers Chromium desktop and narrow-screen browser behavior, not native
  iOS/Android acceptance.
- The exact seven `docker build` commands ran in the
  [ci (container) job](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053754):
  `docker build --label "org.opencontainers.image.revision=$GITHUB_SHA" --file infra/Dockerfile.hono --tag axiom-hono:ci .`,
  `docker build --build-arg API_ORIGIN=http://127.0.0.1:3001 --file infra/Dockerfile.next --tag axiom-dashboard:ci .`,
  `docker build --file infra/Dockerfile.worker --tag axiom-worker:ci .`,
  `docker build --file infra/Dockerfile.rust --tag axiom-egress-plane:ci .`,
  `docker build --file infra/Dockerfile.media --tag axiom-media-plane:ci .`,
  `docker build --file infra/Dockerfile.vision --tag axiom-vision-engine:ci .`, and
  `docker build --file infra/Dockerfile.scraper --tag axiom-scraper:ci .`.
  The job passed 11/11 rollback checks (0 failed, 0 skipped); the global
  suspension check completed in 885 ms. Raw job-log SHA-256:
  `85392a7308f6ef3b204b3f4c52bf3ece90dbde27366c4f9d9028cd9160c72663`.
  Immutable image IDs:

  | Image | ID |
  | --- | --- |
  | `axiom-hono:ci` | `sha256:f222f051e6c498fb11efe9c477241340cd4017afde48067f5339222fad51c58d` |
  | `axiom-dashboard:ci` | `sha256:2b968dbf09285d1ad3974bac48c2dcf35c290536606e5a9d5444361e006a50c2` |
  | `axiom-worker:ci` | `sha256:422cdcef24d1e0c9752127b57499574e730e9a3238b5a62fcd5bd01cc169b860` |
  | `axiom-egress-plane:ci` | `sha256:d6f1c1d19df72d80c4b4fcef94fbbec54f0cd0469a51e1f0436e64b4a34d0ea7` |
  | `axiom-media-plane:ci` | `sha256:e9f36537be310e9acfc64d51fd794c3bc1a09d620d2bc63fe2fb939f596ebcf5` |
  | `axiom-vision-engine:ci` | `sha256:503814218af8edc7f235c855797a0e11c0e5c362bdfeb3384031361f28addecd` |
  | `axiom-scraper:ci` | `sha256:7dc2e97ae0c54e0bd9db189918e267077c6f6066a429f22f8bd180847ecb4bd8` |

  The smoke checks
  do not establish a Hetzner/Coolify deployment or Cloudflare R2 behavior, and
  the CI vision image omits the external model artifact; no model-backed vision
  inference is claimed.
- `node scripts/test-security-gate.mjs` passed 6 negative-control cases,
  0 failed, 0 skipped; `pnpm audit:dependencies` passed 39 tests, 0 failed,
  0 skipped, and reported 0 unmitigated high/critical findings, 1 locally
  patched advisory, and 1 narrow upstream node-forge limitation. The
  [ci (security) job](https://github.com/dominator509/axiom/actions/runs/38125889370/job/114430053620)
  completed successfully; raw job-log SHA-256:
  `5c6484f0e60744642308ae812878b17300d695b8c436afb22ba47284b5cdcad4`.
  This proves repository scans and test fixtures, not an external production
  KMS/secret-store configuration; `SECURITY-8` remains unverified.

## Isolated Lane 5 evidence (2026-10-10)

The prior exact-main CI run 38084582816 on SHA 3401c1e6a7522b219a634f365b582e37d2548207 supplied hosted receipts for three criteria. SECURITY-3 passed 17/17 required egress assertions (0 failed, 0 skipped), with 85 Rust tests passing. NONFUNCTIONAL-3 passed the same egress rehearsal and the LBI-11 global suspension assertion at 1,673 ms against the five-second limit; the isolated deployment also passed 8/8 service health checks and 11/11 rollback checks. FUNCTIONAL-6 passed 11/11 crash-report/dashboard assertions and 15/15 GlitchTip correlation, log, trace, privacy-marker, and cleanup assertions. Each receipt includes its exact job URL, raw-log SHA-256, counts, and immutable fixture image identities in the register. All data and services were synthetic and isolated.

FUNCTIONAL-1 remains unverified. The exact-main Docker job now proves all seven
image builds, health and authentication boundaries, persistence/restart/rollback,
and the smoke checks listed above. It does not prove the requirement's
Hetzner/Coolify single-box deployment with Cloudflare R2. The remaining
deployment acceptance is an isolated target-shaped deployment with an R2
round-trip and the documented deployment boundaries; do not treat the current
CI smoke as that evidence. External-provider delivery, provider-cache and load
measurements, cost, full R2/KMS/application recovery, native-mobile consent
journeys, and owner sign-off remain open.

## Isolated Lane 7 physical PITR evidence (2026-10-10)

On application baseline `6b8b7090d0b779236beb5dbc40fefc9840a34f67`, the hosted [recovery-dr job](https://github.com/dominator509/axiom/actions/runs/38088704403/job/114320517964) ran `node scripts/rehearse-pitr-recovery.mjs --isolated-fixture --tested-sha 6b8b7090d0b779236beb5dbc40fefc9840a34f67`. It completed 47/47 assertions (0 failed, 0 skipped), including 10 expected negative-control rejections, and verified cleanup. Across two fresh PostgreSQL 16 Docker clusters with `network=none`, WAL-derived RPO measured 320 ms and 317 ms; database-only restore time measured 3,434 ms and 3,317 ms. Each restore retained 83 migrations and 90 public tables. The immutable database image was `timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a` (local image ID `sha256:58bfef76daf17da7924d59cfe5abbb36d0044fe5cea0888d404ad9ee3f8bf71d`); raw job-log SHA-256: `221b8247958ef7dd443a8825cf7b0d81ce9b13986e134d15f41ac5b6802a92c7`.

This is partial evidence, not closure of `NONFUNCTIONAL-6`: the drill did not use Cloudflare R2 retention, external KMS/KEK, a restored application/worker stack, or provider reconciliation before dispatch. Its RTO measurement covers database PITR only, not a full deployment recovery. The criterion remains unverified.

## Current external blockers

- **Publishing platforms and Relay (A2/A3/A6; FUNCTIONAL-2/4/5/11):** acceptance
  needs dedicated non-production provider accounts, permitted destinations,
  validated permissions and remote readback for each approved capability.
  Telegram, iMessage, Signal and Discord delivery must use test channels and
  supported hardware. Patreon remains a read-only community contract. Synthetic
  endpoints do not count as provider acceptance; use existing credits and free
  quotas only, and leave a provider open if access or quota is unavailable.
- **Beacon CRM records API (A7 and FUNCTIONAL-12):** the current
  [Beacon API guide](https://guide.beaconcrm.org/en/articles/5720215-beacon-s-api)
  says API access requires a Standard, Premium, or Ultimate plan; only active
  account admins create or revoke keys; and detailed developer docs are
  generated from the account database and require login. It documents
  `GET /v1/account/{account_id}/entity_types`, 300 requests/minute (60 for bulk),
  and confirms API actions can trigger workflows. The blocker is the eligible
  test account's login-protected auth/record contract and approved field map.
  Keep record writes disabled until workflow effects are reviewed; never infer
  an auth header or mappings from the public overview.
- **Beacons.ai creator link management (FUNCTIONAL-3):** the current source
  keeps this adapter unavailable. Creator help describes adding links through
  the page editor ([Links Block help](https://help.beacons.ai/en/articles/4696577)).
  The separate [Brands API page](https://help.beacons.ai/en/articles/11826369)
  describes a bearer key but its endpoints section still says “Section to come”
  (checked 2026-10-13). These public docs do not establish creator-account link
  CRUD, analytics, primary selection or revocation; that is an evidence-based
  limitation, not proof that no private API exists. Unblock with official
  creator API documentation and a dedicated test account. Linktree remains
  excluded by the owner's decision; Beacon CRM is a separate records connector.
- **Owned deployment, Cloudflare R2 and key recovery (FUNCTIONAL-1,
  NONFUNCTIONAL-6, SECURITY-8):** isolated Docker deployment/fault tests are
  authorized and should reuse the existing image, egress, kill-switch and
  observability receipts. The remaining integrated run needs an isolated R2
  bucket with the required retention behavior and a supported secure KEK
  delivery/recovery path. The current egress runtime uses the protected
  `EGRESS_KEK_FILE` mount and `EGRESS_KEK_ID`; cloud KMS integration is not
  implemented (see `infra/egress-runtime/README.md`). Do not request credentials
  for an unimplemented KMS integration. Configure credentials directly in the
  isolated test environment; never put values in a PR, agent prompt, hosted CI,
  or logs. Do not touch the owner's live host or shared database.
- **Provider-backed performance, cost and availability (LBI-09,
  NONFUNCTIONAL-1/5, MATRIX-NFR-2/5):** model-scale resource and latency
  measurements can use synthetic workloads, but the >97% cache gate needs
  provider-reported token counters, and provider availability must be reported
  separately from the synthetic core-path sample. Cost must be measured against
  the approved budget with existing free quotas only. No fixed 30-day window is
  required; record the actual sample window and denominator.
- **Native journeys and owner decisions (FEATURE-PRESERVATION,
  FUNCTIONAL-8/9/10, HUMAN-SIGNOFF):** remaining acceptance requires
  synthetic consent journeys on supported native iOS/Android devices, the F-90
  affiliate license/security and commission decisions, owner consent-record
  attestation, and release-specific owner sign-off. Use test transactions only;
  no live payouts. Browser CI does not stand in for native-device or owner
  evidence. LBI-12 and SECURITY-7 are accepted in the register for their recorded
  synthetic browser scope; their final-SHA replay and owner evidence remain
  separate obligations.

## Lane 4 API test baseline (2026-10-10)

The prior claim of two pre-existing API test failures is **not reproduced on
current main and remains unverified**: no commit-bound CI receipt with the two
failing test names/output was found. PR #53 head SHA
`7f42ea36dd19e2c071721272320e9a11ce4cf9e7` had [CI run
36973015092](https://github.com/dominator509/axiom/actions/runs/36973015092)
finish with 4 jobs passed, 1 failed, 2 cancelled, and 0 skipped; `ci(security)`
failed while `ci(test)` and `ci(container)` were cancelled. At that SHA, the
JavaScript/TypeScript step ran only `pnpm test`; its [partial test
log](https://github.com/dominator509/axiom/actions/runs/36973015092/job/110730805888)
contains package output but no failed-test summary or names for two API
failures, so it cannot establish the claim.

On exact current-main SHA `166cd7b9f701c1310678996b5ee78e4da33fb42c`, the
`ci (test)` job in [run 38081517709](https://github.com/dominator509/axiom/actions/runs/38081517709)
ran `pnpm --filter @axiom/api test` on Node 22.23.3 and pnpm 9.14.0:
**97 test files, 1,409 passed, 0 failed, 0 skipped**. The [test job
log](https://github.com/dominator509/axiom/actions/runs/38081517709/job/114299229857)
SHA-256 is `b10c369bd6de6c480ab289406cd6b88adbfe57f714efe0086dc55ac4a447299b`.
The local API command was not run because this workstation uses Node 24.14.1
while the repository requires Node 22.x. No API assertions were changed or
relaxed; the baseline claim is closed as not reproduced, not as a diagnosed
failure.

## Lane 2 RLS baseline before this evidence refresh

PR #140 is on main at exact SHA `f2f127d5e9e09b3ae377ec62121648c2248f425f`.
Post-merge [CI run 37957364668](https://github.com/dominator509/axiom/actions/runs/37957364668)
completed with 11/11 jobs passed, 0 failed, and 0 cancelled. Its `ci (test)`
job ran the isolated RLS rehearsal; the three related register rows now include
that exact-SHA receipt. A green CI run does not constitute release acceptance.

## Lane 2 RLS refresh on prior main (2026-10-10)

After PR #159, exact main SHA `af62fb691c4b15217b482049a19a2e2a1082ac1e` passed
12/12 jobs with 0 failures in [CI run 38094415434](https://github.com/dominator509/axiom/actions/runs/38094415434).
Its [`ci (test)` job](https://github.com/dominator509/axiom/actions/runs/38094415434/job/114337241974)
ran `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` on Node 22.23.3
against a network-disabled disposable PostgreSQL 16 fixture using
`timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a`.
All 20 assertions passed, with 0 failed, 0 skipped, and cleanup verified. They
checked every schema-derived tenant table against the effective forced-RLS
catalog and application role, nine rollback-only RLS/role fault controls and
catalog restoration, eight tenant/user locale-preference isolation cases, and
behavioral rollback. The official raw-job-log hash command,
`node scripts/check-release-evidence.mjs --receipt-log-sha 114337241974`, returned
`445743de574ffcf9b4432cbff8726adeb7d4a585482943f24ff6ea9f4068d2ab`.

The exact-SHA receipt is now recorded for LBI-01, NONFUNCTIONAL-2, and SECURITY-2.
This is isolated database evidence; it does not inspect a deployed/shared or
production database and does not prove exhaustive behavioral CRUD for every
tenant table. Repeat on the final release SHA after remaining lane changes.
At the af62fb6 checkpoint, register-wide exact-SHA verification failed closed at LBI-02: stale evidence SHA. That historical result did not claim every other passed row was verified; the newer 8f receipt below refreshes only the three RLS-related rows.

## Lane 2 RLS refresh on latest main (2026-10-10)

After PR #160, exact main SHA `8f106167168af13c70e2c1bc9b1ae9d2c37f2cd7` passed
12/12 jobs with 0 failed and 0 cancelled in [CI run 38097344317](https://github.com/dominator509/axiom/actions/runs/38097344317).
Its [ci (test) job](https://github.com/dominator509/axiom/actions/runs/38097344317/job/114345879074)
ran `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` on Node 22.23.3
against a network-disabled disposable PostgreSQL 16 fixture using the pinned
`timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a` image.
All 20 assertions passed, 0 failed, 0 skipped, with cleanup verified. The
rehearsal checked the effective forced-RLS catalog and application role for
schema-derived tenant tables, nine rollback-only fault controls, and eight
tenant/user locale-preference isolation cases. The raw log hash command,
`rtk node scripts/check-release-evidence.mjs --receipt-log-sha 114345879074`,
returned `443f0d5f0e8e8b13745572d830fcec96231151c9dc16262b273beb4c30b5a80c`.

The exact-SHA receipt is recorded for LBI-01, NONFUNCTIONAL-2, and SECURITY-2.
It proves only isolated database behavior; deployed/shared/production database
state and exhaustive behavioral CRUD for every tenant table remain unverified.
The command rtk node scripts/check-release-evidence.mjs --verify-receipts
8f106167168af13c70e2c1bc9b1ae9d2c37f2cd7 failed closed at LBI-02: stale
evidence SHA after validating the three refreshed RLS rows. Other accepted
rows still need final-release-SHA receipts. Repeat this rehearsal on the final
release SHA after the remaining lanes.

## Previous main baseline before PR #136 (2026-10-09)

PR #135 is on main at exact SHA `baabc6624efe9977d9bb3396bd7c43c4b8a5a7d8`.
Post-merge [CI run 37921289132](https://github.com/dominator509/axiom/actions/runs/37921289132)
completed with 11 successful jobs, 0 failed, and 0 cancelled. The run includes
the independent typecheck, lint, test, build, security, container, browser,
runtime, and recovery-drill jobs; all are CI evidence at this SHA, not proof of
external provider delivery or owner-deployed controls.

Local checks at this exact baseline were:

| Command | Result |
| --- | --- |
| `rtk node --test scripts/check-release-evidence.test.mjs` | 64 passed, 0 failed, 0 skipped |
| `rtk node scripts/check-release-evidence.mjs --check` | 54 criteria, 22 accepted, 32 open; valid, not release approval |
| `rtk sh scripts/verify.sh` | `verify: ok`; 11 gates passed, 0 failed, 1 skipped (12 total); `ufw` is Linux-production-host-only |
| `rtk node scripts/check-release-evidence.mjs --release baabc6624efe9977d9bb3396bd7c43c4b8a5a7d8` | Failed closed at `LBI-01: stale evidence SHA` |

The stale receipt must be refreshed with the full acceptance matrix at the final
release SHA. The exact-SHA failure does not invalidate the successful CI run or
the historical behavior receipts; it prevents claiming release acceptance now.

## Previous main receipt after PR #137 (2026-10-09)

PR #137 was on main at exact SHA `01470312532aa8360796c1ce7739f4b7d56bda8b`.
Post-merge [CI run 37931927993](https://github.com/dominator509/axiom/actions/runs/37931927993)
completed with 11 successful jobs, 0 failed, and 0 cancelled. This is historical
after PR #138 advanced main.

## Previous main receipt after PR #136 (2026-10-09)

PR #136 was on main at exact SHA `04cb46dc4383d2ccfb9fae98a4ef4fedb62a6079`.
Post-merge [CI run 37926757972](https://github.com/dominator509/axiom/actions/runs/37926757972)
completed with 11 successful jobs, 0 failed, and 0 cancelled. Its `ci(test)` job
ran `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` in an owned,
network-disabled disposable PostgreSQL environment using
`timescale/timescaledb:2.29.2-pg16@sha256:289d55704b1b3ee8263cd3805c6930f9cd54506835a8f19f9b85dad17d5c5a8a`:
20 assertions passed, 0 failed, 0 skipped, and cleanup was verified. The rehearsal
checked effective forced-RLS policies and application-role privileges across
schema-derived tenant tables, rollback-only policy/role fault controls, and
cross-tenant read/write rejection. The [test job](https://github.com/dominator509/axiom/actions/runs/37926757972/job/113807429785)
raw-log SHA-256 is
`4649288ac91fa55d7ad17f7113667f993bcde2b1cfd37aade11c413a05b114de`.

The evidence is limited to that isolated migrated database. It does not inspect
deployed/shared/production database state or exhaustively exercise CRUD on every
tenant table. The exact-main receipt is recorded for LBI-01, NONFUNCTIONAL-2,
and SECURITY-2; it does not by itself close their full release-level scope.

Local checks at this exact main SHA were:

| Command | Result |
| --- | --- |
| `rtk node --test scripts/check-release-evidence.test.mjs` | 64 passed, 0 failed, 0 skipped |
| `rtk node scripts/check-release-evidence.mjs --check` | 54 criteria, 22 accepted, 32 open; valid, not release approval |
| `rtk sh scripts/verify.sh` | `verify: ok`; 11 gates passed, 0 failed, 1 skipped (12 total); `ufw` is Linux-production-host-only |
| `rtk node scripts/check-release-evidence.mjs --release 04cb46dc4383d2ccfb9fae98a4ef4fedb62a6079` | Failed closed at `LBI-02: stale evidence SHA` |

The exact-SHA release check remains fail-closed until every required receipt is
refreshed at the final release SHA and every acceptance row is satisfied.

## Prior main receipt (2026-10-08)

PR #123 was on main at exact SHA `07b6723a963add92249e637151e53852d042b485`.
Post-merge [CI run 37845929231](https://github.com/dominator509/axiom/actions/runs/37845929231)
completed with 10 successful jobs, 0 failed, and 0 cancelled. The [test job](https://github.com/dominator509/axiom/actions/runs/37845929231/job/113546673845)
ran `pnpm --filter @axiom/worker exec vitest run
src/viral-retrieval.integration.test.ts`: 1 file, 11 passed, 0 failed, and
0 skipped. The job used the pinned PostgreSQL service; the fixture rolled its
synthetic data back and closed its pool. Its raw log SHA-256 is
`73d1e0722ae36b9bfb4a10a5c65a32d40c3facfc6d35cf622a157fbecab173ed`.

This closed A5 at that verified baseline for internal exemplar retrieval, S2
prompt assembly, and bandit updates. It does not prove live-provider metrics,
external dispatch/readback, or production outcomes. A5 must be repeated at the
final release SHA.

The historical exact-SHA check at `50123ffd7ddf4e93625d44e828c85521089d03cc`
also failed closed at `LBI-01: stale evidence SHA`; its register snapshot had
five accepted rows and 47 open. That dated count is retained as history and is
superseded by the current 54-row snapshot above.

## Historical main receipt (2026-10-07)

PR #98 merged as main SHA `50123ffd7ddf4e93625d44e828c85521089d03cc`. Post-merge [CI run 37614786241](https://github.com/dominator509/axiom/actions/runs/37614786241) completed with 10 successful jobs, 0 failed, and 0 cancelled.

The [test job](https://github.com/dominator509/axiom/actions/runs/37614786241/job/112770394516) used Node 22.23.3, pnpm 9.14.0, and `API_ORIGIN=http://127.0.0.1:3001`:

| Command | Passed | Failed | Skipped | Total |
| --- | ---: | ---: | ---: | ---: |
| `pnpm --filter @axiom/dashboard test` | 1121 | 0 | 0 | 1121 |
| `pnpm --filter @axiom/api test` | 1394 | 0 | 0 | 1394 |
| `pnpm test` (12 package reports) | 4636 | 0 | 7 | 4643 |

The dashboard/API commands reported 169/97 test files. The seven workspace skips were five in `@axiom/db` and two in `@axiom/llm-gateway`; this receipt does not classify them as accepted release cases. The raw test-job log SHA-256 is `3dd7cf465f8c44900df6fb01422afb50b35d5526a3b66b4cc522f7a64032519c`.

The [L5 runtime job](https://github.com/dominator509/axiom/actions/runs/37614786241/job/112770394477) ran `node scripts/rehearse-l5-runtime.mjs --isolated-fixture` on that SHA: two repetitions of 34 checks, 68 passed, 0 failed, 0 skipped, cleanup verified. The raw log SHA-256 is `8b05fae5854b83173994fc19d6fa711035af6c256475ddf2a908bb4eb44a2dba`. It verifies isolated worker, database, and model behavior only; provider, owner-deployment, and final-release acceptance remain open.

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

An earlier implementation baseline was `7c83cd3f7ec31c776d9f1723942003cf9484cb7a`.
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
The later candidate at SHA `d46c875b340afd4acda22f244a0db7356a745987` passed the
expanded publish-idempotency rehearsal twice: 50 passed, 0 failed, 0 skipped,
with cleanup verified. The [candidate CI run](https://github.com/dominator509/axiom/actions/runs/37563868575)
completed with all 10 jobs successful; its [L5 runtime job](https://github.com/dominator509/axiom/actions/runs/37563868575/job/112607045675)
ran `node scripts/rehearse-l5-runtime.mjs --isolated-fixture`. The raw job-log
SHA-256 is `ef649d9de924c3dd595d4202f72e43098fe768cac4603c508d02201230807c53`.
Concurrent approvals produced one loopback-fixture request, ledger replay made
no second request, and the injected persistence fault left an unknown marker
that blocked retry. This is internal idempotency evidence only; the Discord
transport used a local loopback service, so external delivery/readback remains
open. The final release SHA still requires the complete acceptance rerun.
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

1. Evidence register: all 54 rows have a test, environment, dependencies,
   evidence requirements and completion condition; the canonical invariant
   crosswalk is validated. At the pre-M23 main checkpoint SHA
   `7cfe25eafd779b52b607893b52e87e33ea072013`, the register is structurally
   valid with 28 accepted and 26 open (23 unverified, 3 blocked), and remains
   **not release approval**. Repeat all accepted rows at the final release SHA
   and complete exact-SHA hosted readback.
2. Effective RLS catalog: derive tenant tables from schema, inspect migrated flags,
   policies and runtime-role privileges, and run cross-tenant negative controls.
   The earlier exact-main receipt on SHA `8e83f183da91a49f07b29e67781038c57158cf6b`
   remains historical: [run 38341605406](https://github.com/dominator509/axiom/actions/runs/38341605406/job/115113611817)
   ran `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` with 20
   assertions passed, 0 failed, 0 skipped, and cleanup verified; its overall
   workflow had 11 jobs pass and 1 fail (`l5-runtime`). The prior exact-main
   receipt on SHA `06c46aeecc6b5572d18ecb4eeb7f174305a3cfd8` remains in the
   register. The latest exact-main receipt on SHA
   `7cfe25eafd779b52b607893b52e87e33ea072013` is recorded for LBI-01,
   NONFUNCTIONAL-2, and SECURITY-2: [run 40285921937, test job
   121449432107](https://github.com/dominator509/axiom/actions/runs/40285921937/job/121449432107)
   ran the same isolated rehearsal with 32 assertions passed, 0 failed, 0
   skipped, and cleanup verified; raw job-log SHA-256
   `4c742ce399ddeadaca0f5ba96198eccecf492636d725d8c7ccf985139abf4195`.
   This is current-source disposable-CI evidence, not deployed/shared database
   acceptance. Final-release-SHA replay and raw-log receipt verification remain
   required.
   Deployed/shared database state remains outside this lane.
3. L5 matrix: close the remaining real isolated runtime/browser journeys and
   negative controls, including pinned-model inference, uncertain dispatch,
   durable audit outcomes, secrets and consent enforcement.
4. Providers/Relay: use dedicated accounts or sandboxes and supported hardware
   for connection, permission validation, permitted dispatch, remote readback,
   reconciliation, revocation and cleanup. Missing external access remains open.
5. Deployment/egress: use one source-pinned owned Docker deployment for the
   integrated R2 write/read/delete and restart/rollback boundaries. Reuse the
   existing image, egress, kill-switch and observability receipts for component
   coverage; add only missing integrated checks. Owner-host deployment remains
   outside scope.
6. Performance/cost: measure the 1-20-model workload, specified latency budgets,
   >97% provider-reported token-cache hits, resource use, monthly cost and
   measured availability against the 99.5% target. Report the actual sample
   window and provider uptime separately; no minimum observation period is a
   release gate.
7. Recovery: complete two repeatable fresh-cluster PITR drills with object/key
   restoration, RPO <=5 minutes, RTO <=60 minutes, egress disabled, and negative
   controls.
8. Product/sign-off: verify the canonical v1 range F-01..F-88 and the separate
   owner extensions F-89 (localization), F-90 (platform affiliate/referral),
   F-91 (Patreon), and F-92 (Beacon CRM), as specified by L5.0 and L5.2.
   Complete six-locale, desktop and native-mobile journeys, synthetic
   consent-vault controls, owner records attestation and release-specific sign-off.
   A local Android operator rehearsal selected and persisted all six locales
   and measured zero safe-area label overlaps; details and screenshot hashes are
   recorded in [the partial native receipt](native-operator-locale-partial-2026-10-26.md).
   This mixed-source, operator-only result does not close F-89; FUNCTIONAL-9
   remains unverified pending complete parity, accessibility and final-source evidence.

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

Each workstream has at least one remaining unverified or blocked criterion;
accepted component receipts do not close an entire lane. A Docker deployment can
establish isolated runtime proof. It cannot establish real provider entitlement,
real channel delivery, customer consent, or the owner's deployed controls.
Missing external prerequisites remain blockers for their
rows; independent isolated work continues. No shared/production database
changes or migrations are permitted.

## Evidence format and gates

`release-evidence.json` contains 54 rows extracted from the normative sections of
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
