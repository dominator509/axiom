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
