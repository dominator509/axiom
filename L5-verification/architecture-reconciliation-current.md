# Current architecture reconciliation

Date: 2026-09-18  
Repository: `dominator509/axiom`  
Source checkpoint: `bad8345f6c839ac2d0f1553c25054d8b34fa97a7`

This is a fact record, not a production-readiness claim. The requirements come
from `L1-product/L1.1-feature-catalog.md`; intended boundaries come from the
relevant `L2-architecture/` documents; API and MCP behavior comes from
`L3-specification/`; current wiring and gaps come from
`L5-verification/backend-frontend-coverage-audit.md` and the later milestone
receipts. Historical audit baselines are not silently treated as current source.

## Evidence vocabulary

- **Source-wired:** a real schema/API/worker/runtime path exists in this
  checkout. This is not browser, deployment, or provider acceptance.
- **Partial:** a source path exists, but the architecture contract or user
  workflow is incomplete.
- **Internal:** mechanics are intentionally not a direct user button; the
  user-facing outcome still requires acceptance.
- **Optional/not enabled:** the architecture explicitly does not require or
  expose this provider until its lifecycle is implemented.
- **Open gate:** source evidence exists or is planned, but runtime/provider/
  operator proof is missing.

## Reconciled status

| Architecture area | What the current evidence actually supports | Still open or explicitly bounded |
| --- | --- | --- |
| Model workspaces and character/profile controls (F-01/F-41) | Source-wired model workspace/profile and character-lock paths; role and browser acceptance remain separate. | Authenticated desktop/mobile acceptance and complete role matrix. |
| Network and per-model egress (F-02/F-04/F-43) | Model-scoped network configuration, encrypted credential paths, health/apply controls and Rust fail-closed code exist. | Privileged Linux namespace/WireGuard/proxy leak rehearsal, customer-configured egress runtime, and browser/operator acceptance. |
| Generation, ToS, approval and transforms (F-09/F-29/F-30/F-32/F-36/F-37) | Real API/worker/media-operation contracts and approval interlocks exist; clipping/adaptation and transforms have source tests. | Deployed media/vision runtime, playback, provider execution and complete user acceptance. |
| Uploaded/generated media | Upload, generated-asset storage, source-image selection, bounded previews and media operations exist in source. | The static audit explicitly says there is no complete persistent gallery for uploaded and generated image/video across lifecycle states. |
| Sanitization | `packages/worker/src/media-sanitizer.ts`, `scripts/sanitize-media.mjs` and the rehearsal script are real source. They rebuild supported JPEG/PNG/MP4 outputs and expose an opt-in path. | The CLI reports `externalProvenanceErased: false`; no claim is made for C2PA/external provenance removal or byte-fingerprint anonymity. |
| Variants and A/B (F-13/F-15/F-16) | Model-scoped lifecycle, assignments, exposure/outcome capture, attribution and winner/reward source paths exist. | Remaining guidance/hook/timing evidence, statistical/runtime acceptance and deployed worker/provider acceptance. |
| Team and shifts (F-24/F-25/F-26) | RBAC, shift lifecycle, handoff/post-note routes and dashboard controls exist. | Dedicated Chatter restrictions, complete pagination and authenticated multi-user browser/RLS acceptance. |
| Playbook (F-54/F-55/F-56/F-57) | Revisioned guideline storage/editor, calendar checks and generation enrichment exist in source. | All consumer coverage, stale-editor/history browser acceptance and deployed migration acceptance. |
| Scraper and research (F-17/F-18) | Authenticated bounded scrape runs, worker dispatch, model egress binding and partial-result/error handling exist. | Deployed sidecar/provider isolation, benchmark history and result-quality acceptance. |
| Viral loop (F-79–F-86) | Metric/evidence filtering, labels, recipes, embeddings/retrieval and parts of reward/digest logic exist. | Full recipe fields, revenue/conversion attribution, all contextual arms, cross-model opt-in behavior, scheduled insight/Relay delivery and runtime acceptance. |
| Connectors and OAuth (F-03/F-31/F-58–F-67) | Static connector contracts and capability declarations exist for supported paths. | Live OAuth, refresh/revoke/disconnect, account onboarding, provider upload/publish/metrics receipts and browser acceptance. Snapchat remains capability-honest manual-assist where its API does not support organic posting. |
| Link-in-bio (F-48–F-53) | The Native provider is the current production-enabled default. | Fanlynks, Linktree and Beacons are optional planned adapters and must remain hidden/rejected until their full lifecycle exists; a database row is not evidence of a connection. |
| R2 media storage | Grok R2 credential storage/status/verify routes, encrypted managed config and tests exist. | A real configured bucket round-trip through the deployed application, retention/delete evidence and operator acceptance. |
| Relay and operator controls (F-68–F-72) | Cards, signed/replay-protected command paths, several approval/revision/review workflows, and a model-scoped cursor-paginated/redacted Relay-card history with an approval deep-link are source-wired. | Attachment sending, external delivery, uncertain-outcome reconciliation and deployed channel acceptance. |
| Observability (F-73–F-78) | Internal crash sink, error boundary, correlation and durable DLQ-related source paths exist. | GlitchTip/Sentry, Loki, Prometheus/Grafana, OpenTelemetry, alerts, crash-loop paging and deployed failed-job recovery. L2.9 explicitly treats those as runtime integrations, not bundled proof. |
| Deployment and release | CI, migration/recovery scripts and a bridge exist; the Hermes target-context repair is not integrated. | Safe installer/bridge source repair, isolated migration/rollback, immutable TEST deployment, worker/media readiness, branch protection readback for the new SHA and production/operator gates. |

## Reconciliation rule

No item above is promoted from partial/open to complete because a page exists,
a route is registered, a unit test passes, a health endpoint returns 200, or a
provider row exists. The next implementation node must cite the exact source
paths, contract tests and remaining runtime/provider evidence before the status
changes.

## Current source correction — calendar surface

The calendar row above is now additionally source-wired for a responsive
month/week visual board and guarded pending-post day moves. The board reuses the
existing post PATCH contract and verifies the returned identity, state, and
schedule before refreshing. It also renders advisory time windows derived from
verified viral-performance buckets without scheduling or publishing. This
changes only the source-wired column; authenticated browser/mobile interaction,
provider execution, and deployed runtime acceptance remain open.
