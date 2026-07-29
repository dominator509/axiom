# What Changed vs v1 — Improvements & Changelog

This document is the audit trail of every deviation from `FanvueArch.md` (v1). Grouped by the objective it serves: **cheaper**, **faster**, **more secure**, **requested feature**, or **correctness**. No v1 feature was removed; several were generalized so they are strictly more capable.

---

## A. Requested additions (mandatory)

### A1. Link-in-bio is now optional and provider-pluggable
**v1:** The CRM auto-provisioned a Fanlynks instance (Docker/Vercel subdomain) on every model creation. Fanlynks was first-class and effectively required; Linktree/Beacons were bolt-ons.

**v2:** Introduced a `LinkInBioProvider` abstraction with four interchangeable implementations:
- **Native** (default) — a CRM-hosted link page rendered from the same app at the edge. Requires **nothing** external, is the cheapest and fastest, and is what a model gets by default.
- **Fanlynks** (optional) — self-hosted deploy, provisioned only if enabled.
- **Linktree** (optional) — via API.
- **Beacons** (optional) — via API.

A model may have **zero, one, or several providers active at once**. Analytics are normalized across all active providers into one dashboard. The deployment engine provisions only what is toggled on. This satisfies: *"shouldn't require deployment of fanlynks or linktree or both … allow them as optional (one or more at the same time)."* See `L2-architecture/L2.4-link-in-bio-providers.md`.

### A2. First-class support for 10 social networks
**v1:** Only X + Instagram + Reddit were meaningfully specified; the framework was implied.

**v2:** A **Social Connector Framework** with a uniform `SocialConnector` capability interface and concrete adapters for **Instagram, TikTok, X, YouTube (incl. Shorts), Reddit, Threads, Discord, Telegram, Facebook, Snapchat.** Each adapter declares a **capability matrix** (API-native publish vs. link-share vs. manual-assisted) so the system never pretends to automate something a platform's official API forbids. See `L2-architecture/L2.3-social-connector-framework.md` and `appendices/A0-platform-capability-matrix.md`.

### A3. On-the-go generation control (Relay Control Channel)
**v1:** An "Omnichannel Approval Router" existed for approvals via Discord/Telegram/iMessage/Signal, but it was framed as a simple approve/revise gate downstream of scheduling.

**v2:** Promoted to the **Relay Control Channel** — a first-class subsystem. The moment an asset is generated, a rich message is pushed to your chosen channel containing the preview, proposed caption variants, **per-platform hashtag sets**, per-platform ToS risk scores, and the target platform list. From the channel you can Approve / Approve-for-specific-platforms / Edit caption / Change price / Reschedule / Regenerate / Revise-with-instructions / Hold / Reject — the full lifecycle, from your phone, with **signed, replay-protected commands.** See `L2-architecture/L2.7-relay-control-channel.md`.

### A4. Automatic bug/crash reporting & logging
**v1:** Not present.

**v2:** An **Observability & Incident Plane**: structured JSON logs with correlation IDs, self-hosted Sentry-compatible crash tracking (GlitchTip), OpenTelemetry traces, Prometheus/Grafana metrics, per-service and per-egress health checks, dead-letter queues with replay, crash-loop detection, and **auto-paging of severe incidents into the Relay** so you hear about breakage on your phone. See `L2-architecture/L2.9-observability-incident-plane.md`.

### A5. Self-improving viral memory loop
**v1:** A/B testing and social listening existed but did not feed a persistent learning store.

**v2:** A **Viral Memory Loop**: every post's realized performance is captured over time windows; posts crossing dynamic per-platform/per-model percentile thresholds are labeled high-performers; their **full generative recipe** (prompt inputs, caption structure, hashtag set, time, format, hook, thumbnail features) is stored; captions/hooks are embedded into **pgvector**; the generators retrieve top-K proven exemplars and inject them into the prompt's dynamic suffix; a contextual-bandit layer does explore/exploit over caption/hook/time/format. The loop is: generate → post → measure → label → embed → retrieve → bias → repeat. See `L2-architecture/L2.8-viral-memory-loop.md`.

---

## B. Cost reductions

