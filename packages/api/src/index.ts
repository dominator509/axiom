import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { readFileSync, existsSync } from 'node:fs';
import { modelsRouter } from './routes/models.js';
import { bundlesRouter } from './routes/bundles.js';
import { socialRouter } from './routes/social.js';
import { killswitchRouter } from './routes/killswitch.js';
import { egressRouter } from './routes/egress.js';
import { networkRouter } from './routes/network.js';
import { postsRouter } from './routes/posts.js';
import { linkbioRouter } from './routes/linkbio.js';
import { fansRouter } from './routes/fans.js';
import { analyticsRouter } from './routes/analytics.js';
import { viralRouter } from './routes/viral.js';
import { playbookRouter } from './routes/playbook.js';
import { generateRouter } from './routes/generate.js';
import { auditRouter } from './routes/audit.js';
import { incidentsRouter } from './routes/incidents.js';
import { digestsRouter } from './routes/digests.js';
import { crashReportsRouter } from './routes/crash-reports.js';
import { orgSettingsRouter } from './routes/org-settings.js';
import { fanvueAuthRouter } from './routes/fanvue-auth.js';
import { threadsAuthRouter } from './routes/threads-auth.js';
import { auth, requireAuth } from '@axiom/auth';
import { LLMGateway, createLLMRouter } from '@axiom/llm-gateway';
import { asPlatform, enqueueJob, registerConnectors, resolveCapabilities } from '@axiom/worker';
import { createMcpServer } from '@axiom/mcp-server';
import {
  TelegramAdapter,
  DiscordAdapter,
  ThreadsAdapter,
  createRelayRoutes,
  CardRenderer,
  CommandRouter,
  ViralLoop,
  Bandit,
  IncidentManager,
  HealthCheckRegistry,
  CARD_ACTIONS,
  type CommandContext,
  type CardAction,
} from '@axiom/relay';
import { relayViralPersistence } from './relay-viral.js';
import { relayIncidentPageHandler } from './relay-incidents.js';
import { correlationId, onError, idempotency, rateLimit } from './contract.js';
import { checkDatabase, schema } from '@axiom/db';
import { sql, eq, and } from 'drizzle-orm';
import { withOrgContext, writeAudit } from './routes/helpers.js';

/**
 * Executes a verified relay command against real domain state (H-3).
 * The relay package stays persistence-free; this injection lives here because
 * the API process owns @axiom/db. Org context is resolved from the card row
 * (HTTP signed commands carry no session; provider callbacks additionally
 * carry a channel identity that must match the persisted card binding).
 */
