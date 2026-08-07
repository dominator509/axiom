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
import { registerConnectors } from '@axiom/worker';
import { createMcpServer } from '@axiom/mcp-server';
import { DiscordAdapter, ThreadsAdapter, createRelayRoutes, CardRenderer, CommandRouter, ViralLoop, Bandit, IncidentManager, HealthCheckRegistry, type CardAction } from '@axiom/relay';
import { relayViralPersistence } from './relay-viral.js';
import { relayIncidentPageHandler } from './relay-incidents.js';
import { correlationId, onError, idempotency, rateLimit } from './contract.js';
import { schema } from '@axiom/db';
import { sql, eq } from 'drizzle-orm';
import { withOrgContext, writeAudit } from './routes/helpers.js';

/**
 * Executes a verified relay command against real domain state (H-3).
 * The relay package stays persistence-free; this injection lives here because
 * the API process owns @axiom/db. Org context is resolved from the card row
 * (signed commands carry no session — the HMAC is the auth, LBI-04/F-70).
 */
async function relayCommandExecutor(
  action: CardAction,
  cardId: string,
  params: Record<string, unknown>,
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
    let note: string | undefined;

    // Transition the bundle state per action (mirrors bundles.ts state machine).
    if (bundleId) {
      const bundle = await tx
        .select({ id: schema.contentBundle.id })
        .from(schema.contentBundle)
        .where(eq(schema.contentBundle.id, bundleId))
        .limit(1);
      if (bundle.length === 0) throw new Error(`relay command: bundle ${bundleId} not found`);

      const stateByAction: Partial<Record<CardAction, string>> = {
        approve: 'approved',
        approve_all: 'approved',
        reject: 'rejected',
        hold: 'hold',
        revise: 'generated',
        regenerate: 'generated',
      };
      const nextState = stateByAction[action];
      if (nextState) {
        await tx
          .update(schema.contentBundle)
          .set({ state: nextState, updatedAt: new Date() })
          .where(eq(schema.contentBundle.id, bundleId));
        note = `bundle ${bundleId} → ${nextState}`;
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

const app = new Hono<AppBindings>();

app.use('*', cors());
app.use('*', logger());
app.use('*', secureHeaders());
// L3.0 contract: correlation_id on every request, then per-token rate limits.
app.use('*', correlationId);
app.use('/api/v1/*', rateLimit());
app.onError(onError);

// Health check
app.get('/api/v1/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

// Build-time OpenAPI document (L3.0) — served as a live endpoint.
// Generated by gen-openapi.ts on `pnpm build`; the file lives in dist/ next
// to the compiled server (not in src, so it cannot go stale vs the build).
app.get('/api/v1/openapi.json', (c) => {
  const specUrl = new URL('./openapi.json', import.meta.url);
  return c.json(existsSync(specUrl)
    ? JSON.parse(readFileSync(specUrl, 'utf8'))
    : { openapi: '3.0.3', info: { title: 'AXIOM FanvueCRM API', version: '0.1.0' }, paths: {} });
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
// Relay viral ingest/exemplars are DB-backed (M-7) — require a session so
// orgId comes from the auth context, never from the request body.
app.use('/api/v1/viral/ingest', requireAuth);
app.use('/api/v1/viral/exemplars', requireAuth);

// L3.0: mutations that touch the outside world require Idempotency-Key
// (generate, approve/revise/reject, schedule, connect, fanvue OAuth).
app.use('/api/v1/models/:modelId/generate', idempotency());
app.use('/api/v1/models/:modelId/generate/*', idempotency());
app.use('/api/v1/bundles/*/approve', idempotency());
app.use('/api/v1/bundles/*/revise', idempotency());
app.use('/api/v1/bundles/*/reject', idempotency());
app.use('/api/v1/posts', idempotency());
app.use('/api/v1/social-accounts', idempotency());

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
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
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

export async function initRelay(): Promise<Hono> {
  const cardRenderer = new CardRenderer();
  const commandRouter = new CommandRouter(
    process.env.RELAY_SECRET || 'axiom-dev-secret',
    5,
    relayCommandExecutor,
  );
  const viralLoop = new ViralLoop();
  const bandit = new Bandit();
  const incidentManager = new IncidentManager();
  // F-78 (L2.9): sev-1 / crash-loop incidents auto-page into the Relay —
  // the page handler writes a durable, org-scoped relay card + audit entry.
  incidentManager.setPageHandler(relayIncidentPageHandler);
  const healthRegistry = new HealthCheckRegistry();

  // Initialize Discord adapter if token configured
  const discordToken = process.env.DISCORD_BOT_TOKEN;
  const discordClientId = process.env.DISCORD_APPLICATION_ID;
  if (discordToken && discordClientId) {
    const discord = new DiscordAdapter({ token: discordToken, clientId: discordClientId });
    discord.login().catch(err => console.error('Discord login failed:', err.message));
    console.log('Discord adapter initialized');
  }

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
  const threadsVerifyToken = process.env.THREADS_WEBHOOK_VERIFY_TOKEN || 'axiom-threads-verify';
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

// Initialize relay on module load (non-blocking)
initRelay().then((relay) => {
  app.route('/', relay);
  console.log('Relay routes mounted');
}).catch(err => {
  console.error('Relay initialization failed:', err.message);
});

export default app;

export type AppType = typeof app;
