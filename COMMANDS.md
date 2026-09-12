# COMMANDS.md — AXIOM FanvueCRM Commands

## Build Commands
- `pnpm build` — build all packages
- `pnpm typecheck` — TypeScript typecheck
- `cargo build --workspace` — build Rust crates

## Test Commands
- `sh infra/grok-cli/rand-regression/test-linux.sh` — default RNG regression plus explicit test-only syscall-backend entropy failure injection on Linux; accepts `--offline`
- `cargo test --locked --manifest-path infra/grok-cli/rand-regression/Cargo.toml` — RNG logging callback regression; separate vulnerable baseline intentionally fails and must not replace the normal CI gate
- `cargo test --locked --manifest-path infra/grok-cli/event-listener-regression/Cargo.toml` — patched dependency thread-safety and legitimate-use regression tests; the separate baseline manifest intentionally fails its compile-fail tests
- `pnpm test` — run all TS tests
- `pnpm test:unit` — unit tests
- `node scripts/test-isolated-workspace.mjs --isolated-fixture` — local full build/test matrix using a fresh database in the existing labeled CI container on loopback port 55432; requires host process-control access and Docker, removes only the disposable database afterward, never loads `.env`
- `node scripts/test-security-gate.mjs` — isolated regressions for fail-closed advisory checks and filename-only secret reporting; no network or real credentials
- `cargo test --workspace` — run all Rust tests

## Validation
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
