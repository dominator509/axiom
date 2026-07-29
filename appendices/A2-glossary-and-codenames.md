# Appendix A2 — Glossary & Codenames

## Codename

**AXIOM** — this hardened rewrite of the v1 Fanvue CRM architecture. Chosen for the design stance: a small set of load-bearing invariants (axioms) from which the rest of the system's safety and correctness follow.

## Layer paradigm (6Layer)

| Layer | Name | Question it answers |
|---|---|---|
| L0 | Governance | What must always be true? (invariants, security, compliance) |
| L1 | Product | What are we building and for whom? (features, personas, NFRs) |
| L2 | Architecture | How is it structured? (planes, stack, subsystems) |
| L3 | Specification | Exact contracts (DDL, interfaces, protocols) |
| L4 | Execution | How it gets built (marker-gated ExecPlans) |
| L5 | Verification | Proof it works (tests, DR, acceptance) |

## Load-Bearing Invariants (LBI)

| # | Invariant |
|---|---|
| 01 | No plaintext credentials at rest or in logs (envelope encryption). |
| 02 | Tenant isolation enforced by Postgres RLS on every org-scoped table. |
| 03 | Network egress is fail-closed (default-deny netns). |
| 04 | Control commands mutate state; only workers publish. |
| 05 | Publishing is exactly-once observable (idempotency keys). |
| 06 | Relay commands are signed, single-use, and expiring. |
| 07 | Capabilities are declared honestly; no faked platform actions. |
| 08 | Audit log is hash-chained and tamper-evident. |
| 09 | Prompt assembly follows TOKENKILLER prefix-cache discipline (>97%). |
| 10 | Builds are marker-gated (SKIP-if-done / FAIL-on-conflict). |
| 11 | ToS engine gates every publish; fails to block, never to pass. |
| 12 | A global kill-switch halts all egress in one write. |

## Terms

- **TOKENKILLER** — prefix-cache discipline: stable S0→S1→S2→S3 segment ordering, 64-token block alignment, append-only, to maximize LLM prefix cache hits.
- **Relay** — the on-the-go control channel (Telegram/iMessage/Signal/Discord) that pushes generation cards and accepts signed commands.
- **Viral memory loop** — generate→post→measure→label→embed→retrieve→bias cycle that self-improves via pgvector retrieval + a contextual bandit.
- **Plane** — an isolation/deployment boundary (BFF plane, Rust hot-path/egress plane, data plane).
- **ToS engine** — local-vision classifier producing pass/review/block verdicts before publish.
- **Consent & Records Vault** — encrypted store for adult-content compliance documents (2257/model release/ID).
- **Native provider** — the built-in, self-hosted link-in-bio; external providers (Fanlynks/Linktree/Beacons) are optional and composable (0..n).
- **BFF** — backend-for-frontend (Hono), the API surface the dashboard/PWA call.
- **DEK/KEK** — data encryption key (per-org) wrapped by a key encryption key (in KMS).
- **DLQ** — dead-letter queue (`job.state='dead'`), replayed idempotently.
- **MMR** — maximal marginal relevance, used to keep retrieved exemplars diverse.

## Stack quick-reference (defaults; swap-ins in `L2.1`)

Hetzner + Coolify + Cloudflare + R2 · Postgres 16 (+TimescaleDB, +pgvector) · Hono BFF · Rust egress/vision/media plane · Better Auth · Postgres-backed queue · GlitchTip + Prometheus + Grafana + OTel · local vision model · multi-provider LLM gateway.
