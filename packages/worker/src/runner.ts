// ─── Runner entry (pnpm dev / systemd) ───
// Starts the queue worker loop. Env: WORKER_ID, WORKER_POLL_INTERVAL_MS,
// WORKER_MAX_ATTEMPTS. Requires DATABASE_URL (via @axiom/db).

import { registerConnectors } from './connectors.js';
import {
  installRuntimeFailureHandlers,
  requireProductionDatabaseUrl,
  requireProductionMediaPlaneConfig,
  resolveRelaySecret,
} from '@axiom/core';
import { runWorker } from './worker.js';

installRuntimeFailureHandlers({
  service: process.env.AXIOM_SERVICE_NAME ?? 'worker',
  process,
  write: (entry) => console.error(JSON.stringify(entry)),
});

// Validate deployment-wide relay configuration before the worker can claim
// any job. Relay executors validate again at the side-effect boundary, but a
// production worker with a weak secret must fail during boot rather than
// appear healthy while processing unrelated queue work.
requireProductionDatabaseUrl(process.env);
requireProductionMediaPlaneConfig(process.env);
resolveRelaySecret(process.env);

// Register the real platform connectors before the loop starts so
// publish.target / metrics.poll can dispatch (fail-closed when no token).
registerConnectors();

const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
const pollIntervalMs = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '1000', 10);
const maxAttempts = process.env.WORKER_MAX_ATTEMPTS
  ? parseInt(process.env.WORKER_MAX_ATTEMPTS, 10)
  : undefined;

runWorker({ workerId, pollIntervalMs, maxAttempts }).catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