async function relayCommandExecutor(
  action: CardAction,
  cardId: string,
  params: Record<string, unknown>,
  context?: CommandContext,
): Promise<string | void> {
  const card = await withOrgContext('00000000-0000-0000-0000-000000000000', async (tx) => {
    // Resolve the card via SECURITY DEFINER resolver (migration 0006) — the
    // signed command carries no session, so the card's org is unknown until
    // here; RLS FORCE would block a plain cross-org SELECT (LBI-02).
    const rows = await tx.execute(sql`SELECT * FROM resolve_relay_card(${cardId})`);
    const res = (rows?.rows ?? []) as Array<{ org_id: string; bundle_id: string | null }>;
    return res[0] ?? null;
  });
  if (!card) throw new Error(`relay command: card ${cardId} not found`);
  const orgId = card.org_id as string;
  const bundleId = card.bundle_id as string | null;

  return withOrgContext(orgId, async (tx) => {
    const relayCards = await tx
      .select({ channel: schema.relayCard.channel, externalRef: schema.relayCard.externalRef })
      .from(schema.relayCard)
      .where(and(eq(schema.relayCard.id, cardId), eq(schema.relayCard.orgId, orgId)))
      .limit(1);
    const relayCard = relayCards[0];
    if (!relayCard) throw new Error(`relay command: card ${cardId} not found`);
    if (
      context &&
      (context.channel !== relayCard.channel || context.sourceId !== relayCard.externalRef)
    ) {
      throw new Error('relay command: source is not bound to this relay card');
    }

    let note: string | undefined;

    // Transition the bundle state per action (mirrors bundles.ts state machine).
    if (bundleId) {
      const bundle = await tx
        .select()
        .from(schema.contentBundle)
        .where(and(eq(schema.contentBundle.id, bundleId), eq(schema.contentBundle.orgId, orgId)))
        .limit(1);
      if (bundle.length === 0) throw new Error(`relay command: bundle ${bundleId} not found`);

      const currentState = bundle[0].state as string;
      if (action === 'approve' || action === 'approve_all') {
        if (currentState !== 'generated' && currentState !== 'hold') {
          throw new Error(
            `relay command: bundle is already ${currentState}; only generated or held bundles can be approved`,
          );
        }

        const tos = (bundle[0].tosReport ?? {}) as {
          verdict?: string;
          scores?: Array<{ platform: string; verdict: string }>;
        };
        if (tos.verdict === 'block') {
          throw new Error('relay command: ToS block prevents approval');
        }

        const captions = (bundle[0].captions as Record<string, string> | null) ?? {};
        const requestedPlatforms =
          Object.keys(captions).length > 0 ? Object.keys(captions) : ['instagram'];
        const platforms = requestedPlatforms.map((value) => {
          try {
            return asPlatform(value);
          } catch {
            throw new Error(`relay command: unsupported target platform '${value}'`);
          }
        });
        for (const platform of platforms) {
          const score = (tos.scores ?? []).find((item) => item.platform === platform);
          if (score?.verdict === 'block') {
            throw new Error(`relay command: ToS block on ${platform} prevents approval`);
          }
        }
        if (!bundle[0].assetId) {
          for (const platform of platforms) {
            try {
              if (resolveCapabilities(platform).media.includes('text')) continue;
            } catch {
              throw new Error(
                `relay command: cannot resolve ${platform} capabilities; media requirement is unknown`,
              );
            }
            throw new Error(
              `relay command: bundle has no media asset; ${platform} requires media before approval`,
            );
          }
        }

        const rawSlot =
          typeof params.slot === 'string'
            ? params.slot
            : typeof params.scheduledFor === 'string'
              ? params.scheduledFor
              : undefined;
        const slot = rawSlot ? new Date(rawSlot) : new Date(Date.now() + 3600_000);
        if (Number.isNaN(slot.getTime()) || slot.getTime() <= Date.now()) {
          throw new Error('relay command: approval slot must be a valid future timestamp');
        }

        const transitioned = await tx
          .update(schema.contentBundle)
          .set({ state: 'approved', updatedAt: new Date() })
          .where(
            and(
              eq(schema.contentBundle.id, bundleId),
              eq(schema.contentBundle.orgId, orgId),
              eq(schema.contentBundle.state, currentState),
            ),
          )
          .returning({ id: schema.contentBundle.id });
        if (transitioned.length === 0) {
          throw new Error('relay command: bundle changed while approval was being applied');
        }

        for (const platform of platforms) {
          const [target] = await tx
            .insert(schema.postTarget)
            .values({
              orgId,
              bundleId,
              platform,
              scheduledFor: slot,
              state: 'pending',
              remoteId: null,
              error: null,
              idemKey: Buffer.from(`${bundleId}|${platform}|${slot.toISOString()}`),
            })
            .returning({ id: schema.postTarget.id });
          if (!target?.id) throw new Error('relay command: target insert returned no id');
          await enqueueJob(tx, {
            orgId,
            queue: 'publish',
            kind: 'publish.target',
            payload: { targetId: target.id },
            runAfter: slot,
            dedupeParts: ['publish.target', target.id],
          });
        }

        note = `bundle ${bundleId} → approved (${platforms.join(', ')})`;
      } else {
        const stateByAction: Partial<Record<CardAction, string>> = {
          reject: 'rejected',
          hold: 'hold',
          revise: 'generated',
          regenerate: 'generated',
        };
        const nextState = stateByAction[action];
        if (nextState && currentState !== 'generated' && currentState !== 'hold') {
          throw new Error(
            `relay command: bundle is already ${currentState}; action '${action}' requires a generated or held bundle`,
          );
        }
        if (nextState) {
          const transitioned = await tx
            .update(schema.contentBundle)
            .set({ state: nextState, updatedAt: new Date() })
            .where(
              and(
                eq(schema.contentBundle.id, bundleId),
                eq(schema.contentBundle.orgId, orgId),
                eq(schema.contentBundle.state, currentState),
              ),
            )
            .returning({ id: schema.contentBundle.id });
          if (transitioned.length === 0) {
            throw new Error(`relay command: bundle changed while '${action}' was being applied`);
          }
          note = `bundle ${bundleId} → ${nextState}`;
        }
      }
    }

    // Persist the command (relay_command row) for auditability (L2.7).
    await tx.insert(schema.relayCommand).values({
      orgId,
      cardId,
      trigger: 'relay',
      action,
      params,
      enabled: true,
    });

    // Append to the hash-chained audit log (LBI-08).
    await writeAudit(tx, orgId, 'relay', `relay.command.${action}`, cardId, {
      action,
      params,
      note,
    });

    return note;
  });
}

