import { serve } from '@hono/node-server';
import app, { initializeRuntime } from './index.js';

const PORT = parseInt(process.env.API_PORT || '3001', 10);

// Fail startup when a configured external adapter cannot authenticate. Serving
// while silently disconnected would make health checks report a false green.
await initializeRuntime();

serve(
  // Bind to loopback only — nginx (127.0.0.1) is the sole public entry point.
  // Direct exposure of the API to the internet is a security hole.
  { fetch: app.fetch, port: PORT, hostname: '127.0.0.1' },
  (info) => console.log(`AXIOM API running on 127.0.0.1:${info.port}`),
);
