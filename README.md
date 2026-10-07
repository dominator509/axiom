# FanThynks — Creator OS

**Product:** FanThynks
**Registered domain:** `fanthynks.com` (production DNS/deployment pending)
**Legacy engineering codename:** `AXIOM` (Agent-Xrossed Influence & Operations Manager)
**Format:** 6Layer Software Blueprint Paradigm
**Status:** Implementation in progress; production acceptance remains gated
**Supersedes:** `FanvueArch.md` (v1)

FanThynks is the public product name. Existing `@axiom/*` packages, `AXIOM_*`
environment variables, database/storage identifiers, mobile slug, and historical
blueprint/ledger references retain their engineering names for compatibility.
The rebrand does not migrate credentials, change OAuth callbacks, or make the
registered domain a live deployment.

This pack is a complete, execution-ready blueprint for a cost-optimized, self-hostable, multi-tenant CRM that manages multiple Fanvue models and their full social-media ecosystems. It is a hardened rewrite of the v1 architecture with the same feature surface (nothing removed) plus the explicitly requested additions:

- The approved link-in-bio release target is **Native, Fanlynks, and Beacons.ai**, optional per model. Linktree is excluded by owner decision because it has no public API. Native works with no external setup; external providers remain unavailable until supported connection/provisioning, link sync, real analytics readback, revocation, and teardown are verified. Beacon CRM is a separate records API, not a Beacons.ai link-in-bio API. See `L1-product/L1.2-nfr-and-journeys.md`, `L2-architecture/L2.4-link-in-bio-providers.md`, and L5 criterion A1.
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

## Reproducible development and CI

Node **22** is the supported major; local development and GitHub Actions use
the exact **22.23.3** release in `.nvmrc` and `.node-version`, with
**pnpm 9.14.0** from `packageManager`. Select that Node version using your
version manager before installing. Node 24 is outside this contract.
The root `.npmrc` rejects unsupported engine versions; the environment check
also requires the exact pinned patch release.

Use `pnpm install --frozen-lockfile` for every normal install (local, CI,
and container). Intentional dependency changes use `pnpm add/update` and commit
the resulting lockfile. Do not regenerate the lockfile to bypass an install error.

Set `API_ORIGIN=http://127.0.0.1:3001` in the shell used for validation:

```sh
export API_ORIGIN=http://127.0.0.1:3001
node scripts/check-ci-environment.mjs
pnpm install --frozen-lockfile
pnpm --filter @axiom/api... build
pnpm --filter @axiom/dashboard test
pnpm --filter @axiom/api test
pnpm test
pnpm typecheck && pnpm lint && pnpm build
pnpm audit:dependencies
```

In PowerShell, use `$env:API_ORIGIN='http://127.0.0.1:3001'` for the first line.
The complete build requires symlink support; the hosted Linux run is the
reference when Windows denies Next standalone symlink creation.
Database-dependent tests require a disposable, isolated database; passing a
suite with database tests skipped does not replace the full CI receipt.

For isolated development, the API defaults to `API_HOST=127.0.0.1` and
`API_PORT=3001`; dashboard `dev` and `start` use port **3000**. Open
`http://127.0.0.1:3000`. Dashboard `/api/*` and `/linkbio/*` rewrites go to
the API on **3001**, never back to the dashboard. This matches CI's host-network
container fixture. The CI smoke command's HTTPS auth-origin argument is a
separate test-only cookie/auth contract; it does not change the HTTP rewrite.
Supply credentials only to your isolated local services; do not copy CI fixture
credentials to any external environment.

This origin is a build/test fixture, not a production setting. Production
continues to require an explicit service API origin. No deployment origins are
changed. `pnpm setup-dev` starts a database and runs migrations: only use it in
your own disposable environment, never against a shared or production database.

The six CI matrix legs run with `fail-fast: false`: a failed leg remains failed
and cannot cancel its siblings. No `continue-on-error` masks failures.

## Blueprint read order

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