// Register the real platform connectors into the shared registry so API-side
// connector lookups (social-accounts capabilities, validate-for-platform, etc.)
// work in this process. Idempotent; the worker process registers the same set.
registerConnectors();
console.log('Connectors registered (API process)');

export type AppBindings = {
  Variables: {
    userId: string;
    orgId: string;
  };
};

let relayCommandRouter: CommandRouter | undefined;

function getRelayCommandRouter(): CommandRouter {
  if (!relayCommandRouter) {
    const relaySecret = process.env.RELAY_SECRET;
    if (process.env.NODE_ENV === 'production' && !relaySecret) {
      throw new Error('RELAY_SECRET is required in production');
    }
    relayCommandRouter = new CommandRouter(
      relaySecret || 'axiom-dev-secret',
      5,
      relayCommandExecutor,
    );
  }
  return relayCommandRouter;
}

const app = new Hono<AppBindings>();

// Browser clients are credentialed, so never reflect arbitrary origins.
// BETTER_AUTH_URL is the canonical application origin used by the dashboard;
// non-browser clients (mobile/agents) do not send an Origin header.
app.use(
  '*',
  cors({
    origin: process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3001',
    credentials: true,
  }),
);
app.use('*', logger());
app.use('*', secureHeaders());
// L3.0 contract: correlation_id on every request, then per-token rate limits.
app.use('*', correlationId);
app.use('/api/v1/*', rateLimit());
app.onError(onError);

