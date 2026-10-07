# COMMANDS.md — AXIOM FanvueCRM Commands

## Build Commands
- `pnpm build` — build all packages
- `pnpm typecheck` — TypeScript typecheck
- `cargo build --workspace` — build Rust crates

## Test Commands
- `node scripts/check-braces-patch.mjs` — verify all active braces installations against pinned source hashes and run depth/compatibility regressions before audit recognition
- `pnpm test:browser` — build real API/dashboard and pinned Chromium; repeat the HTTPS sign-in/workspace/branding journey against owned internal Docker fixtures, verify negative controls and cleanup; no live targets or reused credentials. Requires a clean committed checkout. Receipts: `var/browser-rehearsal/`.
- `node scripts/test-vitest-mocker.mjs` — installed Vitest redirect-mock file boundary regressions using synthetic temporary files; no network listener or credentials
- `node scripts/rehearse-egress.mjs --isolated-fixture` — build copied Rust source and run all egress tests, including real Linux netns/WireGuard/leak cases, in a disposable network-disabled Docker container; no host mounts, ports, database, provider calls or production changes. Namespace provisioning capabilities exist only inside the test container; evidence is written under ignored `var/egress-rehearsal/`.
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --viral-evidence` — check published/provider-backed insights filtering against disposable PostgreSQL
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --digest-status` — verify active weekly schedule selection and tenant isolation in disposable PostgreSQL; no external dispatch
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --database-readiness` — verify schema readiness under the runtime role, including empty schema, missing tables/columns and revoked access, using transactional DDL only in a labeled disposable local database
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --team-operations` — post-note ownership/RLS/pagination and shift concurrency in a disposable PostgreSQL database
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --playbook-history` — real PostgreSQL guideline snapshot/concurrent-save/tenant history checks in a disposable database
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --viral-retrieval` — real pgvector retrieval, evidence filtering and model/tenant sharing isolation in a disposable database
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --variant-performance` — real API/PostgreSQL variant-performance query acceptance in a fresh disposable database; no provider or live workspace operations
- `node scripts/test-phase-gates.mjs` — isolated regressions for exact phase tokens and missing prerequisite phases; no live ledger or marker changes
- `node scripts/test-step-markers.mjs` — isolated marker lifecycle regressions for run/skip, explicit refresh, manifest/input checksum drift, path escape and cleanup; synthetic temporary files only
- `node scripts/hermes-sync-check.mjs var/hermes-control/current-task.json <task-envelope.json>` — fail-closed Codex/Hermes task, source-pin, remote-ref, and worktree-binding reconciliation; no network or live action. The current-task manifest is generated after the final Git push and is intentionally ignored by Git so its pinned `SOURCE_REF_HEAD` cannot be invalidated by the manifest commit itself.
- `sh infra/grok-cli/rand-regression/test-linux.sh` — default RNG regression plus explicit test-only syscall-backend entropy failure injection on Linux; accepts `--offline`
- `cargo test --locked --manifest-path infra/grok-cli/rand-regression/Cargo.toml` — RNG logging callback regression; separate vulnerable baseline intentionally fails and must not replace the normal CI gate
- `cargo test --locked --manifest-path infra/grok-cli/event-listener-regression/Cargo.toml` — patched dependency thread-safety and legitimate-use regression tests; the separate baseline manifest intentionally fails its compile-fail tests
- `pnpm test` — run all TS tests
- `pnpm test:unit` — unit tests
- `node scripts/test-isolated-workspace.mjs --isolated-fixture` — local full build/test matrix using a fresh database in the existing labeled CI container on loopback port 55432; requires host process-control access and Docker, removes only the disposable database afterward, never loads `.env`
- `node scripts/test-security-gate.mjs` — isolated regressions for fail-closed advisory checks and filename-only secret reporting; no network or real credentials
- `node scripts/hermes-protocol-audit.mjs <message.json|directory> [TASK] [--allow-pending]` — fail-closed logical ACK/NACK journal audit; ignores legacy transport timestamps and rejects WIRE collisions, unreadable correlations, sequence gaps, wrong signatures/roles, contradictory NEXT_OWNER handoffs, evidence-free progress, and silent pending ownership
- `node --test scripts/hermes-protocol-audit.test.mjs` — local protocol journal regressions; no network, bridge, credentials or runtime changes
- `cargo test --workspace` — run all Rust tests

## Validation
- `sh scripts/fetch-vision-model.sh` — fetch and checksum the pinned public ONNX artifact into ignored local storage; no inference or accuracy claim.
- `node scripts/rehearse-l5-runtime.mjs --isolated-fixture` — build committed API/media/vision images, exercise real worker/audit/ToS boundaries twice in owned network-disabled PostgreSQL fixtures, and verify cleanup; requires the pinned model and a clean committed checkout. No existing databases, host mounts, published ports, provider credentials or customer media.
- `node scripts/rehearse-rls-catalog.mjs --isolated-fixture` — build the committed schema, migrate a fresh network-disabled PostgreSQL container, verify effective RLS and role privileges, inject rollback-only faults and exercise tenant locale writes; never reads `.env` or an existing database URL. Requires clean committed source and pinned Node. Receipts and private logs: `var/rls-rehearsal/`.
- `node scripts/check-release-evidence.mjs --check` — verify complete L5 acceptance coverage and receipt structure; open rows remain open and this is not release approval.
- `node scripts/check-release-evidence.mjs --receipt-log-sha <job-id>` — print the SHA-256 of raw GitHub Actions job-log bytes for receipt assembly; this does not validate the job or accept a criterion.
- `node scripts/check-release-evidence.mjs --verify-receipts <full-sha> [--register <path>]` — verify run/job metadata and raw log hashes for passed evidence rows at that exact SHA while leaving open criteria and owner sign-off gates intact; an external post-run JSON register is supported (`<path>` is resolved from the current working directory), while normative requirements and invariant mappings are read from the immutable tested SHA. This is not release approval.
- `node --test scripts/check-release-evidence.test.mjs` — isolated negative controls for missing/stale/failed evidence and unavailable hosted readback; no services, credentials or database access.
- `node scripts/check-release-evidence.mjs --release <full-sha> [--register <path>]` — require all acceptance rows passed without skips, exact-SHA receipts, owner sign-off and successful GitHub run/job readback; fails closed on missing evidence. A supplied register is evidence data only (`<path>` is resolved from the current working directory); requirements come from the immutable tested SHA. Does not deploy or authorize production operations.
- `node scripts/check-ci-environment.mjs` — verify pinned local/CI Node and pnpm plus the explicit loopback API-origin fixture; no service or database access
- `node packages/worker/dist/runner.js` — existing continuous worker; setting both `WORKER_MEDIA_ORG_ID` and `WORKER_MEDIA_MODEL_ID` restricts it to that model's unstarted media-generation/ToS/local-transform jobs. Transforms additionally require a queued operation and matching source-asset ownership. Partial/invalid scope fails startup. Scoped mode never invokes global claims or registers publishing connectors; prior attempts and uncertain dispatches require reconciliation. Build worker first and provide the normal runtime/scanner configuration. Without either scope setting this remains the full worker, including publication.
- `node scripts/run-exact-media-job.mjs --inspect <org-id> <model-id> <bundle-id> <job-id>` — read-only exact media/ToS job inspection with explicitly supplied database environment; never loads dotenv or prints payloads
- `node scripts/run-exact-media-job.mjs --execute-approved <org-id> <model-id> <bundle-id> <job-id>` — explicitly authorized Linux-only first-attempt execution of one existing media/ToS job through the real worker; requires current package builds/runtime configuration, no queue loop, retry loop or publishing executor; inspect/reconcile non-done outcomes before further action
- `node scripts/rehearse-worker-video.mjs --existing-probe <sha256> --with-database` — additionally run actual video verdict/handoff commit and lease-loss rollback tests in a fresh disposable PostgreSQL fixture; no live workspace or provider writes
- `node scripts/rehearse-worker-video.mjs --existing-probe <sha256>` — real worker video evaluation against isolated media/vision containers using a copied existing probe; requires built worker and rehearsal images, no provider/queue/approval/database writes
- `node scripts/test-docker-context.mjs --isolated-fixture` — verify Docker context exclusions using synthetic files and a scratch image export; no workspace secrets enter the fixture, temporary output removed
- `node scripts/test-isolated-workspace.mjs --isolated-fixture --worker-media-failure` — run real worker terminal-transition and lost-lease rollback checks in a fresh disposable PostgreSQL database; no workspace build, provider calls, or live dashboard changes
- `node scripts/rehearse-generated-media.mjs --existing-probe <sha256> <jpg|png|mp4>` — copy a content-hashed artifact from ignored `var/live-grok-probe` through the built worker store and API preview code, with sanitization off/on and Safari-style ranges; requires API/worker builds and FFmpeg, removes only private temporary copies, no provider/DB/approval operations
- `node scripts/rehearse-grok-installed-runtime.mjs <absolute-cli-path> <absolute-launcher-path>` — offline installed CLI/sealed-input/R2 managed-config checks using synthetic credentials and a network-disabled Linux sandbox
- `node scripts/backup-recovery-database.mjs --local-backup` — explicitly authorized private local backup; no credentials printed
- `node scripts/rehearse-recovery-upgrade.mjs --restore-copy <archive> <sha256>` — verify the local backup by restoring an access-restricted copy
- `node scripts/apply-local-character-lock.mjs --rehearse-copy <copy> <archive> <sha256>` — rehearse only migration 0026 with atomic ledger insertion and existing profile value verification
- `node scripts/apply-local-character-lock.mjs --apply-approved <copy> <archive> <sha256>` — operator-approved migration 0026 on the configured recovery DB, requiring a rehearsed copy and matching backup hash; never restarts services
- `node scripts/test-local-grok-startup.mjs --isolated-fixture` — Linux launcher process-boundary checks with disposable configuration; failed, signalled, timed-out or missing schema checks must never start the API; no real database or provider calls
- `node scripts/check-local-grok-schema.mjs --read-only` — inspect required character-lock column metadata in the configured loopback recovery database; read-only transaction, no tenant rows or credentials printed, no migration or restart
- `node scripts/rehearse-media-sanitizer.mjs --isolated-fixture` — generated-media runtime rehearsal for JPEG, PNG and MP4/audio; requires worker build and ffmpeg/ffprobe, never reads credentials or user media
- `node scripts/sanitize-media.mjs <input.jpg|png|mp4> <new-output.png|mp4>` — optional privacy sanitizer shared with upload/generation; build the worker first, requires ffmpeg/ffprobe; strips embedded metadata/C2PA through re-encoding and container validation, never overwrites existing files, does not erase external fingerprint records or watermarks
- `node scripts/check-grok-rand-contract.mjs --fetch-upstream` — verify shipped RNG lock patch against hash-pinned upstream and harness checksums, including reverted-patch negative control; use `--local-source var/grok-source-37949780` for offline source
- `node scripts/rehearse-grok-patchset.mjs --isolated-fixture` — apply all pinned Grok patches to a temporary Git index and compare every resulting file with the tested candidate; no credentials, build or upstream checkout edits
- `node scripts/probe-live-grok-media.mjs --authorized-live-once <user-id> <run-id> image` — Linux-only, explicitly authorized single real Grok image request; exclusive dispatch marker, no retry, no DB writes or publication
- `node scripts/probe-live-grok-media.mjs --authorized-live-once <user-id> <run-id> video <scanned-image-sha256>` — one real six-second video request bound to the independently scanned source image; failed/uncertain dispatch must be reconciled before another attempt
- `node scripts/rehearse-vision.mjs --generated-image <sha256>` — classify the content-hashed JPEG in ignored `var/live-grok-probe` with the pinned model in a network-disabled container; does not persist a bundle ToS verdict or establish model accuracy
- `node scripts/rehearse-vision.mjs --generated-video <sha256>` — classify prepared 2fps frames of the content-hashed video in ignored `var/live-grok-probe`; probe-only evidence, not a persisted bundle verdict or full-video/audio approval
- `node scripts/rehearse-vision.mjs --isolated-fixture` — verify both pinned vision inference routes and authorization/path boundaries on the existing local fixture
- `node scripts/test-login-stream-compression.mjs` — verify actual dashboard gzip buffering and immediate delivery with no-transform on a credential-free loopback SSE fixture
- `node scripts/provision-local-grok-user.mjs --inspect <email>` — inspect only the explicitly identified local recovery account; never reads credential fields
- `node scripts/provision-local-grok-user.mjs --rehearse <email> <expected-user-id>` — rehearse isolated operator-workspace assignment and audit insertion, then roll back
- `node scripts/provision-local-grok-user.mjs --assign <email> <expected-user-id>` — explicitly authorized local assignment only, after inspection and rehearsal; refuses already-assigned accounts and never grants recovered-tenant access
- `node scripts/test-local-grok-origin.mjs` — validate exact private phone-tunnel origins without loading credentials or starting services
- `sh scripts/preflight.sh` — pre-flight gate (MUST print "preflight: ok")
- `sh scripts/verify.sh` — full verification gate (MUST print "verify: ok")
- `sh scripts/lint.sh` — lint all code
- `sh scripts/build.sh` — full build

## Git
- `git commit -m "[AXIOM][P{phase}][M{step}] message"` — milestone commits
- `git tag green/P{phase}` — phase completion tags

## Marker System
- `.axiom/markers/<execplan>/<step>.done` — JSON step manifest with the completed step ID and hashes of its input files; a sibling `.done.sha256` pins the manifest bytes
- `node scripts/step-markers.mjs write --root <repo> --marker <relative.done> --step <id> --input <relative-file> [--input <relative-file> ...]` — create a marker only after the step is satisfied; rebind changed inputs only with explicit `--refresh`
- `node scripts/step-markers.mjs check --root <repo> --marker <relative.done>` — return `SKIP` only when the marker and all input hashes match; return `RUN` when absent; fail closed on checksum drift
- `node scripts/step-markers.mjs verify-all --root <repo> --directory .axiom/markers` — verify every canonical step marker and reject orphan checksum sidecars
- SKIP = marker and checksum sidecar present + marker checksum and every recorded input checksum match
- FAIL = marker pair present but malformed, missing a sidecar, or any checksum mismatch
- RUN = no marker and no orphan checksum sidecar
