# AXIOM — Full Codebase Reconciliation Audit (2026-08-08)

Audit method: 3 parallel workers (feature catalog F-01..F-88 vs code; API/DB/queue vs
L3.0/L3.1/L3.4/L2.2; test fabrication + stub + dead-code scan across all packages/crates).
Every HIGH/MEDIUM finding below was **re-verified by the parent session with real tool
output** (systemctl, psql against live axiom_dev, grep, tsc, vitest, cargo). Subagent
findings were treated as leads, not facts.

Gate state: `preflight: ok`, `graph-next: ALL_DONE`, `verify: ok`.
Test totals (all run fresh): 1250 vitest + 64 cargo = 1314 green. All 6 systemd units
exist and are active (axiom-worker enabled+started as part of H-1).

---

## Bottom line

- **Production-ready:** ~44/88 features (~50%) — all 10 connectors, 8 worker executors,
  ONNX vision engine, JSON-RPC MCP client, ffmpeg media plane, egress plane, LLM gateway
  + TOKENKILLER, DB-backed viral pipeline, kill switch, mounted link-bio routes.
- **Partial:** ~27 (~31%) — real code but unwired/in-memory/schema-only.
- **Stubs:** ~10 (~11%) — explicit `// Stub` in 5 MCP tool files, relay command logging
  stub, dead-code packages.
- **Missing:** ~7 (~8%) — weekly digest, crash-report sink, auto-page sink, org-level
  sharing, mobile app, scraper→API wiring.
- **Test suite:** ~95% real, 0% fabricated, ~5% weak/unverifiable (no integration tests
  against live DB; contract middleware untested).

This is a genuine improvement over the 2026-08-06 audit (~30/20/50): the previously
broken pillars (vision model, MCP protocol client, ffmpeg, scraper parsing, DB viral
loop, link-bio mount, egress + planes as services) are verified real.

---

## HIGH severity (must fix)

### H-1. axiom-worker service inactive/disabled — queue not draining
- **Spec:** L3.4 §1–4 (claim loop, executors); F-77 DLQ; L2.0 canonical flow
- **Evidence (parent-verified):** `systemctl is-active axiom-worker` → `inactive`;
  `systemctl is-enabled axiom-worker` → `disabled`; no `runner.js` process running.
  Unit exists (`/etc/systemd/system/axiom-worker.service`, ExecStart
  `/usr/bin/node dist/runner.js`, dist built Aug 7 03:07). Live DB has 2 `ready` jobs
  sitting unclaimed.
- **Fix:** `systemctl enable --now axiom-worker`; verify claim loop drains `ready` jobs.

### H-2. MCP server tools are explicit stubs (F-45/F-46/F-47) and the package is unmounted
- **Spec:** L2.11, L3.0 MCP contract
- **Evidence (parent-verified):** `// Stub:` comments in 5 tool files:
  `packages/mcp-server/src/tools/publishing.ts:57`, `analytics.ts:35,55`,
  `generation.ts:44`, `inbox.ts:39,50,58`, `network.ts:48`. Zero packages import
  `@axiom/mcp-server` (grep of all package.json → no dep in api/worker).
- **Fix:** Replace stubs with real DB-backed tools (post_target insert, post_metric
  query, job enqueue) and mount the server at `/api/mcp`.

### H-3. Relay command execution logs only — no DB state change (F-69)
- **Spec:** L2.7 lifecycle control (Approve/Revise/Reject/Reschedule/Hold)
- **Evidence (parent-verified):** `packages/relay/src/commands.ts:90-91`:
  `// This would update content_bundle state in the DB — For now we log the command`;
  `this.auditLog.push(result)` (in-memory).
- **Fix:** Execute approve/revise/reject/hold against `content_bundle`/`post_target`
  through drizzle, keep signed-command validation.

### H-4. Cursor pagination is spec-only — zero endpoints implement it (L3.0) — **FIXED + VERIFIED**
- **Evidence (parent-verified):** `parseCursor`/`next_cursor`/`CursorPage` defined in
  `packages/api/src/contract.ts:223-237`, **0 usages** in any route file. List routes use
  `limit`/`offset` (models.ts:35-36, bundles.ts:194, fans.ts:49, audit.ts:17,
  incidents.ts:17, viral.ts:17).
- **Fix (d36d4b6):** Real keyset cursor wired into all list endpoints — models (ASC
  createdAt+id), bundles (DESC createdAt+id), fans (DESC lifetime_value_usd+id),
  incidents (DESC created_at+id), audit (DESC ts+id), viral top (DESC perf_score+id).
  contract.ts: `sql` imported as value (was type-only — latent runtime ReferenceError),
  `CursorColumn = AnyPgColumn | SQL`, encodeCursor normalizes numeric sort values to
  strings. contract.test.ts added: round-trip string/number/Date, garbage tolerance,
  limit clamping, SQL predicate rendering, next_cursor logic (M-3 closed for cursors).
