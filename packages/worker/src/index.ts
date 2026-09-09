// ─── @axiom/worker — queue runtime entry ───

export { backoffDelayMs, describeDelay } from './backoff.js';
export type { BackoffOptions } from './backoff.js';
export { publishIdemKey, minuteSlot, jobDedupeKey } from './idempotency.js';
export type { PublishKeyInput } from './idempotency.js';
export { enqueueJob } from './enqueue.js';
export type { EnqueueJobInput } from './enqueue.js';
export { embedFeatures } from './embedding.js';
export { claimNextJob } from './claim.js';
export type { ClaimResult } from './claim.js';
export { defaultExecutors } from './executors/index.js';
export {
  METRICS_POLL_INTERVAL_MS,
  metricsPollDedupeParts,
  nextMetricsPollAt,
} from './executors/metrics.js';
export type { Executor, ExecutorContext } from './executors/context.js';
export { ParkJobError, EXTERNAL_SIDE_EFFECT_UNKNOWN_PREFIX } from './executors/context.js';
export { labelForZ, latestMetricSamples, scoreTargetEngagement } from './executors/viral.js';
export type {
  TimestampedViralMetricSample,
  ViralMetricSample,
  ViralScore,
} from './executors/viral.js';
export { retrieveTopExemplars } from './viral-retrieval.js';
export { runWorker, workerTick, processJob, readKillSwitch } from './worker.js';
export type { WorkerOptions, WorkerStats } from './worker.js';
export { JOB_KINDS } from './types.js';
export type { JobRow, JobKind } from './types.js';
export { registerConnectors } from './connectors.js';
export type { ConnectorEnv } from './connectors.js';
export { resolveCapabilities, capabilityNames } from '@axiom/connectors';
export {
  asPlatform,
  resolvePlatformConnection,
  connectorForConnection,
  decryptConnectorAuth,
  parseConnectorAuth,
  connectorForTarget,
} from './connection.js';
export type { TargetConnectionRef, ResolvedTargetConnector } from './connection.js';
