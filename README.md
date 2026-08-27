# Fanvue CRM — Enterprise Blueprint Pack (v2, "Perfected")

**Codename:** `AXIOM` (Agent-Xrossed Influence & Operations Manager)
**Format:** 6Layer Software Blueprint Paradigm
**Status:** Ready for greenfield execution
**Supersedes:** `FanvueArch.md` (v1)

This pack is a complete, execution-ready blueprint for a cost-optimized, self-hostable, multi-tenant CRM that manages multiple Fanvue models and their full social-media ecosystems. It is a hardened rewrite of the v1 architecture with the same feature surface (nothing removed) plus the explicitly requested additions:

- Link-in-bio ships with the **native first-party provider**. Fanlynks / Linktree / Beacons remain design-only until their real provisioning/OAuth/analytics adapters are implemented; they are not exposed as enabled integrations.
- **First-class connectors for 10 networks:** Instagram, TikTok, X, YouTube (+ Shorts), Reddit, Threads, Discord, Telegram, Facebook, Snapchat — each with an honest capability matrix.
- **Relay Control Channel:** on generation, a rich card (preview + caption variants + per-platform hashtags + ToS scores) is pushed to Telegram / Discord / iMessage / Signal and you control the entire lifecycle from your phone.
- **Observability & Incident Plane:** automatic bug/crash reporting, structured logging, dead-letter replay, and auto-paging into the Relay.
- **Viral Memory Loop:** a closed generate → post → measure → label → embed → retrieve → bias loop that remembers what went viral and continuously improves generation.

Plus cost, speed, and security upgrades throughout (single-box self-host option, Postgres-backed queue, Rust hot-path plane, fail-closed egress, envelope encryption, hash-chained audit, signed control commands, local vision classification).

---

## The 6 Layers

| Layer | Purpose | Directory |
|---|---|---|
| **L0 — Governance** | Charter, load-bearing invariants, security & compliance posture, greenfield marker protocol, risk register. The non-negotiables. | `L0-governance/` |
| **L1 — Product** | Vision, personas/roles, the full feature catalog (proof nothing was dropped), non-functional requirements, user journeys. | `L1-product/` |
| **L2 — Architecture** | System design, topology, data model, connector framework, link-in-bio providers, LLM gateway, network isolation, relay, viral loop, observability, MCP, security. The "how it fits together." | `L2-architecture/` |
| **L3 — Specification** | Concrete contracts: API/MCP schemas, DDL, interface definitions, protocol specs. The "exact shape." | `L3-specification/` |
| **L4 — Execution** | 15-section ExecPlans per milestone with per-step validation commands and recovery procedures. The "build order." | `L4-execution/` |
| **L5 — Verification** | Test matrix, validation commands, recovery/DR procedures, security audit checklist, acceptance criteria. The "how we know it works." | `L5-verification/` |

Appendices (`appendices/`) hold the platform capability matrix, the cost model, and the glossary/codenames.

---

## Read order

1. `00-IMPROVEMENTS-AND-CHANGELOG.md` — what changed vs v1 and why (start here).
2. `L0-governance/L0.0-governance-and-invariants.md` — the invariants everything else must uphold.
3. `L1-product/L1.1-feature-catalog.md` — confirm your feature is present.
4. `L2-architecture/*` — the design.
5. `L4-execution/L4.0-execplan-index-and-roadmap.md` — the build path.

## Established methodology carried into this pack

- **6Layer paradigm:** Governance → Product → Architecture → Specification → Execution → Verification.
- **TOKENKILLER prefix-cache discipline:** stable `S0→S1→S2→S3` segment ordering, 64-token block alignment, append-only transcripts, >97% cache-hit target. Applied to every LLM call in the gateway.
- **Marker-gated greenfield semantics:** SKIP vs FAIL distinction, append-only ledgers, loud pre-workspace guards.
- **Fail-closed everything:** egress killswitch, publish idempotency, hash-chained audit.
- **Rust-first hot paths:** media/transcode/watermark/clip, egress binding, scrape — the CPU-bound plane is Rust; orchestration stays TypeScript.
- **Self-hosted, minimal-dependency default:** one box + Cloudflare + R2 can run the whole system; managed services are optional swap-ins.
