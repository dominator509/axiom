# M1001 — owner-authorized feature gate closure

Date: 2026-09-23
Scope: F06-F07, F09-F18, F24-F30, F32-F37, F39-F41, F44-F48, F52,
F54-F57, F68-F78, F80-F83 and F91.

Checkout: `codex/feature-gate-closure-2026-09-23`, based on
`dd8b7f526771bd50f0e14fa8d720e3f61ae01152`. The matrix ran on the working tree
before source commits M1002 (`97f05ed891225e7a5b1844dc80291bc9710f7a4c`) and
M1003 (`3934c843de62a6d1120922ae6af5ffed70d24b44`); the requested feature
package contents in those commits match the tested implementation. Uncommitted
egress and Hermes artifacts were outside this gate scope and remained in the
working tree during verification, so this is working-tree evidence rather than
a clean-checkout rerun.

## Decision and boundary

The owner explicitly waived live deployment evidence for this requested gate
set. The listed feature gates are closed at the source, contract, and isolated
local integration level below. This is not a production-readiness certification
and does not claim a live provider receipt. No external OAuth, provider API,
Relay-channel send, publish, deployment, or live database migration was
performed. Database migrations ran only in the disposable test fixture.

## Verification

| Command | Result |
| --- | --- |
| `rtk node scripts/test-isolated-workspace.mjs --isolated-fixture` | Exit 0; 24/24 workspace build/test tasks passed; 72 migrations applied to disposable fixture `axiom_workspace_test_3b7188db3eedb251`, which was removed; `recovered_database_untouched: true`. |
| `rtk pnpm typecheck` | Exit 0; `TypeScript: No errors found`. |
| `rtk cargo test --workspace` | Exit 0; 114 passed, 1 ignored (14 suites). |
| `rtk git diff --check` | Exit 0. |
| `rtk pnpm --filter @axiom/llm-gateway test -- src/prompts.test.ts` | Exit 0; 48/48. |
| `rtk pnpm --filter @axiom/dashboard test -- components/PlatformAffiliateManager.test.tsx` | Exit 0; 6/6. |
| `rtk sh scripts/verify.sh` | Exit 0; printed `verify: ok`; preflight and P0-P4 marker gates passed. |

Isolated workspace package results:

| Package | Test files | Passed | Skipped |
| --- | ---: | ---: | ---: |
| API | 91 | 1,260 | 0 |
| Auth | 2 | 28 | 0 |
| Connectors | 27 | 469 | 0 |
| Core | 27 | 143 | 0 |
| Dashboard | 159 | 1,031 | 0 |
| DB | 6 passed, 1 skipped | 171 | 5 |
| Fanvue MCP | 7 | 81 | 0 |
| LLM gateway | 25 | 407 | 0 |
| MCP server | 8 | 91 | 0 |
| Mobile | 4 | 28 | 0 |
| Relay | 15 | 274 | 0 |
| Worker | 38 | 342 | 0 |
| **Total** | **409 passed, 1 skipped** | **4,325** | **5** |

The DB readiness integration file is intentionally skipped by the standard
matrix; the 13-test `live.integration.test.ts` and feature-specific PostgreSQL
integration suites ran against the isolated fixture. The API build generated
OpenAPI with 189 paths. The mobile build completed TypeScript checking and web
export. The Next.js dashboard production build completed type checking and
static-page generation; it emitted existing test-file lint warnings.

## Feature evidence map

- **F06-F07:** Fanvue analytics/earnings and connector contracts, normalized
  contact/timeline API coverage, worker analytics sync, and dashboard fan
  surfaces.
- **F09-F11:** pre/post execution, scheduled-post/calendar controls, cascade
  expansion/API behavior, and dashboard calendar/cascade tests.
- **F13-F16:** variant experiment API and durable PostgreSQL performance
  evidence, worker winner evaluation, dashboard assignment/tracking/review,
  and model-scoped watermark policy API/dashboard/worker coverage (F14).
- **F17-F18:** authenticated scrape API, worker orchestration, quality and
  partial-result contracts, competitor research/benchmark UI and result tests.
- **F24-F26:** 40 PostgreSQL team-operation integration tests plus API,
  dashboard, shift, assignment, revocation, handoff, and post-note coverage.
- **F27-F28:** monthly PDF/report API tests, digest worker/schedule tests,
  persisted Relay cards and Relay package coverage.
- **F29-F30:** bounded media transforms/adaptation API and dashboard controls,
  media sanitization, real PostgreSQL media-operation lifecycle tests.
- **F32-F37:** ToS engine and worker enforcement, generation/photoshoot
  contracts, TOKENKILLER, provider cache controls, approval and video-review
  routes and surfaces.
- **F39-F41:** Venice and local vLLM provider contract tests, gateway dispatch,
  persona/roleplay context and dashboard behavior tests.
- **F44-F47:** generated REST/OpenAPI contract (189 paths), 91 MCP server tests,
  capability/role enforcement and dynamic manifest coverage.
- **F48/F52:** native link-in-bio API, schema, editor, click analytics and
  dashboard tests; external adapters remain outside these native gates.
- **F54-F57:** revisioned playbook APIs and PostgreSQL history, cadence
  validation, generation prompt enrichment and adherence-score tests.
- **F68-F72:** Relay card, approval, signed command/replay, adapter binding and
  editor deep-link behavior across API, Relay, dashboard and mobile packages.
- **F73-F78:** crash reports, structured correlation logging, metrics, health,
  incident/DLQ replay, crash-loop logic, API/worker/Relay tests and dashboard
  resolution controls.
- **F80-F83:** published-evidence labeling, recipe capture, PostgreSQL vector
  retrieval, generation exemplar injection, bandit and Relay insight tests.
- **F91:** Patreon read/sync/event-only connector fixtures, model-scoped OAuth
  boundary and route tests, cursor/replay/signature contracts, dashboard and
  mobile connection/sync/manual-assist tests. The contract remains explicitly
  capability-honest: no publish, DM, payout, member mutation, or unsupported
  analytics is claimed.

Two stale assertions/fixtures found by the complete matrix were corrected:
the Instagram playbook test now expects the current blocked-keyword policy,
and the affiliate manager snapshot fixture includes the required
`billingWebhook` contract. Focused suites passed after each correction and the
entire isolated matrix then passed.

## Owner acceptance

This record closes only the requested feature IDs against source and local
acceptance evidence under the owner's explicit live-deployment-evidence waiver.
It does not check off unrelated L5.2 release/security criteria, certify
production secrets or live integrations, or change any deployment/provider
state. The API build warned that its current local `BETTER_AUTH_SECRET` is
weak; its value was not printed or recorded, and production secret quality was
not verified.
