# COMMANDS.md — AXIOM FanvueCRM Commands

## Build Commands
- `pnpm build` — build all packages
- `pnpm typecheck` — TypeScript typecheck
- `cargo build --workspace` — build Rust crates

## Test Commands
- `pnpm test` — run all TS tests
- `pnpm test:unit` — unit tests
- `node scripts/test-isolated-workspace.mjs --isolated-fixture` — local full build/test matrix using a fresh database in the existing labeled CI container on loopback port 55432; requires host process-control access and Docker, removes only the disposable database afterward, never loads `.env`
- `node scripts/test-security-gate.mjs` — isolated regressions for fail-closed advisory checks and filename-only secret reporting; no network or real credentials
- `cargo test --workspace` — run all Rust tests

## Validation
- `node scripts/probe-live-grok-media.mjs --authorized-live-once <user-id> <run-id> image` — Linux-only, explicitly authorized single real Grok image request; exclusive dispatch marker, no retry, no DB writes or publication
- `node scripts/probe-live-grok-media.mjs --authorized-live-once <user-id> <run-id> video <scanned-image-sha256>` — one real six-second video request bound to the independently scanned source image; failed/uncertain dispatch must be reconciled before another attempt
- `node scripts/rehearse-vision.mjs --generated-image <sha256>` — classify the content-hashed JPEG in ignored `var/live-grok-probe` with the pinned model in a network-disabled container; does not persist a bundle ToS verdict or establish model accuracy
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
- `.axiom/markers/<execplan>/<step>.done` — step completion marker
- SKIP = marker present + checksum match
- FAIL = marker present + checksum mismatch
- RUN = no marker present