| Change | v1 | v2 | Why cheaper |
|---|---|---|---|
| **Hosting** | Vercel + Fly.io + Neon (3 metered platforms) | Single Hetzner box + Coolify + Cloudflare + R2 (managed swap-ins optional) | Kills per-invocation/function billing and egress; one predictable bill (~€40–100/mo replaces $300–1000+/mo at scale). |
| **Auth** | Clerk / Auth0 (per-MAU) | **Better Auth** (self-hosted, TS-native orgs/RBAC) — Keycloak/Authentik optional for enterprise SSO | Removes per-seat/MAU pricing entirely. |
| **Queue** | Redis + BullMQ (extra service) | **Postgres-backed queue** (River in Rust plane, graphile-worker in TS) — Redis optional for cache only | One fewer stateful service to run, secure, and pay for; transactional-with-DB. |
| **Vision classification** | Implied third-party vision API | **Local vision model** (self-hosted) as default | No per-image API fees on a media-heavy workload; also a privacy win (A/security). |
| **Media plane** | Node ffmpeg wrappers | **Rust media plane** | Lower RAM per worker → smaller/cheaper instances, more throughput per core. |
| **CDN** | Vercel edge | Cloudflare (generous free tier) in front of R2 | Free/cheap caching + WAF. |

Full model in `appendices/A1-cost-model.md`.

## C. Speed improvements

- **Rust hot-path plane** for transcode/watermark/clip/scrape/egress-bind — multiples faster and lower-latency than Node equivalents.
- **Postgres-backed queue** avoids Redis round-trips for transactional publish jobs and keeps job state co-located with domain data.
- **Cloudflare caching + ISR** for link-in-bio pages and dashboards.
- **TOKENKILLER** formalized so >97% of LLM prompt tokens are cache-served.
- **pgvector** retrieval keeps the viral-loop lookups in-database (no extra vector service).

## D. Security hardening

- **Envelope encryption** for all social tokens & proxy credentials: per-org DEKs wrapped by a root key (age/SOPS self-hosted or cloud KMS); app-layer XChaCha20-Poly1305 AEAD, decrypted only in worker memory at execution time.
- **Fail-closed egress**: if a model's proxy/WireGuard tunnel is unhealthy, the job **fails closed** (never falls back to the host IP), enforced by a Linux network-namespace guard in the Rust plane. Prevents cross-account IP leakage.
- **Hash-chained, append-only audit log** (tamper-evident).
- **Signed, replay-protected Relay commands** (HMAC + nonce + short TTL) so a publish action can't be forged from a leaked chat.
- **Capability-scoped, short-lived MCP tokens** per agent per model, with a global kill switch and rate limits.
- **RLS + app-layer tenant guards** (defense in depth); every connection sets `app.current_org`.
- **Idempotency keys** on every publish to prevent double-posting on retries.
- **Consent & Records Vault** (encrypted) for model-release / age-verification record-keeping appropriate to adult content operations.

## E. Correctness & robustness

- **Per-platform token-bucket rate limiters** honoring each API's documented limits with backoff + jitter and a shared rate ledger.
- **Dead-letter queues + replay** for every job type.
- **Idempotent publishing** end to end.
- **Explicit capability matrix** so unsupported platform actions degrade gracefully to link-share or manual-assist rather than failing silently.
- **Marker-gated greenfield** deploy scripts (SKIP vs FAIL, append-only ledgers, loud pre-workspace guards).

## F. Retained from v1 unchanged in intent (feature-preserving)

Model segregation & per-model workspaces; Fanvue MCP client (uploads/posting/analytics/inbox); ToS Risk Engine; per-model network isolation; Pre-Post Script hook; high-value fan CRM; content pipeline & visual calendar; cross-platform cascading; global kill switch; asset versioning & dynamic watermarking; A/B testing; social listening & competitor intel; trigger rules; deep-link/attribution; RBAC & team collaboration; automated reporting; content repurposing engine; LLM gateway with cache toggles; photoshoot auto-generator & master prompt engine; private community hubs (Venice/local vLLM); public SFW funnel agent; CRM-as-MCP-server & agent permission matrix; Fanvue Creator Course Playbook Engine. All are catalogued in `L1-product/L1.1-feature-catalog.md` with their v2 home.
