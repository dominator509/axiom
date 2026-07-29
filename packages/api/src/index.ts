import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { modelsRouter } from './routes/models.js';
import { bundlesRouter } from './routes/bundles.js';
import { socialRouter } from './routes/social.js';
import { killswitchRouter } from './routes/killswitch.js';

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

export default app;

export type AppType = typeof app;