- **Live bug found during verification (2429734):** E2E walk of /models?limit=2
  produced duplicate rows — PG stores microsecond timestamps (.357238) while JS Date
  truncates to ms (.357Z), so the boundary row satisfied `created_at > cursor` and was
  re-fetched. Fixed via migration 0008: keyset-sort timestamp columns
  (model_profile.created_at, content_bundle.created_at, job.created_at, audit_log.ts)
  ALTERed to `timestamp(3) with time zone`; drizzle schemas aligned with precision:3;
  regression test asserts the encoded boundary cursor decodes exactly and does not
  satisfy its own ASC predicate.
- **Verification:** api 207/207, db 122/122; **live E2E against running API +
  real Postgres**: signed-in session, 15 models created, 8-page walk at limit=2,
  zero overlap, `next_cursor` terminates null. Test artifacts cleaned from DB.

### H-5. post_target lacks UNIQUE(org_id, idem_key) — double-publish not structurally impossible
- **Spec:** L3.1 §11 (idem_key bytea NOT NULL + UNIQUE(org_id, idem_key)); LBI-05
- **Evidence (parent-verified, live axiom_dev):** `post_target.idem_key` column EXISTS
  but `pg_indexes` has **0 indexes** referencing idem → unique constraint absent.
- **Fix:** Migration 0005: backfill + `ALTER TABLE post_target ALTER COLUMN idem_key SET
  NOT NULL, ADD CONSTRAINT UNIQUE(org_id, idem_key)`.

### H-6. asset table has no sha256 — content-addressed dedupe absent (L3.1 §11)
- **Evidence (parent-verified, live):** `information_schema.columns` for `asset` shows
  file_name/mime_type/file_size/storage_key/width/height/duration — **no sha256 column**.
- **Fix:** Migration 0005: add `sha256 bytea` + `UNIQUE(org_id, sha256)`; wire asset
  ingest to compute it.

### H-7. relay_card schema diverges from L3.1 §5
- **Spec:** L3.1 §5 relay_card = bundle_id, channel, external_ref, state
- **Evidence (parent-verified, live):** columns =
  `id,org_id,title,description,icon,config,enabled,priority,created_at` — relay package
  uses its own shape; spec shape absent.
- **Fix:** Align migration 0005 (add bundle_id/channel/external_ref/state) and update
  relay card writer, or reconcile spec with implemented shape (documented decision).

