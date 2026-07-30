import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { modelsRouter } from './routes/models.js';
import { bundlesRouter } from './routes/bundles.js';
import { socialRouter } from './routes/social.js';
import { killswitchRouter } from './routes/killswitch.js';
import { DiscordAdapter, createRelayRoutes, CardRenderer, CommandRouter, ViralLoop, Bandit, IncidentManager, HealthCheckRegistry } from '@axiom/relay';

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
app.route('/api/v1', killswitchRouter);

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