// Health check
app.get('/api/v1/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));
app.get('/api/v1/ready', async (c) => {
  try {
    await checkDatabase();
    return c.json({ status: 'ok', dependencies: { postgres: 'ok' } });
  } catch {
    return c.json({ status: 'unavailable', dependencies: { postgres: 'unavailable' } }, 503);
  }
});

// Build-time OpenAPI document (L3.0) — served as a live endpoint.
// Generated by gen-openapi.ts on `pnpm build`; the file lives in dist/ next
// to the compiled server (not in src, so it cannot go stale vs the build).
app.get('/api/v1/openapi.json', (c) => {
  const specUrl = new URL('./openapi.json', import.meta.url);
  return c.json(
    existsSync(specUrl)
      ? JSON.parse(readFileSync(specUrl, 'utf8'))
      : { openapi: '3.0.3', info: { title: 'AXIOM FanvueCRM API', version: '0.1.0' }, paths: {} },
  );
});

// ── Better Auth — mounted at /api/auth/* (replaces the 501 placeholder) ──
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
console.log('Better Auth mounted at /api/auth/*');

// ── Mount dashboard + CRM routes ──
// Every route group behind requireAuth: session → userId/orgId injected,
// orgId then scopes all RLS transactions (LBI-02).
app.use('/api/v1/models/*', requireAuth);
app.use('/api/v1/bundles/*', requireAuth);
app.use('/api/v1/social-accounts/*', requireAuth);
app.use('/api/v1/egress/*', requireAuth);
app.use('/api/v1/models/:modelId/network/*', requireAuth);
app.use('/api/v1/posts/*', requireAuth);
app.use('/api/v1/models/:modelId/calendar/*', requireAuth);
app.use('/api/v1/models/:modelId/linkbio/*', requireAuth);
app.use('/api/v1/linkbio/*', requireAuth);
app.use('/api/v1/models/:modelId/fans/*', requireAuth);
app.use('/api/v1/fans/*', requireAuth);
app.use('/api/v1/custom-requests/*', requireAuth);
app.use('/api/v1/models/:modelId/custom-requests/*', requireAuth);
app.use('/api/v1/models/:modelId/analytics/*', requireAuth);
app.use('/api/v1/models/:modelId/viral/*', requireAuth);
app.use('/api/v1/models/:modelId/playbook-score/*', requireAuth);
app.use('/api/v1/models/:modelId/generate/*', requireAuth);
app.use('/api/v1/audit/*', requireAuth);
app.use('/api/v1/incidents/*', requireAuth);
app.use('/api/v1/killswitch/*', requireAuth);
app.use('/api/v1/kill-switch/*', requireAuth);
app.use('/api/v1/digests/*', requireAuth);
app.use('/api/v1/crash-reports/*', requireAuth);
app.use('/api/v1/org-settings/*', requireAuth);
// LLM requests can spend provider credits and reveal provider/runtime state.
app.use('/api/v1/llm/*', requireAuth);
// OAuth initiation and token refresh are session-authenticated. The sealed
// callback state carries the org/model target, so public provider callbacks
// cannot attach credentials to another tenant or a deployment-wide .env file.
app.use('/api/v1/connectors/fanvue/authorize', requireAuth);
app.use('/api/v1/connectors/fanvue/refresh', requireAuth);
app.use('/api/v1/connectors/threads/authorize', requireAuth);
// Card rendering is an operator surface. Signed relay commands, provider
// webhooks, metrics, and health probes retain their protocol-specific access.
app.use('/api/v1/relay/card', requireAuth);
// Relay viral ingest/exemplars are DB-backed (M-7) — require a session so
// orgId comes from the auth context, never from the request body.
app.use('/api/v1/viral/ingest', requireAuth);
app.use('/api/v1/viral/exemplars', requireAuth);

// L3.0: mutations that touch the outside world require Idempotency-Key
// (generate, approve/revise/reject, schedule, connect, incident replay,
// kill switch, fanvue OAuth).
app.use('/api/v1/models/:modelId/generate', idempotency());
app.use('/api/v1/models/:modelId/generate/*', idempotency());
app.use('/api/v1/bundles/*/approve', idempotency());
app.use('/api/v1/bundles/*/revise', idempotency());
app.use('/api/v1/bundles/*/reject', idempotency());
// DLQ replay resets a durable job and requeues its side effect. Protect the
// dashboard retry action with the same durable key/replay contract.
app.use('/api/v1/incidents/:jobId/replay', idempotency());
app.use('/api/v1/killswitch/enable', idempotency());
app.use('/api/v1/killswitch/disable', idempotency());
app.use('/api/v1/kill-switch', idempotency());
app.use('/api/v1/models', idempotency());
app.use('/api/v1/models/:modelId/network', idempotency());
app.use('/api/v1/org-settings', idempotency());
app.use('/api/v1/digests/generate', idempotency());
app.use('/api/v1/crash-reports', idempotency());
app.use('/api/v1/crash-reports/*', idempotency());
app.use('/api/v1/posts', idempotency());
app.use('/api/v1/social-accounts', idempotency());
app.use('/api/v1/connectors/fanvue/refresh', idempotency());

app.route('/api/v1/models', modelsRouter);
app.route('/api/v1/bundles', bundlesRouter);
app.route('/api/v1/social-accounts', socialRouter);
app.route('/api/v1/connectors/fanvue', fanvueAuthRouter);
app.route('/api/v1/connectors/threads', threadsAuthRouter);
app.route('/api/v1', killswitchRouter);
app.route('/api/v1/egress', egressRouter);
app.route('/api/v1', networkRouter);
app.route('/api/v1', postsRouter);
app.route('/api/v1', linkbioRouter);
app.route('/api/v1', fansRouter);
app.route('/api/v1', analyticsRouter);
app.route('/api/v1', viralRouter);
app.route('/api/v1', playbookRouter);
app.route('/api/v1', generateRouter);
app.route('/api/v1', auditRouter);
app.route('/api/v1', incidentsRouter);
app.route('/api/v1', digestsRouter);
app.route('/api/v1', crashReportsRouter);
app.route('/api/v1', orgSettingsRouter);

// LLM gateway — unified multi-provider chat completions
const llmGateway = new LLMGateway();
app.route('/api/v1/llm', createLLMRouter(llmGateway));

// ── CRM MCP endpoint (F-45 / L2.11) ────────────────────────────────────────
// Agents invoke MCP tools with a capability token (Bearer). Each request is
// authenticated into a tier-scoped McpServer instance; tools execute real DB
// work in the model's org context (H-2).
app.post('/api/mcp', async (c) => {
  const headers: Record<string, string> = {};
  const authHeader = c.req.header('authorization');
  if (authHeader) headers.authorization = authHeader;
  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body → params fallback only
  }
  try {
    const server = createMcpServer({ headers, params: body as Record<string, unknown> });
    const response = await server.handleRequest(body as never);
    return c.json(response);
  } catch (err) {
    return c.json(
      { jsonrpc: '2.0', error: { code: -32000, message: 'Authentication failed' }, id: null },
      401,
    );
  }
});
app.get('/api/mcp', async (c) => {
  // GET is not part of the JSON-RPC transport; used only as a liveness probe.
  return c.json({ jsonrpc: '2.0', result: { status: 'mcp endpoint ready' }, id: null });
});
console.log('LLM gateway routes mounted');

