---
tags:
  - axiom
  - architecture
---

# Architecture

Back to [[Welcome]]. Detailed authority remains in the [repository brief](../REPO_BRIEF.md) and blueprint layers.

## Planes

- TypeScript orchestration and surfaces: [`packages/`](../packages/)
- Rust hot-path services: [`crates/`](../crates/)
- PostgreSQL schema and migrations: [`packages/db`](../packages/db/)
- Operational gates: [`scripts/`](../scripts/)
- GraphLock plans and state: [`.agent/`](../.agent/)

## TypeScript packages

API, auth, connectors, core, dashboard, database, Fanvue MCP, LLM gateway, MCP server, mobile, relay, and worker.

## Rust crates

Egress plane, media plane, scraper, and vision engine.

## Durable invariants

- Multi-tenant organization isolation and PostgreSQL RLS.
- Durable idempotency and fail-closed security behavior.
- PostgreSQL 16 with TimescaleDB, pgvector, and pgcrypto.
- Linux is required for production network namespaces, WireGuard, firewalling, and systemd services.
