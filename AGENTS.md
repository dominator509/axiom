# AGENTS.md — AXIOM FanvueCRM Control Plane

This file is the single canonical authority for any agent working this repository. It implements the 6Layer GraphLock convention from the blueprint pack.

## 1. Mission

Build AXIOM: a cost-optimized, self-hostable, multi-tenant CRM for operating Fanvue talent profiles and their full social-media ecosystems. Rust hot-path plane + TypeScript orchestration + PostgreSQL 16 (TimescaleDB + pgvector) on a single Hetzner box.

## 2. THE BOOT SEQUENCE

PRIME-BLOCK-BEGIN
This repository is governed by the AXIOM FanvueCRM Blueprint v2 (6Layer paradigm). AGENTS.md is the authoritative control plane.
On every session start, execute THE BOOT SEQUENCE:
1. Read AGENTS.md fully. 2. Read COMMANDS.md. 3. Run: sh scripts/ledger.sh tail 30. 4. Run: sh scripts/preflight.sh -- it MUST print "preflight: ok"; if it fails, report the exact missing items. 5. Run: sh scripts/graph-next.sh and dispatch on its one-line output. 6. Repeat step 5 after every completed node until ALL_DONE, then run the ship gate.
Hard rules: do not ask the user questions. Use only commands from COMMANDS.md. One node at a time. Commit after every milestone. Append ledger events. No stubs, mocks, demo modes. Every line must be real.
PRIME-BLOCK-END

## 3. Source-of-truth hierarchy

Current explicit user instruction > L0-L1-L2-L3-L4-L5 per blueprint > repository code and tests > gate output as fact.

## 4. Phase Protocol

- P0 (Foundation): monorepo scaffold, Postgres schema, RLS, auth, CI
- P1 (Connectors & Network): Rust egress plane, netns fail-closed, 10 connectors, Fanvue MCP
- P2 (Intelligence): LLM gateway + TOKENKILLER, local vision ToS, generation pipeline
- P3 (Control & Learning): Relay channel, viral loop + bandit, observability
- P4 (Surface): Link-in-bio providers, CRM-as-MCP agents, dashboard, mobile

## 5. Ship Gate

All phases complete → run full test matrix (L5.0) → ALL LBIs verified → Run: sh scripts/verify.sh → must print "verify: ok"
