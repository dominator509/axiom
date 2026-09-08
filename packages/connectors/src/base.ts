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

/** Default metric names available to all platforms */
export const COMMON_METRICS: MetricName[] = ['likes', 'comments', 'shares', 'views', 'impressions'];

/** Maximum log entries kept per connector */
const MAX_LOG = 100;
const MAX_PROVIDER_ERROR_LENGTH = 1_024;
const SENSITIVE_QUERY_KEYS = new Set([
  'access_token',
  'refresh_token',
  'client_secret',
  'api_key',
  'apikey',
  'password',
  'secret',
  'token',
]);

/** Redact credential-bearing query parameters before a provider URL is logged. */
export function redactProviderUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    return url.toString();
  } catch {
    return rawUrl.replace(
      /([?&](?:access_token|refresh_token|client_secret|api[_-]?key|apikey|password|secret|token)=)[^&\s]*/gi,
      '$1[REDACTED]',
    );
  }
}

/** Bound and redact provider text before it reaches logs or durable errors. */
export function redactProviderText(rawText: string): string {
  return rawText
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(["']?(?:access_token|refresh_token|client_secret|api[_-]?key|apikey|password|secret|token)["']?\s*[:=]\s*["']?)[^"'\s,}&]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, MAX_PROVIDER_ERROR_LENGTH);
}

/**
 * Bound every provider request so a stalled upstream cannot occupy a worker
 * forever. This is long enough for the largest supported upload chunk while
 * remaining below the worker's stale-lease recovery window.
 */
export const CONNECTOR_REQUEST_TIMEOUT_MS = 5 * 60_000;

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
  /** HTTP client supplied by the owning execution plane. */
  protected readonly fetchImpl: typeof fetch;

  protected logHistory: LogEntry[] = [];

  /**
   * Connector-local idempotency is only a convenience for repeated calls on
   * the same instance. Durable publish idempotency belongs to the worker's
   * database ledger; sharing this cache across connector instances could turn
   * a post-commit retry into a false skipped result after a transaction
   * rollback.
   */
  private readonly idempotencyLedger = new Map<string, IdempotencyEntry>();

  constructor(
    platform: Platform,
    displayName: string,
    publishMode: PublishMode,
    auth: ConnectorAuth,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.platform = platform;
    this.displayName = displayName;
    this.publishMode = publishMode;
    this.auth = auth;
    const transport = fetchImpl;
    this.fetchImpl = (input, init) => {
      const timeoutSignal = AbortSignal.timeout(CONNECTOR_REQUEST_TIMEOUT_MS);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      return transport(input, { ...init, signal });
    };
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
    const entry = this.idempotencyLedger.get(`${this.platform}:${key}`);
    return entry;
  }

  /**
   * Record result in the idempotency ledger.
   */
  protected recordIdempotency(
    key: string,
    remoteId: string | null,
    state: 'published' | 'pending' | 'failed' | 'skipped',
  ): void {
    this.idempotencyLedger.set(`${this.platform}:${key}`, {
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
      if (existing.state === 'pending') {
        this.log('info', 'publish', `Resuming pending post ${input.idempotencyKey}`);
      }
      // 'failed' state — allow retry
      if (existing.state === 'failed') {
        this.log('warn', 'publish', `Retrying previously-failed post ${input.idempotencyKey}`);
      }
    }

    const start = Date.now();
    try {
      const result = await doPublish();
      result.latencyMs = Date.now() - start;

      this.recordIdempotency(input.idempotencyKey, result.remoteId, result.state);

      return result;
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const errorMsg = redactProviderText(err instanceof Error ? err.message : String(err));
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
    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const safeUrl = redactProviderUrl(url);
      this.log('error', 'apiGet', `HTTP ${response.status}: ${redactProviderText(body)}`, {
        url: safeUrl,
      });
      throw new Error(`API GET ${safeUrl} failed: ${response.status} ${response.statusText}`);
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
    const response = await this.fetchImpl(url, {
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
      const safeUrl = redactProviderUrl(url);
      this.log('error', 'apiPost', `HTTP ${response.status}: ${redactProviderText(responseBody)}`, {
        url: safeUrl,
      });
      throw new Error(`API POST ${safeUrl} failed: ${response.status} ${response.statusText}`);
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
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        ...headers,
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const safeUrl = redactProviderUrl(url);
      this.log('error', 'apiUpload', `HTTP ${response.status}: ${redactProviderText(body)}`, {
        url: safeUrl,
      });
      throw new Error(`API Upload to ${safeUrl} failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * DELETE request.
   */
  protected async apiDelete<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.auth.accessToken}`,
        'Content-Type': 'application/json',
        ...headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const safeUrl = redactProviderUrl(url);
      this.log('error', 'apiDelete', `HTTP ${response.status}: ${redactProviderText(body)}`, {
        url: safeUrl,
      });
      throw new Error(`API DELETE ${safeUrl} failed: ${response.status} ${response.statusText}`);
    }

    const responseBody = await response.text();
    if (responseBody.trim().length === 0) return undefined as T;
    return JSON.parse(responseBody) as T;
  }
}
