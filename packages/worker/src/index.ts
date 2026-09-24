// ─── @axiom/worker — queue runtime entry ───

export { backoffDelayMs, describeDelay } from './backoff.js';
export type { BackoffOptions } from './backoff.js';
export { publishIdemKey, minuteSlot, jobDedupeKey } from './idempotency.js';
export type { PublishKeyInput } from './idempotency.js';
export { enqueueJob } from './enqueue.js';
export { enqueueWeeklyDigest, nextDigestAt } from './digest-schedule.js';
export { enqueueWeeklyViralInsight, nextViralInsightAt } from './viral-insight-schedule.js';
export type { EnqueueJobInput } from './enqueue.js';
export { embedFeatures } from './embedding.js';
export { claimNextJob } from './claim.js';
export type { ClaimResult } from './claim.js';
export { defaultExecutors } from './executors/index.js';
export { triggerEvaluate } from './executors/trigger.js';
export {
  METRICS_PUBLISH_AGE_OFFSETS_MS,
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
export { retrieveTopExemplars, retrieveCaptionGuidance } from './viral-retrieval.js';
export { captionGuidanceReceipt, matchingCaptionGuidance } from './caption-guidance.js';
export { modelPlaybookContext } from './playbook-context.js';
export { assessVariantPerformance } from './variant-evaluation.js';
export { runWorker, workerTick, processJob, readKillSwitch } from './worker.js';
export type { WorkerOptions, WorkerStats } from './worker.js';
export { JOB_KINDS } from './types.js';
export type { JobRow, JobKind } from './types.js';
export { FANVUE_ANALYTICS_INTERVAL_MS, classifyFanvueContact } from './executors/fanvue_analytics.js';
export { registerConnectors } from './connectors.js';
export type { ConnectorEnv } from './connectors.js';
export { resolveCapabilities, capabilityNames } from '@axiom/connectors';
export {
  asPlatform,
  resolvePlatformConnection,
  connectorForConnection,
  patreonConnectorForConnection,
  earningsForConnection,
  inboxForConnection,
  inboxMediaForConnection,
  inboxPreviewForConnection,
  prepareReplySender,
  decryptConnectorAuth,
  parseConnectorAuth,
  connectorForTarget,
} from './connection.js';
export type { TargetConnectionRef, ResolvedTargetConnector, ResolvedPatreonConnector } from './connection.js';
export { storeGeneratedAsset } from './generated-asset-store.js';
export { resolveProviderAssetUrl } from './executors/publish.js';
