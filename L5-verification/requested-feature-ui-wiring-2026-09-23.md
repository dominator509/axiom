# Requested Feature UI Wiring Check

Date: 2026-09-23

Scope: user-facing flows F-18, F-20, F-21, F-23, F-38, F-42, F-49, F-50, F-51, F-53, F-79, F-84, F-85, F-86, F-87, F-88, F-89 and F-90.

Source baseline: M1017, `0f5979c4`.

This pass checked that each requested flow has a reachable product surface, that
its controls call the matching model-scoped API or mobile service, and that the
UI exposes confirmation, recovery or unavailable states where the mutation can
have an uncertain result.

## User-facing surfaces

| Feature | Reachable surface and connected flow |
| --- | --- |
| F-18 | Model **Scraping** page → `ScrapeRunManager` → scrape/benchmark API; competitor history exposes ordered observation time and public counts. |
| F-20 | Model **Fans** page → `FanvueChurnRescuePanel` → targeted churn-rescue API; operator-authored offer and confirmed/unknown send states are visible. |
| F-21 | Model **Triggers** page → `CommentModerationPanel` → comment scan and moderation APIs; the next-page control passes the persisted provider cursor for the same connection and post. |
| F-23 | Model **Link-in-bio** page → `LinkbioPostLinkManager` → published-post attribution-link APIs. The page now mounts this manager whenever its post-link data loads, including when the independent native link-in-bio provider is disabled. |
| F-38 | Model **Agents** page → `AgentPermissionManager` → permission-token issue/revoke APIs; the safe OpenClaw setup/doctor instructions are available alongside the controls. |
| F-42 | Model **Network** page → `ProviderOperationsPanel` → private invite settings and selected-comment public SFW reply API. A persisted receipt readback shows queued/sending/sent/failed/unknown/cancelled status after reload and prevents a second submit for a comment with an existing receipt. |
| F-49 | Model **Link-in-bio** page → `LinkbioPanel` → provider add/remove and primary-provider APIs. |
| F-50 | Model **Link-in-bio** page → post attribution-link manager → tracked redirect and click-recording flow. |
| F-51 | Model **Link-in-bio** page → GA4 connection, disconnect and bounded analytics-sync controls. |
| F-53 | Model **Link-in-bio** reporting surface → provider and attribution result reads; report controls show saved analytics rather than local-only success state. |
| F-79 | Model **Analytics** page → provider-observed per-post metric display. |
| F-84 | Model **Analytics** page → tracked-click and attributed Fanvue outcome reporting for linked published posts. |
| F-85 | Model **Analytics** page → generate insight and enable/disable schedule controls; model **Relay** page → stored insight-card history and operator reconciliation controls with distinct stored, pending, sent, failed and unknown states. |
| F-86 | Model **Analytics** page → owner/manager viral-pattern sharing control with server-confirmed state. |
| F-87 | Expo mobile **Consent** screen → authenticated consent metadata and revoke flow. |
| F-88 | Expo mobile **Consent** screen → server-authoritative publish-eligibility readout for supported platforms. |
| F-89 | Shared locale selector and catalog → all six supported catalogs (`en`, `es`, `ja`, `it`, `pt-BR`, `de`); added receipt/retry strings are present in the typed required-key set. |
| F-90 | Workspace **Affiliate** page → `PlatformAffiliateManager` → partner, campaign, hold and reporting APIs. If a request outcome is uncertain, the explicit retry reuses the saved method, path, body and idempotency key; a confirmed mutation stays confirmed even when its subsequent readback fails. |

## Gaps fixed in this follow-up

- F-23's post-link manager was hidden whenever the native provider was off,
  despite the post-link APIs working independently. It now follows loaded
  post-link data, and the page test covers provider-disabled mounting.
- F-42 previously kept reply receipts only in component state. The API now
  provides an authorized, model/connection/post-scoped receipt readback; the UI
  restores the persisted status and does not re-offer a known completed or
  uncertain submission. Response data omits internal job errors.
- F-90 described same-action retry while generating a new idempotency key on
  every attempt. It now retains and retries the exact original intent, blocks
  conflicting mutations until resolution, and separates confirmed mutation
  success from a failed follow-up refresh.

## Verification

- Focused API tests: 55 passed across public SFW replies and link-in-bio routes.
- Focused dashboard tests: 22 passed across affiliate retry, public SFW receipt
  rendering, and post-link page mounting.
- Core locale suite: 148 passed; workspace TypeScript typecheck passed.
- `node scripts/test-isolated-workspace.mjs --isolated-fixture` via RTK: exit 0,
  all 24 workspace tasks successful. API 1,323/1,323, dashboard 1,066/1,066,
  worker 352/352, LLM gateway 408/408, MCP server 93/93, mobile 32/32,
  connectors 469/469, Relay 274/274; database 175 passed and 5 readiness cases
  skipped. Dashboard production build, API/OpenAPI build and mobile web export
  passed. The run applied 78 migrations to its disposable fixture, removed that
  fixture, and left the recovered database untouched.
- `sh scripts/verify.sh` via RTK: exit 0 (`verify: ok`).
- `git diff --check`: exit 0.

These checks cover the local API, UI component/page, database integration and
build paths. No live provider, deployed service or external account was used.
