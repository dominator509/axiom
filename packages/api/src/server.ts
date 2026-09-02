import { serve } from '@hono/node-server';
import app, { initializeRuntime } from './index.js';

const PORT = parseInt(process.env.API_PORT || '3001', 10);
// Keep local development loopback-only by default. Container deployments set
// API_HOST=0.0.0.0 so the published container port is reachable from the
// reverse proxy or orchestrator network.
const HOST = process.env.API_HOST || '127.0.0.1';

// Fail startup when a configured external adapter cannot authenticate. Serving
// while silently disconnected would make health checks report a false green.
await initializeRuntime();

serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => console.log(`AXIOM API running on ${HOST}:${info.port}`),
);
