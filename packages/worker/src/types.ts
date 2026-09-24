// ─── Worker types ───

/** Row shape returned by claim_job() — matches the job table. */
export interface JobRow {
  id: string;
  org_id: string;
  queue: string;
  kind: string;
  payload: Record<string, unknown>;
  state: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: Date | string;
  locked_by: string | null;
  locked_at: Date | string | null;
  dedupe_key: Buffer | null;
  scheduled_for: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}

/** Job kinds per L3.4 §2. */
export type JobKind =
  | 'content.generate'
  | 'media.generate'
  | 'tos.scan'
  | 'relay.card'
  | 'publish.target'
  | 'metrics.poll'
  | 'fanvue.analytics.sync'
  | 'viral.label'
  | 'viral.insight'
  | 'trigger.evaluate'
  | 'scrape.run'
  | 'media.transform'
  | 'incident.notify'
  | 'dlq.replay'
  | 'public.sfw.reply';

export const JOB_KINDS: JobKind[] = [
  'content.generate',
  'media.generate',
  'tos.scan',
  'relay.card',
  'publish.target',
  'metrics.poll',
  'fanvue.analytics.sync',
  'viral.label',
  'viral.insight',
  'trigger.evaluate',
  'scrape.run',
  'media.transform',
  'incident.notify',
  'dlq.replay',
  'public.sfw.reply',
];

/** Payload contracts (loose — payload is jsonb; parse defensively). */
export interface PublishTargetPayload {
  targetId: string;
}
export interface MetricsPollPayload {
  targetId: string;
}
export interface FanvueAnalyticsSyncPayload {
  modelId: string;
  connectionId?: string;
  startDate?: string;
  endDate?: string;
}
export interface ViralLabelPayload {
  targetId: string;
}
export interface ViralInsightPayload {
  modelId: string;
  windowKey: string;
}
export interface RelayCardPayload {
  bundleId?: string;
  insightCardId?: string;
  channel?: string;
}
export interface GeneratePayload {
  bundleId?: string;
  modelId: string;
  prompt?: string;
  style?: string;
  count?: number;
}
export interface TosScanPayload {
  bundleId: string;
}
export interface DlqReplayPayload {
  jobId: string;
}
export interface IncidentNotifyPayload {
  incidentId: string;
  severity?: string;
}
export interface ScrapeRunPayload { runId: string; modelId: string }
export interface MediaTransformPayload { operationId: string }
export interface PublicSfwReplyPayload {
  modelId: string;
  connectionId: string;
  platform: 'x' | 'instagram' | 'reddit';
  postId: string;
  commentId: string;
  text: string;
}
