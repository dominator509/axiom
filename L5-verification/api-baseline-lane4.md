# Lane 4: API baseline verification

Baseline: `c563fada3464679be1337a058d05125c152356d7` (main after PR #57).

## Historical claim

The claim of "two pre-existing API test failures" is **unverified**. No original failing CI receipt identifying those tests was found in the cited PR #53/#54 evidence or the targeted repository search. This is a bounded search, not a claim that every historical run passed.

- PR #53 head `7f42ea36dd19e2c071721272320e9a11ce4cf9e7`: [run 36973015092](https://github.com/dominator509/axiom/actions/runs/36973015092) has 4 successful jobs, 1 failed security job, and 2 cancelled jobs (test/container). A cancelled test job is not proof of two API failures. PR #53's body instead reports 1,285 API tests passed and 50 skipped; it supplies no failing test names. The earlier PR commit `c47373ef27a476fa148a13e1de6ac87b96165730` returned no run in the commit-filtered query.
- PR #54 head `0e2944ff762ba8875186f1a8bdd3e0a9cb4261ca`: [test job 110733371537](https://github.com/dominator509/axiom/actions/runs/36973864383/job/110733371537) reports 95 files and 1,335 tests passed, 0 failed, 0 skipped. All 7 jobs succeeded. GitHub identifies this run's head as the PR commit, not its later merge commit `df99e741987ed70a6821b6ef30a3422f3501e55a`.

Retrieval commands:

```sh
gh pr view 53 --repo dominator509/axiom --json headRefOid,body,commits
gh pr view 54 --repo dominator509/axiom --json headRefOid,body,commits
gh run list --repo dominator509/axiom --commit c47373ef27a476fa148a13e1de6ac87b96165730 --json databaseId,headSha,status,conclusion,url
gh run view 36973015092 --repo dominator509/axiom --job 110730805888 --log
gh run view 36973864383 --repo dominator509/axiom --job 110733371537 --log
```

## Current local verification

All runs below used baseline `c563fada3464679be1337a058d05125c152356d7`, Node 22.23.3, pnpm 9.14.0 and `API_ORIGIN=http://127.0.0.1:3001`. No database URL was supplied. The existing 50 database-dependent tests therefore remained skipped. These local results do not replace CI's database-backed coverage.

| Exact command | Passed | Failed | Skipped | Exit |
| --- | ---: | --- | ---: | ---: |
| `pnpm --filter @axiom/api test` (existing clean readiness worktree) | 1,213 | 2 suite setup hooks | 122 | 1 |
| `pnpm --filter @axiom/api test src/index.test.ts` | 70 | 0 | 0 | 0 |
| `pnpm --filter @axiom/api test src/relay-webhooks.test.ts` | 2 | 0 | 0 | 0 |
| `pnpm --filter @axiom/api run test --maxWorkers=2` | 1,285 | 0 | 50 | 0 |
| `pnpm --filter @axiom/api test` (fresh detached checkout) | 1,285 | 0 | 50 | 0 |

The first run failed `beforeAll` in `src/index.test.ts:14` and `src/relay-webhooks.test.ts:5`: `Hook timed out in 30000ms.` Both hooks dynamically import the API entry point. No test assertion failed; 72 tests could not run because their suite setup failed, in addition to the 50 database skips. Vitest reported 88 passed files, 2 failed files, and 5 skipped files. This is a newly observed local timeout, not evidence connecting it to the historical claim.

Both exact suites passed independently. The bounded-worker full run passed in 80.98 seconds. A separate detached checkout at the same SHA, `C:/tmp/axiom-lane4-clean-c563fada`, passed the unmodified full command in 40.40 seconds. It was prepared with `pnpm install --frozen-lockfile` (exit 0) and `pnpm exec turbo run build --filter=@axiom/api...` (10/10 tasks, 0 failed). Its tracked tree remained clean. Parallel import overhead is a plausible contributor; the evidence does not establish a definitive root cause. No timeout, assertion, test, skip condition, dependency or product code was changed.

One diagnostic command, `pnpm --filter @axiom/api test --maxWorkers=2`, was rejected by pnpm as an unknown option before Vitest ran (exit 1, zero tests executed). The corrected `run test` command above passed.

Untruncated local outputs are retained under `C:/tmp/codex-security-artifacts-f74695882c577be7e7bfa33ba5e0a849f014503aac1e190f06185874e9243065/artifacts/`: `lane4-api-main.log`, `lane4-index-isolation.log`, `lane4-relay-isolation.log`, `lane4-api-bounded-run.log`, `lane4-clean-install.log`, `lane4-clean-build.log`, and `lane4-clean-api-default.log`. Historical job logs are `lane4-pr53-test-log.log` and `lane4-pr54-test-log.log` in that directory.

## Current hosted baseline

[Main CI run 37029715659](https://github.com/dominator509/axiom/actions/runs/37029715659) at `c563fada3464679be1337a058d05125c152356d7` completed with **7 passed, 0 failed, 0 cancelled**. Its [test job 110913198661](https://github.com/dominator509/axiom/actions/runs/37029715659/job/110913198661) reports `pnpm --filter @axiom/api test`: **1,335 passed, 0 failed, 0 skipped**, also repeated within the full workspace run. Unlike the local no-database runs above, this exercises the database-dependent API tests. Full log retrieval: `gh run view 37029715659 --repo dominator509/axiom --job 110913198661 --log` (exit 0); saved as `lane4-main-ci-test-log.log` beside the other local receipts.

## Decision

Historical claim: **prior claim unverified**. Current clean-checkout assertion failure: **not reproduced**. Observed local suite-hook timeouts: recorded above, with isolation and same-commit comparison, cause unresolved. No speculative production fix or assertion relaxation is justified. The database-backed main CI receipt and this documentation PR's CI must remain green; no broader production-readiness claim follows from this API baseline.

## Reverification on current main

Baseline: `c9078b5d17ea8ad3265065b140f6815efb58da26` (PR #72 merge). The source checkout was clean. Local runs used Node `22.23.3`, pnpm `9.14.0` through Corepack, and `API_ORIGIN=http://127.0.0.1:3001`; no database URL was supplied.

| Exact command | Passed | Failed | Skipped | Exit |
| --- | ---: | --- | ---: | ---: |
| `corepack pnpm --filter @axiom/api test` (first full local run) | 1,251 | 2 suite setup hooks | 124 | 1 |
| `corepack pnpm --filter @axiom/api exec vitest run src/index.test.ts --reporter=verbose` | 72 | 0 | 0 | 0 |
| `corepack pnpm --filter @axiom/api exec vitest run src/relay-webhooks.test.ts --reporter=verbose` | 2 | 0 | 0 | 0 |
| `corepack pnpm --filter @axiom/api test` (repeat full local run) | 1,325 | 0 | 50 | 0 |
| Hosted `pnpm --filter @axiom/api test` | 1,375 | 0 | 0 | 0 |

The first local run reported 90 passed files, 2 failed files and 5 skipped files (97 total). Its only failures were 30-second `beforeAll` import-hook timeouts in `src/index.test.ts:14` and `src/relay-webhooks.test.ts:5`; no test assertion failed. Both exact files passed in isolation, and the repeated full run passed. The 50 local skips are database-dependent tests because no database URL was configured. Parallel import contention remains a plausible contributor, not a proven root cause.

The [post-merge CI run](https://github.com/dominator509/axiom/actions/runs/37244223902) is green at the exact baseline SHA: **9 jobs passed, 0 failed, 0 cancelled**. Its [test job](https://github.com/dominator509/axiom/actions/runs/37244223902/job/111558796412) ran the direct API command on the pinned CI runtime with its disposable database and reports 97 passed files and 1,375 passed tests, with 0 failures and 0 skips. This also passes the two suites that timed out in the first local run.

The historical two-failure claim remains **unverified**. PR #53's [run 36973015092](https://github.com/dominator509/axiom/actions/runs/36973015092) has a failed security job and a cancelled API test job; it provides no failing API test output. The first local timeout pair on `c9078b5` is a separate observation and does not identify the historical claim's source. No tests, timeouts, skips, dependencies, assertions or product code were changed.

## Reverification on current main

Baseline: `5973486c5ff3165b2d23c72f7eda8e76eb9f2144` (PR #87 merge), verified against `origin/main` on 2026-10-06.

The [post-merge CI run](https://github.com/dominator509/axiom/actions/runs/37540536565) completed with **10 jobs passed, 0 failed, 0 cancelled**. Its [test job](https://github.com/dominator509/axiom/actions/runs/37540536565/job/112532176071) ran the API suite against the disposable CI database on Node 22.23.3 / pnpm 9.14.0:

| Exact command | Passed files/tests | Failed | Skipped | Exit |
| --- | ---: | ---: | ---: | ---: |
| `pnpm --filter @axiom/api test` | 97 files / 1,391 tests | 0 | 0 | 0 |

The same job ran `pnpm test`: 4,631 passed, 0 failed, 7 environment-gated tests skipped (5 database-readiness and 2 LLM-environment cases). The raw GitHub job-log response for job `112532176071` was 725,385 bytes, SHA-256 `2b1c3532b0cf6b99d2d4cb8d67ebe10c8f1dcebb3569d7f8de67e5a4e042b49d`.

No API test failed at this current-main SHA, so there was no failing test to isolate or compare. The earlier “two pre-existing API test failures” claim remains **prior claim unverified / not reproduced**; the PR #53 cancelled test job still supplies no failure names or output. No test, skip condition, assertion, dependency, timeout or product code was changed.
