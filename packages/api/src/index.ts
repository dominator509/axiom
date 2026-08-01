import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { modelsRouter } from './routes/models.js';
import { bundlesRouter } from './routes/bundles.js';
import { socialRouter } from './routes/social.js';
import { killswitchRouter } from './routes/killswitch.js';
import { fanvueAuthRouter } from './routes/fanvue-auth.js';
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

// Mount routes
app.route('/api/v1/models', modelsRouter);
app.route('/api/v1/bundles', bundlesRouter);
app.route('/api/v1/social-accounts', socialRouter);
app.route('/api/v1/connectors/fanvue', fanvueAuthRouter);
app.route('/api/v1', killswitchRouter);

// LLM gateway — unified multi-provider chat completions
const llmGateway = new LLMGateway();
app.route('/api/v1/llm', createLLMRouter(llmGateway));
console.log('LLM gateway routes mounted');

// Auth endpoint - placeholder for better-auth handler
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  return c.json({ error: 'auth not configured' }, 501);
});

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
