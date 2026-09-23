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

## M1007 — user-facing UI wiring follow-up

The current UI re-audit found and closed three concrete user-facing gaps within
the requested gate set:

- F77: the incidents page now exposes confirmed, audited discard for safe
  failed/dead jobs. The API scopes by organization, limits the state transition,
  requires owner/manager/operator mutation access, and blocks discard when an
  external provider outcome is unknown. The control reuses one idempotency key
  after an uncertain response and refreshes the listing after confirmation.
- F39-F41: the self-service provider page now renders the gateway's actual
  capability matrix, including local vLLM and providers disabled by policy.
  Labels distinguish policy support from an active connection or healthy
  endpoint; this adds no provider API-key fields or provider calls.
- F73-F76: the footer and primary navigation now open a health overview with
  API liveness, PostgreSQL readiness, incident recovery, Prometheus metrics,
  and owner-only per-profile egress checks using the existing tenant-scoped
  network health endpoint. A failed status request is shown as unavailable;
  the page does not imply that unprobed workers or external providers are
  healthy.

The all-route navigation contract now includes `/health`. The existing
model-scoped watermark and provider-cache controls, Fan CRM, schedule, cascade,
experiment, scrape, team, report, media, generation, agent/MCP, link-in-bio,
playbook, Relay, and Patreon UI suites also passed in the full dashboard run.
This is source/UI and local behavior evidence; it is not browser/device
acceptance or live deployment evidence. The owner's explicit live-deployment
evidence waiver above remains in force.

| Command | Result |
| --- | --- |
| `rtk pnpm --filter @axiom/dashboard test -- --run` | Exit 0; 161 files, 1,042 tests passed, including all-route navigation, health/provider status, incident replay/discard and the requested feature component suites. |
| `rtk pnpm --filter @axiom/core test -- --run` | Exit 0; 27 files, 143 tests passed, including six-locale catalog completeness. |
| `rtk pnpm --filter @axiom/dashboard test -- components/Navigation.test.tsx app/health/page.test.tsx app/connections/grok/page.test.tsx` | Exit 0; 3 files, 52 tests passed after adding the operational-role navigation matrix. |
| `rtk pnpm --filter @axiom/core build` | Exit 0. |
| `API_ORIGIN=http://127.0.0.1:3001 rtk pnpm --filter @axiom/dashboard build` | Exit 0; optimized production build compiled and generated dynamic `/health` and connection routes. The loopback origin was build configuration only; no live service was contacted. |
| `rtk pnpm --filter @axiom/dashboard typecheck` | Exit 0. |

## Owner acceptance

This record closes only the requested feature IDs against source and local
acceptance evidence under the owner's explicit live-deployment-evidence waiver.
It does not check off unrelated L5.2 release/security criteria, certify
production secrets or live integrations, or change any deployment/provider
state. The API build warned that its current local `BETTER_AUTH_SECRET` is
weak; its value was not printed or recorded, and production secret quality was
not verified.

## M1009 — OpenClaw MCP onboarding (F-38) — 2026-09-23

Implemented the OpenClaw remote MCP setup flow and completed the MCP
Streamable HTTP interoperability path. The server negotiates supported MCP
protocol versions, handles standard initialization, ping, notifications,
tools/list, and tools/call messages, and returns standard JSON Schema inputs
and tool result content blocks. The API enforces the modern protocol headers
and version while keeping notification requests header-free as required.

The Agent Access screen now produces a copyable OpenClaw server configuration
using the current site origin and an environment-variable reference for the
short-lived bearer token. It includes the remote doctor probe command and
explains token renewal and revocation. The token itself is not embedded in the
generated configuration or persisted by the UI.

| Verification | Result |
| --- | --- |
| `rtk node scripts/test-isolated-workspace.mjs --isolated-fixture` | Passed, 24/24 workspace tasks; disposable fixture applied 73 migrations and was removed; recovered database remained untouched. |
| MCP server package tests | 87 passed; 6 database-backed tests skipped when no test database was configured. |
| API `src/index.test.ts` | 67 passed. |
| Dashboard `AgentPermissionManager.test.tsx` | 10 passed. |
| Core `locale.test.ts` | 30 passed. |
| API typecheck and focused dashboard lint | Passed. |

This verifies local implementation and the disposable Docker workspace matrix.
No live OpenClaw client, external provider, or deployed service was used.

## M1010 — Consent-scoped viral pattern sharing (F-86) — 2026-09-23

