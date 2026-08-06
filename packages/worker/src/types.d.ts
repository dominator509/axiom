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
export type JobKind = 'content.generate' | 'tos.scan' | 'relay.card' | 'publish.target' | 'metrics.poll' | 'viral.label' | 'incident.notify' | 'dlq.replay';
export declare const JOB_KINDS: JobKind[];
/** Payload contracts (loose — payload is jsonb; parse defensively). */
export interface PublishTargetPayload {
    targetId: string;
}
export interface MetricsPollPayload {
    targetId: string;
}
export interface ViralLabelPayload {
    targetId: string;
}
export interface RelayCardPayload {
    bundleId: string;
    channel?: string;
}
export interface GeneratePayload {
    modelId: string;
    prompt?: Record<string, unknown>;
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
//# sourceMappingURL=types.d.ts.map