# AXIOM Repo Brief

This is a compact navigation page. [AGENTS.md](AGENTS.md) is the canonical control plane; [COMMANDS.md](COMMANDS.md) is the approved command surface.

## Mission

AXIOM is a self-hostable, multi-tenant CRM for operating Fanvue talent profiles and their social-media ecosystems. TypeScript handles orchestration and product surfaces, Rust handles hot-path services, and PostgreSQL 16 uses TimescaleDB and pgvector.

## Repository map

- `packages/`: API, auth, connectors, database, workers, MCP, relay, LLM gateway, dashboard, and mobile packages.
- `crates/`: egress plane, media plane, scraper, and vision engine.
- `scripts/`: canonical preflight, graph, build, test, migration, security, and verification commands.
- `L0-governance/` through `L5-verification/`: blueprint authority layers.
- `.agent/`: GraphLock execution plans, markers, and state.

## Session start

1. Read `AGENTS.md` fully, then `COMMANDS.md`.
2. Run `sh scripts/ledger.sh tail 30`.
3. Run `sh scripts/preflight.sh` and report exact missing items.
4. Run `sh scripts/graph-next.sh` and follow its one-line dispatch.

## Validation

- `sh scripts/build.sh`
- `sh scripts/test.sh`
- `sh scripts/verify.sh`
- `pnpm typecheck`
- `cargo test --workspace`

## Local runtime prerequisites

- PostgreSQL 16 must provide TimescaleDB, pgvector, and pgcrypto.
- `REDIS_URL` must answer `PING`; the current audit workstation uses its existing healthy local Redis service.
- Run `pnpm run setup:vision-model` to install the pinned ONNX model under ignored `var/models/`; the script verifies its published SHA-256 before promotion.
- Run `pnpm run audit:dependencies` for the fail-closed high/critical dependency audit, including repository-patched advisory regressions.

Treat raw gate output as authoritative. Never commit `.env` or expose secret values. Deployment-service artifacts are reference material on local audit workstations unless the user explicitly authorizes deployment.