### H-8. F-83 exemplar injection unwired — generate.ts hardcodes S2: ''
- **Spec:** L2.5/L2.8 exemplar injection into S2
- **Evidence (parent-verified):** `packages/api/src/routes/generate.ts:147` `S2: ''`;
  `buildS2()` (prompts.ts:298) only called in gateway.ts:789 with `tk.exemplars ?? []`;
  no retrieval pipeline call exists (generator.ts:122 comment says "populated by
  retrieval pipeline" — never wired).
- **Fix:** Retrieve top-K viral exemplars (pgvector) in generate route, pass to buildS2.

---

## MEDIUM severity

### M-1. RFC-7807 problem+json bypassed by ~45 route handlers
- `problem()`/`onError` real (contract.ts:23-61) but only middleware-emitted errors use
  it; route-level 4xx return ad-hoc `{error:{message}}` (models.ts:33,77,128;
  bundles.ts:100,107,138; posts.ts:125; fans.ts:61,128,204; …). `ProblemError`/
  `handleProblem` (contract.ts:64-89) are dead code — 0 usages.

### M-2. Idempotency-Key middleware store is in-memory (contract.ts:95-96,129-154)
- Lost on restart/per-process. Durable DB-side idempotency exists only in worker
  publish path (idempotency_ledger). Middleware on generate/bundles/posts/social is
  non-durable.

### M-3. Contract middleware has zero tests
- `packages/api/src/contract.test.ts` does not exist (parent-verified `ls`). No test
  references Idempotency-Key/Retry-After/429/correlation_id.

### M-4. FanvueConnector is REST-style, not MCP JSON-RPC (architectural inconsistency)
- `packages/connectors/src/fanvue.ts:18` `FANVUE_MCP_BASE = 'https://mcp.fanvue.com/v1'`
  with REST calls (/upload). Standalone `FanvueMcpClient` (fanvue-mcp/client.ts) is
  proper JSON-RPC but the worker publish path uses the REST connector. Not fabricated —
  inconsistent surface.

### M-5. @axiom/link-bio package is dead code
- 0 imports of `@axiom/link-bio` anywhere (parent-verified grep of package.json). API
  has its OWN real `routes/linkbio.ts` (DB-backed, verified). The package (33 tests) is
  never mounted — dead, while the feature is real via the API route.

### M-6. TimescaleDB absent — post_metric is a plain table (L3.1 §0)
- Extensions live: pgcrypto, plpgsql, vector only (parent-verified). No hypertable.
  Migration 0004 comment acknowledges the deferral.

### M-7. Relay ViralLoop/Bandit still in-memory (dual path)
- relay/viral/loop.ts:33-35 Map-based; bandit.ts:36 Map. DB-backed path is real and
  separate: worker executors/viral.ts persists viral_exemplar/recipe/embedding; API
  reads viral_exemplar (routes/viral.ts). The relay in-memory loop is a demo path fed
  by an ingest route nobody calls.

### M-8. Spec drift (documented, live-verified)
- job: id uuid vs bigint identity; max_attempts 3 vs 8; no state CHECK.
- idempotency_ledger: PK id uuid vs (org_id,idem_key); idem_key text vs bytea.
- org: no kek_id. model_profile: no UNIQUE(org_id,handle). post_metric: no org_id col
  (RLS via subquery). consent_record: no subject_ref/doc_kind/blob_ref.
- audit_log: id uuid vs bigint. app_user: email text vs citext. platform_connection:
  status default 'active' vs 'connected'.
- kill_switch table not created (org_settings.publishing_enabled used instead).

### M-9. No live-DB integration tests
- Every route test mocks `@axiom/db` with a chainable proxy (routes/test-utils.ts:10-46).
  Zero tests exercise real SQL against Postgres. Columns verified live; end-to-end
  route behavior UNVERIFIED in tests.

---

## LOW severity

- correlation_id not included in route error bodies.
- `expect(...).toBeDefined()` ×17 (weak but real assertions).
- `dashboards.test.ts` misnamed (tests analytics/viral/playbook/audit/incidents).
- `registerPrePostScript` exported, zero callers.
- No OpenAPI generation (L3.0 build-time OpenAPI claim unmet).
- No CI workflow file (L4.0 "CI" deliverable absent).

---

## Missing features (spec'd, not built)

- F-28 weekly digest (grep empty). F-73 GlitchTip/Sentry crash sink. F-78 auto-page
  into Relay (incidents has crashLoop detection + autoPage method but no external sink).
  F-86 org-level cross-model sharing. F-88 React Native app (no source in tsconfig).

---

## Verified REAL (no fabrication) — the pillars

- **ONNX vision engine** — live probe returned real softmax probs, engine=onnx-vit,
  model_loaded:true, 87MB model on disk. Heuristic only as logged fallback.
- **JSON-RPC FanvueMcpClient** — initialize/tools/list/tools/call; 11 tests pass;
  client.test.ts fresh run green (prior rtk failure was stale).
- **Scraper parsing** — real rehydration-JSON + meta parsing; followers hardcoded-0
  fixed; 8/8 tests.
- **ffmpeg media plane** — transcode/watermark/clip live; 3/3 tests.
- **Egress plane** — 6 modes, netns, WG, kill-switch; 32 cargo tests pass fresh.
- **Worker executors** — 8 real executors, claim_job SECURITY DEFINER SKIP LOCKED live,
  backoff/DLQ/park real; 22 tests.
- **DB RLS** — all 38 tenant tables RLS ENABLE + FORCE; fail-closed verified live.
- **All 14 formerly-missing entity tables exist live.** 42 tables total.

---

## GAP FIX ORDER (parent protocol: one at a time, fix → verify → report → commit)

1. ✅ H-1 worker service enable+start (operational, unblocks queue drain) — `076785f`
2. ✅ H-5 migration 0005: post_target UNIQUE + asset sha256 (+ relay_card alignment) — `2f453b9`
3. ✅ H-3 relay command execution → DB state — `d4535da`
4. ✅ H-2 MCP server: real tools + mount /api/mcp — `0d2ed45`
5. ✅ H-8 exemplar injection into generate S2 — `fd8c0f1`
6. ✅ H-4 cursor pagination on list routes (+ ms-precision keyset fix) — `d36d4b6`, `2429734`
7. M-3 contract.test.ts (cursor primitives covered; broader middleware tests remain)
8. M-5 mount or prune @axiom/link-bio package
9. M-7 reconcile relay in-memory loop vs DB path
10. M-1 route errors → problem+json
11. M-2 durable idempotency middleware
12. M-8 spec drift → migration alignment + spec-update entries