Added a per-model opt-in for organization-wide pattern learning. Sharing is off
by default and can be changed only by an owner or manager. The aggregate query
uses published, verified evidence from other opted-in models in the same
organization, requires at least five examples across at least two other models,
and returns abstract platform/format/arm/timing/sample/score fields. It does
not select source model IDs, post IDs, captions, or assets. The analytics page
labels model-only versus organization-shared patterns and explains the scope
and schedule in all six supported locales.

| Verification | Result |
| --- | --- |
| `rtk proxy node scripts/test-isolated-workspace.mjs --isolated-fixture` | Passed, 24/24 workspace tasks. Disposable fixture applied 74 migrations, was removed, and left the recovered database untouched. |
| API suite | 92 files, 1,289 tests passed; viral evidence PostgreSQL integration passed. |
| Dashboard suite | 1,056 tests passed. |
| Core suite | 144 tests passed. |
| DB suite | 172 passed; 5 readiness integration tests skipped. |
| MCP / connectors / LLM gateway / mobile | 93 / 469 / 408 / 32 tests passed. |
| Focused viral API, schema, locale, dashboard, and component suites | Passed, including permission, default-off, opt-in, projection privacy, and localized copy coverage. |
| `git diff --check` | Passed; Git reported only configured LF-to-CRLF warnings. |

Migration 0060 was exercised only inside the disposable Docker fixture; no
production database was migrated. No external provider or deployed service
was used.

## M1011 — Competitor benchmark observation history (F-18) — 2026-09-23

The competitor benchmark already computed growth and posting frequency from
repeat public-profile scrapes, but the UI exposed only the latest counts and
delta. It now returns the last 24 time-ordered observations for each bounded
competitor profile and lets the user expand a localized history table with
observation time, follower count and post count. Missing values remain
unavailable; no counts are inferred. The endpoint remains organization/model
scoped and the history contains only the same bounded public fields already
shown by the scrape result projection.

| Verification | Result |
| --- | --- |
| API scraper contract and route suites | 39/39 passed. |
| Dashboard `ScrapeRunManager` suite | 3/3 passed. |
| Core locale and new history catalog suites | 31/31 passed across six launch locales. |
| API typecheck | Passed. |
| Dashboard typecheck | Existing unrelated error in `PlatformAffiliateManager.test.tsx:138` (`Type '{}' has no call signatures`); the focused changed component test passes. |
| `git diff --check` | Passed; Git emitted only configured LF-to-CRLF warnings. |

Browser acceptance, sidecar/provider quality and runtime/migration acceptance
remain separate from this source-level history surface.

## M1012 — Published-post attribution links (F-23) — 2026-09-23

Added an authenticated model-scoped link manager that lists only currently
published post targets and first-party tracked links still bound to those
targets. Owners, managers and operators can create an audited link only for a
published target belonging to the selected model and an enabled Native
provider. Destinations must be public HTTPS URLs. The generated short link
stores `utm_source=axiom`, `utm_medium=post`, platform campaign and the exact
published `post_target` ID; its public `/linkbio/:modelId/s/:slug` redirect
increments the owned short-link click and records click/analytics facts before
appending the saved UTMs. The attribution report exposes the validated post ID
alongside existing Fanvue conversion, revenue and cost-derived ROI data. The
dashboard lets operators select a published post, create the link and copy
the public URL. No schema migration was needed.

| Verification | Result |
| --- | --- |
| `rtk proxy node scripts/test-isolated-workspace.mjs --isolated-fixture` | Passed, 24/24 workspace tasks. Disposable fixture applied 74 migrations, was removed, and left the recovered database untouched. |
| API package | 92 files, 1,295 tests passed; new published-post listing/create and public redirect coverage included. |
| Dashboard package | 163 files, 1,060 tests passed; new manager and link-in-bio page coverage included. |
| Core locale catalog | 30 files, 146 tests passed across six launch locales. |
| Database / connectors / worker / mobile / MCP server / Fanvue MCP / LLM gateway / Relay / auth | 172 DB tests passed (5 readiness tests skipped); connectors 469, worker 342, mobile 32, MCP server 93, Fanvue MCP 93, LLM gateway 408, Relay 274 and auth 28 passed. |
| API build and dashboard production build | Passed; OpenAPI generated with 192 paths and the localized link page compiled. |
| Preflight | Printed `preflight: ok`; graph checkpoint printed `ALL_DONE`. |
| `rtk proxy git diff --check` | Passed with only configured LF-to-CRLF working-copy warnings. |

This is source and disposable local PostgreSQL evidence. No external link-in-bio
provider, Fanvue API, production service or production database was used.
