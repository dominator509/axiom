import type { SocialConnector, ConnectorAuth, ConnectorPublishInput, ConnectorPublishResult, IdempotencyEntry, ConnectorCapability, ValidationReport, ConnectorMetrics, MetricPeriod, MetricName } from './types.js';
import type { Platform, PublishMode } from '@axiom/core';
/** Default metric names available to all platforms */
export declare const COMMON_METRICS: MetricName[];
/** Structured log entry */
export interface LogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    platform: Platform;
    action: string;
    message: string;
    data?: Record<string, unknown>;
}
/**
 * Abstract base class for all SocialConnector implementations.
 * Provides idempotency checking, logging wrapper, and error handling patterns.
 */
export declare abstract class BaseConnector implements SocialConnector {
    readonly platform: Platform;
    readonly displayName: string;
    readonly publishMode: PublishMode;
    readonly auth: ConnectorAuth;
    protected logHistory: LogEntry[];
    constructor(platform: Platform, displayName: string, publishMode: PublishMode, auth: ConnectorAuth);
    abstract capability(): ConnectorCapability;
    abstract validate(input: ConnectorPublishInput): Promise<ValidationReport>;
    abstract publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;
    abstract fetchMetrics(remoteId: string, period?: MetricPeriod): Promise<ConnectorMetrics>;
    abstract revoke(): Promise<void>;
    /**
     * Check the idempotency ledger before publishing.
     * Returns existing entry if already published/skipped, null if fresh.
     */
    protected checkIdempotency(key: string): IdempotencyEntry | undefined;
    /**
     * Record result in the idempotency ledger.
     */
    protected recordIdempotency(key: string, remoteId: string | null, state: 'published' | 'failed' | 'skipped'): void;
    /**
     * Idempotent publish wrapper. If already published (by idempotencyKey),
     * returns the previous result. Otherwise calls doPublish.
     */
    protected idempotentPublish(input: ConnectorPublishInput, doPublish: () => Promise<ConnectorPublishResult>): Promise<ConnectorPublishResult>;
    protected log(level: LogEntry['level'], action: string, message: string, data?: Record<string, unknown>): void;
    /** Return recent log entries */
    getLogs(): LogEntry[];
    /**
     * Authenticated GET request.
     */
    protected apiGet<T>(url: string, headers?: Record<string, string>): Promise<T>;
    /**
     * Authenticated POST request.
     */
    protected apiPost<T>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
    /**
     * Upload binary data (e.g. media uploads).
     */
    protected apiUpload<T>(url: string, formData: FormData, headers?: Record<string, string>): Promise<T>;
    /**
     * DELETE request.
     */
    protected apiDelete<T>(url: string, headers?: Record<string, string>): Promise<T>;
}
//# sourceMappingURL=base.d.ts.map