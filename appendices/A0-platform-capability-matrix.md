# Appendix A0 — Platform Capability Matrix (Full Detail)

> Per-platform reference for all 10 socials + Fanvue. This is the authoritative source the connector declarations (`L3.2`) and scheduler read. Where a platform lacks an open API for an action, the matrix says so honestly (LBI-07) and routes through the Relay assisted flow rather than faking success.

## Legend
- **Publish:** `api` (programmatic), `link_share` (post a content link), `assisted` (prepared package, human taps post).
- **Sched:** native (platform schedules) / internal (we schedule + fire).
- **Metrics:** how performance data returns.

## Matrix

| Platform | Publish | Media | Caption limit* | Sched | Metrics | Notes |
|---|---|---|---|---|---|---|
| Instagram | api | image, video, carousel, story, reel | ~2,200 | native | webhook + poll | Graph API; creator/business account; reels = video w/ flag. |
| TikTok | api | video, photo, short | ~2,200 | internal | poll | Content Posting API; audit status before/after. |
| YouTube | api | video, **short** | title 100 / desc 5,000 | native | poll | Short = vertical ≤ 60s flag on upload. |
| X (Twitter) | api | image, video, gif | 280 (free tier) | internal | poll | v2 media upload then post. |
| Facebook | api | image, video, story, reel | ~63,206 | native | webhook + poll | Pages API. |
| Reddit | api | image, video, text, link | title 300 | internal | poll | per-subreddit rule engine; flair support. |
| Threads | api | image, video | ~500 | native | poll | Threads Publishing API. |
| Discord | link_share | image, video, link | 2,000 (msg) | internal | none | bot/webhook posts content link + rich embed. |
| Telegram | link_share | image, video, link | 1,024 (caption) | internal | none | bot posts content link + preview. |
| Snapchat | assisted | image, video, story | n/a | internal | none | no open publish API → Relay hand-off; one-tap post. |
| Fanvue | api (MCP) | image, video | per Fanvue | internal | poll | via Fanvue MCP; Pre-Post Script hook (`L2.10`). |

\* Limits are enforced by the validator (`L3.2 §3`) which truncates + warns on the Relay card; treat as engine defaults, refreshed from platform config at connect-time rather than hard-coded assumptions.

## Publish-mode rationale

- **api (7 platforms + Fanvue):** full automation end-to-end.
- **link_share (Discord, Telegram):** these are distribution/community channels; the idiomatic action is sharing a link to the content (matching the user's "often via sharing content links" note), with a rich preview — not native media hosting.
- **assisted (Snapchat):** no public content-publishing API exists; the honest, working design generates the full package and routes a one-tap Relay card. This satisfies "full support" as a real workflow without pretending an API exists.

## Capability resolution

At connect-time each connection resolves its live capability object and persists it to `platform_connection.capabilities`. The scheduler and Relay renderer read *that* — never a hard-coded assumption — so platform changes are absorbed by re-resolving, not by code forks.