// ── Relay initialization ──────────────────────────────────────

export function createRelayApp(): Hono {
  const cardRenderer = new CardRenderer();
  const commandRouter = getRelayCommandRouter();
  const viralLoop = new ViralLoop();
  const bandit = new Bandit();
  const incidentManager = new IncidentManager();
  // F-78 (L2.9): sev-1 / crash-loop incidents auto-page into the Relay —
  // the page handler writes a durable, org-scoped relay card + audit entry.
  incidentManager.setPageHandler(relayIncidentPageHandler);
  const healthRegistry = new HealthCheckRegistry();

  const relay = createRelayRoutes({
    cardRenderer,
    commandRouter,
    viralLoop,
    bandit,
    incidentManager,
    healthRegistry,
    viralPersistence: relayViralPersistence,
  });

  // Initialize Threads adapter if client ID configured
  const threadsClientId = process.env.THREADS_CLIENT_ID;
  const threadsClientSecret = process.env.THREADS_CLIENT_SECRET;
  const configuredThreadsVerifyToken = process.env.THREADS_WEBHOOK_VERIFY_TOKEN;
  if (
    process.env.NODE_ENV === 'production' &&
    threadsClientId &&
    threadsClientSecret &&
    !configuredThreadsVerifyToken
  ) {
    throw new Error('THREADS_WEBHOOK_VERIFY_TOKEN is required when Threads is enabled');
  }
  const threadsVerifyToken = configuredThreadsVerifyToken || 'axiom-threads-verify';
  if (threadsClientId && threadsClientSecret) {
    const threads = new ThreadsAdapter({
      clientId: threadsClientId,
      clientSecret: threadsClientSecret,
      verifyToken: threadsVerifyToken,
    });

    // Mount Threads webhook handler on the relay Hono app
    relay.get('/webhooks/threads', (c) => {
      const query = c.req.query();
      const result = threads.handleVerification(query as Record<string, string | undefined>);
      return c.body(result.body, result.status as 200 | 403);
    });

    relay.post('/webhooks/threads', async (c) => {
      const rawBody = await c.req.text();
      const payload = JSON.parse(rawBody);
      const signature = c.req.header('X-Hub-Signature-256') || undefined;
      const result = await threads.handleWebhook(payload, rawBody, signature);
      return c.body(result.body, result.status as 200 | 400 | 403);
    });

    console.log('Threads adapter initialized');
  }

  return relay;
}

// Route construction is deliberately synchronous and network-free so tests,
// OpenAPI generation, and production startup all see the same route table.
app.route('/', createRelayApp());

/** Start adapters that perform external I/O. Called only by the server entrypoint. */
export async function initializeRuntime(): Promise<void> {
  const commandRouter = getRelayCommandRouter();
  const registerRelayHandlers = (
    adapter: TelegramAdapter | DiscordAdapter,
    channel: 'telegram' | 'discord',
  ): void => {
    for (const action of CARD_ACTIONS) {
      adapter.onCommand(action, async (receivedAction, cardId, context) => {
        if (!context || context.channel !== channel || !context.sourceId) {
          throw new Error('relay command: missing or invalid provider source');
        }
        const result = await commandRouter.processCommand(cardId, receivedAction, {}, context);
        if (!result.success) {
          throw new Error(result.error ?? 'relay command failed');
        }
      });
    }
  };

  const discordToken = process.env.DISCORD_BOT_TOKEN;
  const discordClientId = process.env.DISCORD_APPLICATION_ID;
  if (discordToken && discordClientId) {
    const discord = new DiscordAdapter(
      { token: discordToken, clientId: discordClientId },
      commandRouter,
    );
    registerRelayHandlers(discord, 'discord');
    discord.registerInteractionHandler();
    await discord.login();
    console.log('Discord adapter initialized');
  }

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    const telegramWebhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    const telegram = new TelegramAdapter(
      { token: telegramToken, webhookUrl: telegramWebhookUrl },
      commandRouter,
    );
    registerRelayHandlers(telegram, 'telegram');
    if (telegramWebhookUrl) {
      await telegram.setWebhook(telegramWebhookUrl);
    } else {
      await telegram.startPolling();
    }
    console.log('Telegram adapter initialized');
  }
}

export default app;

export type AppType = typeof app;
