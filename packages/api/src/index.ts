import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
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
import { fanvueAuthRouter } from './routes/fanvue-auth.js';
import { threadsAuthRouter } from './routes/threads-auth.js';
import { auth, requireAuth } from '@axiom/auth';
import { LLMGateway, createLLMRouter } from '@axiom/llm-gateway';
import { DiscordAdapter, ThreadsAdapter, createRelayRoutes, CardRenderer, CommandRouter, ViralLoop, Bandit, IncidentManager, HealthCheckRegistry } from '@axiom/relay';

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

// Health check
app.get('/api/v1/health', (c) => c.json({ status: 'ok', version: '0.1.0' }));

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

// LLM gateway — unified multi-provider chat completions
const llmGateway = new LLMGateway();
app.route('/api/v1/llm', createLLMRouter(llmGateway));
console.log('LLM gateway routes mounted');

// ── Relay initialization ──────────────────────────────────────

export async function initRelay(): Promise<Hono> {
  const cardRenderer = new CardRenderer();
  const commandRouter = new CommandRouter(process.env.RELAY_SECRET || 'axiom-dev-secret');
  const viralLoop = new ViralLoop();
  const bandit = new Bandit();
  const incidentManager = new IncidentManager();
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
