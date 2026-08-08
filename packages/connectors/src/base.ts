// ─── BaseConnector Abstract Class ───

import type {
  SocialConnector,
  ConnectorAuth,
  ConnectorPublishInput,
  ConnectorPublishResult,
  IdempotencyEntry,
  ConnectorCapability,
  ValidationReport,
  ConnectorMetrics,
  MetricPeriod,
  MetricName,
} from './types.js';
import type { Platform, PublishMode } from '@axiom/core';

/**
 * In-memory idempotency ledger (would be backed by DB in production).
 * Maps `${platform}:${idempotencyKey}` -> IdempotencyEntry.
 */
const idempotencyLedger = new Map<string, IdempotencyEntry>();

/** Default metric names available to all platforms */
export const COMMON_METRICS: MetricName[] = ['likes', 'comments', 'shares', 'views', 'impressions'];

/** Maximum log entries kept per connector */
const MAX_LOG = 100;

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
export abstract class BaseConnector implements SocialConnector {
  readonly platform: Platform;
  readonly displayName: string;
  readonly publishMode: PublishMode;
  readonly auth: ConnectorAuth;

  protected logHistory: LogEntry[] = [];

  constructor(
    platform: Platform,
    displayName: string,
    publishMode: PublishMode,
    auth: ConnectorAuth,
  ) {
    this.platform = platform;
    this.displayName = displayName;
    this.publishMode = publishMode;
    this.auth = auth;
  }

  // ── Abstract methods ──

  abstract capability(): ConnectorCapability;
  abstract validate(input: ConnectorPublishInput): Promise<ValidationReport>;
  abstract publish(input: ConnectorPublishInput): Promise<ConnectorPublishResult>;
  abstract fetchMetrics(remoteId: string, period?: MetricPeriod): Promise<ConnectorMetrics>;
  abstract revoke(): Promise<void>;

  // ── Idempotency ──

  /**
   * Check the idempotency ledger before publishing.
   * Returns existing entry if already published/skipped, null if fresh.
   */
  protected checkIdempotency(key: string): IdempotencyEntry | undefined {
    const entry = idempotencyLedger.get(`${this.platform}:${key}`);
    return entry;
  }

  /**
   * Record result in the idempotency ledger.
   */
  protected recordIdempotency(
    key: string,
    remoteId: string | null,
    state: 'published' | 'failed' | 'skipped',
  ): void {
    idempotencyLedger.set(`${this.platform}:${key}`, {
      idempotencyKey: key,
      platform: this.platform,
      remoteId,
      state,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Idempotent publish wrapper. If already published (by idempotencyKey),
   * returns the previous result. Otherwise calls doPublish.
   */
  protected async idempotentPublish(
    input: ConnectorPublishInput,
    doPublish: () => Promise<ConnectorPublishResult>,
  ): Promise<ConnectorPublishResult> {
    const existing = this.checkIdempotency(input.idempotencyKey);
    if (existing) {
      if (existing.state === 'published') {
        this.log('info', 'publish', `Skipping already-published post ${input.idempotencyKey}`);
        return {
          remoteId: existing.remoteId,
          state: 'skipped',
          error: undefined,
        };
      }
      if (existing.state === 'skipped') {
        this.log('info', 'publish', `Skipping previously-skipped post ${input.idempotencyKey}`);
        return {
          remoteId: null,
          state: 'skipped',
          error: 'Previously skipped',
        };
      }
      // 'failed' state — allow retry
      this.log('warn', 'publish', `Retrying previously-failed post ${input.idempotencyKey}`);
    }

    const start = Date.now();
    try {
      const result = await doPublish();
      result.latencyMs = Date.now() - start;

      this.recordIdempotency(input.idempotencyKey, result.remoteId, result.state);

      return result;
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordIdempotency(input.idempotencyKey, null, 'failed');

      return {
        remoteId: null,
        state: 'failed',
        error: errorMsg,
        latencyMs: elapsed,
      };
    }
  }

  // ── Logging ──

  protected log(
    level: LogEntry['level'],
    action: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      platform: this.platform,
      action,
      message,
      data,
    };
    this.logHistory.push(entry);
    if (this.logHistory.length > MAX_LOG) {
      this.logHistory.shift();
    }
  }

  /** Return recent log entries */
  getLogs(): LogEntry[] {
    return [...this.logHistory];
  }

  // ── HTTP helpers ──

  /**
   * Authenticated GET request.
   */
  protected async apiGet<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.log('error', 'apiGet', `HTTP ${response.status}: ${body}`, { url });
      throw new Error(`API GET ${url} failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Authenticated POST request.
   */
  protected async apiPost<T>(
    url: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      this.log('error', 'apiPost', `HTTP ${response.status}: ${responseBody}`, { url });
      throw new Error(`API POST ${url} failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Upload binary data (e.g. media uploads).
   */
  protected async apiUpload<T>(
    url: string,
    formData: FormData,
    headers?: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        ...headers,
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.log('error', 'apiUpload', `HTTP ${response.status}: ${body}`, { url });
      throw new Error(`API Upload to ${url} failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * DELETE request.
   */
  protected async apiDelete<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.log('error', 'apiDelete', `HTTP ${response.status}: ${body}`, { url });
      throw new Error(`API DELETE ${url} failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}
