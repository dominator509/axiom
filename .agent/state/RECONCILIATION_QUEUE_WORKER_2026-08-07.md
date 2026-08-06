# AXIOM — Reconciliation: Queue Worker Runtime + Missing Entity Tables

Date: 2026-08-07 · Commit: `f8d7aba` · Scope: L2.0 canonical flow runtime (L3.4), L2.2 entity tree

## 1. What was detected missing

| Gap | Evidence before fix |
|---|---|
| No worker claims jobs | `packages/` had no worker/scheduler/queue package; only `api`, `auth`, `connectors`, `core`, `dashboard`, `db`, `fanvue-mcp`, `link-bio`, `llm-gateway`, `mcp-server`, `relay` |
| Job table lacked L3.4 worker fields | `packages/db/src/schema/job.ts` had no `run_after`/`locked_by`/`locked_at`/`dedupe_key`; migration 0000 created only the base job row |
| No `SELECT … FOR UPDATE SKIP LOCKED` | No claim function in migrations; no code path used it |
| No publish.target dispatcher | `packages/api/src/routes/posts.ts` inserted `post_target` rows but never enqueued a job |
| No metrics.poll | `packages/relay/src/metrics/poller.ts` was an in-memory scheduler stub (no DB, no job) |
| 14 entity tables missing | Live DB had 28 tables; L2.2 entity tree lists ~42 org-scoped entities |

## 2. Honest count of "missing tables"

The user listed 21 names; **14 were genuinely missing** and are now created. The other
7 already existed from migration 0002 under singular naming:

- Already present: `org_settings`, `fan_crm_contact`, `fan_touchpoint`, `custom_request`,
  `linkbio_provider`, `linkbio_click`, `short_link`, `playbook_score`
- New in migration 0004: `api_key`, `asset_variant`, `pre_post_run`, `analytics_snapshot`,
  `viral_recipe`, `viral_embedding`, `bandit_state`, `seo_aeo_ranking`, `fanvue_metric`,
  `campaign`, `trigger_rule`, `linkbio_analytics`, `relay_binding`, `agent_permission`

Live table count: **28 → 42** (verified: `SELECT count(*) FROM pg_tables`).

## 3. Build — PASS (with file:line evidence)

### 3.1 Worker package `packages/worker` (new)

| Requirement (L3.4 §3) | Implementation | Evidence |
|---|---|---|
| Claim loop SKIP LOCKED | `claim_job()` SECURITY DEFINER function | `packages/db/migrations/0004_queue_worker_and_entity_tables.sql:63-96` |
| Org context scoped txn | `set_config('app.current_org_id', org_id, true)` in claim + executor txn | `packages/worker/src/worker.ts:66-69`, `claim.ts:26-31` |
| Backoff `min(cap, base·2^attempts) ± jitter` | `backoffDelayMs` | `packages/worker/src/backoff.ts:10-28` |
| DLQ at max_attempts | `state='dead'` | `packages/worker/src/worker.ts:98-106` |
| Kill-switch park (L3.4 §5) | `ParkJobError` + `readKillSwitch` | `packages/worker/src/executors/context.ts:18-26`, `worker.ts:44-52` |
| publish.target dispatcher | connector validate → publish → post_target + idempotency ledger same txn → enqueue metrics.poll | `packages/worker/src/executors/publish.ts:20-137` |
| metrics.poll | connector.fetchMetrics → post_metric insert → viral.label | `packages/worker/src/executors/metrics.ts:15-78` |
| viral.label (L3.5) | z-score label → viral_exemplar + viral_recipe + viral_embedding vector(768) | `packages/worker/src/executors/viral.ts:18-153` |
| tos.scan | text rules → bundle.tos_report → relay.card | `packages/worker/src/executors/tos.ts:19-87` |
| relay.card | render + channel adapter (fail-safe no-binding park) | `packages/worker/src/executors/relay_card.ts:19-107` |
| incident.notify / dlq.replay | audit + dead / reset | `packages/worker/src/executors/incident.ts`, `dlq.ts` |
| Same-txn enqueue + dedupe | `enqueueJob` | `packages/worker/src/enqueue.ts:22-45` |
| Idempotency key (L3.4 §4) | SHA256(model ‖ asset ‖ platform ‖ slot) | `packages/worker/src/idempotency.ts:17-33` |

### 3.2 API producers wired (canonical flow now has a runtime)

- `packages/api/src/routes/generate.ts:207-216` — enqueues `tos.scan` after bundle insert (same txn)
- `packages/api/src/routes/posts.ts:85-95` — enqueues `publish.target` with `run_after = scheduledFor` (same txn)
- `packages/api/package.json` — added `@axiom/worker` dependency

### 3.3 Schema & migration

- `packages/db/migrations/0004_queue_worker_and_entity_tables.sql` — ALTER job (4 columns + UNIQUE + `job_pick` partial index) + 14 tables + RLS policies + grants + claim_job()
- `packages/db/src/schema/{api_key,asset_variant,pre_post_run,analytics_snapshot,viral_recipe,viral_embedding,bandit_state,seo_aeo_ranking,fanvue_metric,campaign,trigger_rule,linkbio_analytics,relay_binding,agent_permission}.ts` — 14 new drizzle tables
- `packages/db/src/schema/job.ts` — worker columns added
- `packages/db/src/schema/index.ts` — barrel: 27 → 41 relations

## 4. Verification — PASS (real tool output)

- **db 120/120** (was 90: +30 new table/relation/index tests) — `packages/db/src/{schema,migrations,index}.test.ts`
- **worker 22/22** — backoff, idempotency, embedding, claim/state-machine tests
- **Workspace 1,215 TS tests green** (was 1,163; +52 across db/worker)
- **Typecheck clean** — all 11 packages `No errors found`
- **preflight: ok · verify: ok**
- **Cargo 44 green** (untouched Rust)

## 5. Live E2E (real DB, real worker process)

| Test | Result |
|---|---|
| `claim_job()` as non-superuser `axiom_app` (RLS active) | claimed job, state `running`, `locked_by=worker-live-test` |
| dlq.replay job through real worker | `state=done` |
| tos.scan on real bundle | `done`; `content_bundle.tos_report.verdict="pass"` written |
| relay.card with no binding | correctly **parked** (fail-safe L3.3 §5, never auto-publish) |
| publish.target under kill switch | **parked** at ready, attempts=0, "kill switch enabled" |
| publish.target with switch off | real connector validation ran → rejected (no media URL on synthetic bundle) → **dead (DLQ)** |
| Job table | `run_after`, `locked_by`, `locked_at`, `dedupe_key`, `job_pick` index, `job_org_dedupe_key` constraint — all present |

## 6. Remaining honest gaps (pre-existing, out of this scope)

- Real platform credentials absent → connector publish() fails closed into DLQ (correct behavior; needs OAuth wiring to go green)
- `relay.card` channel adapters need a configured binding + bot token for a green send
- TimescaleDB extension not installed → time-series tables are plain tables with ts indexes (hypertable conversion is a deployment upgrade)
- Viral embedding uses deterministic feature-hash (768-dim, HNSW-ready); a sentence-transformer can replace it under the same contract
