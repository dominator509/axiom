# Appendix A1 — Cost Model

> Why AXIOM is materially cheaper to host than v1, with a defensible monthly band. Figures are planning estimates (order-of-magnitude, region-dependent), not quotes; the acceptance gate (`L5.2`) checks live telemetry against this band.

## v1 baseline (metered PaaS triad)

v1 ran on Vercel + Fly + Neon plus Redis, Clerk/Auth0, and per-seat/metered add-ons. Characteristic costs: per-seat auth, per-GB egress, per-compute-hour functions, managed Redis, managed Postgres branching. At modest scale this typically lands in the **$300–1,000+/mo** range and scales with usage in several dimensions at once (functions, bandwidth, auth seats, Redis).

## AXIOM (single box + Cloudflare + R2)

| Component | Choice | Est. monthly |
|---|---|---|
| Compute | 1 Hetzner dedicated/VPS (CPU + optional GPU for vision) | €40–90 |
| PaaS layer | Coolify (self-hosted, FOSS) | €0 |
| Ingress/CDN/WAF | Cloudflare (Tunnel + cache) | €0–20 |
| Object storage | Cloudflare R2 (**no egress fees**) | €5–15 |
| Auth | Better Auth (self-hosted) | €0 |
| Queue | Postgres (pgmq/River) — no Redis | €0 |
| Crash/observability | GlitchTip + Prometheus/Grafana (self-host) | €0 |
| **Total** | | **≈ €45–125/mo** |

LLM/model inference is usage-based and separate in both designs; AXIOM reduces it via TOKENKILLER prefix caching (> 97% hit) and a local-vision ToS engine (no per-image API fees), so the *controllable* infra line is the table above.

## Where the savings come from

- **No metered function/bandwidth sprawl:** one box, flat cost; R2 has no egress fees (a major v1 line item).
- **No managed Redis:** Postgres-backed queue removes a whole priced service.
- **Self-hosted auth:** removes per-seat auth pricing.
- **Local vision for ToS:** removes per-image moderation API spend and keeps media private.
- **Prefix-cache discipline:** cuts LLM token spend on the largest, most repetitive part of each prompt.

## Scaling posture

Vertical-first: a bigger single box covers substantial growth before any horizontal split. If/when needed, the plane model (`L2.0`) allows peeling the Rust egress/vision plane or Postgres onto their own hosts without a rewrite — cost grows in deliberate steps, not continuously across five metered dimensions.

## Net

AXIOM targets **roughly an order of magnitude lower** fixed infra cost than v1 at comparable scale, with the largest variable cost (LLM tokens) actively suppressed by design.
