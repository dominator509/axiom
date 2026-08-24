# User-funded LLM subscriptions

AXIOM's hosted LLM gateway is fail-closed against operator-funded model APIs. It supports only:

- OpenAI through the official Codex CLI and the user's ChatGPT subscription login.
- Anthropic through the official Claude Code CLI and the user's Claude subscription login.
- xAI through the official Grok CLI and the user's Grok subscription login.
- Local vLLM, which makes no provider API call.

DeepSeek, Gemini, Mistral, Lightning AI, and Venice remain visible in the capability matrix but are unavailable. AXIOM must not activate them unless the provider ships an official, automatable subscription-backed transport that does not bill an operator API account.

## HTTP flow

All endpoints are under the authenticated `/api/v1/llm` route group. The authenticated AXIOM user ID—not a request-body value—selects a hashed, isolated credential home.

1. `GET /subscriptions/{provider}` checks connection state without returning credentials.
2. `POST /subscriptions/{provider}/login` starts the provider's official OAuth flow and streams instructions as server-sent events.
3. `DELETE /subscriptions/{provider}` invokes the official logout command.
4. Chat requests specify `openai`, `anthropic`, or `grok`; the gateway invokes the official pinned CLI with that user's profile.

Supported subscription provider names are `openai`, `anthropic`, and `grok`. Login output may contain a short-lived device code or authorization link needed by the authenticated user. It is returned only on the no-store SSE response and is never logged by AXIOM.

## Security and billing invariants

- Provider API-key environment variables are removed before every subscription CLI launch.
- Credential homes are partitioned by a SHA-256 digest of the AXIOM user ID and created with owner-only permissions where the operating system supports them.
- Model tools, MCP servers, web search, workspace writes, and session persistence are disabled for inference transports.
- Subscription generations are not retried, avoiding duplicate allowance consumption.
- Explicit provider requests never fall back to a different remote subscription.
- Every gateway result from these transports reports an operator API cost of zero.
- Provider credentials and local CLI state are ignored by Git.

## Production configuration

The optional `AXIOM_SUBSCRIPTION_HOME` environment variable selects the persistent encrypted volume used for isolated CLI profiles. It defaults to `.axiom-subscriptions` under the service account's home. `AXIOM_LLM_TRANSPORT_TIMEOUT_MS` controls the per-request timeout and defaults to ten minutes.

The service image or host must use Node.js 22 or newer. Dependencies pin the official Codex, Claude Code, and Grok CLI versions; package post-install scripts must be enabled for the Claude and Grok platform binaries.
