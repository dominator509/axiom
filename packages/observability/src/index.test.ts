import { describe, expect, it } from 'vitest';
import type { Event, Log } from '@sentry/node';
import {
  sanitizeTelemetryEvent,
  sanitizeTelemetryLog,
  sanitizeTelemetrySpan,
  sanitizeTelemetryValue,
  withTelemetrySpan,
} from './index.js';

describe('server telemetry privacy boundary', () => {
  it('redacts credential-shaped fields, strings, and OAuth query values', () => {
    const safe = sanitizeTelemetryValue({
      access_token: 'access-secret',
      x_api_key: 'header-api-secret',
      oauth_code: 'authorization-code-secret',
      privateKey: 'signing-private-key',
      nonce: 'oauth-nonce-secret',
      nested: {
        apiKey: 'api-secret',
        message: 'Bearer bearer-secret',
        callback: 'https://example.test/callback?code=oauth-code&state=oauth-state',
      },
    });

    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('access-secret');
    expect(serialized).not.toContain('header-api-secret');
    expect(serialized).not.toContain('authorization-code-secret');
    expect(serialized).not.toContain('signing-private-key');
    expect(serialized).not.toContain('oauth-nonce-secret');
    expect(serialized).not.toContain('api-secret');
    expect(serialized).not.toContain('bearer-secret');
    expect(serialized).not.toContain('oauth-code');
    expect(serialized).not.toContain('oauth-state');
    expect(serialized).toContain('Bearer [REDACTED]');
  });

  it('drops identity, request bodies, cookies, and query data while keeping safe correlation context', () => {
    const event = {
      message: 'provider request failed',
      user: { id: 'private-user', email: 'person@example.test' },
      request: {
        url: 'https://api.example.test/v1/connect?access_token=private-token',
        method: 'POST',
        headers: {
          authorization: 'Bearer private-token',
          cookie: 'session=private-cookie',
          'content-type': 'application/json',
          'x-correlation-id': 'corr-123',
          'user-agent': 'FanThynks-test',
        },
        data: { api_key: 'private-key' },
        cookies: { session: 'private-cookie' },
        query_string: 'access_token=private-token',
        remote_addr: '198.51.100.20',
        env: { remote_addr: '198.51.100.20', api_key: 'env-private-key' },
      },
      tags: { service: 'api', correlation_id: 'corr-123' },
    } as Event;

    const safe = sanitizeTelemetryEvent(event);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('private-user');
    expect(serialized).not.toContain('person@example.test');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('private-cookie');
    expect(serialized).not.toContain('private-key');
    expect(serialized).not.toContain('env-private-key');
    expect(safe.request?.url).toBe('https://api.example.test/v1/connect');
    expect(safe.request).not.toHaveProperty('remote_addr');
    expect(safe.request).not.toHaveProperty('env');
    expect(safe.request?.headers).toEqual({
      'content-type': 'application/json',
      'x-correlation-id': 'corr-123',
      'user-agent': 'FanThynks-test',
    });
    expect(safe.tags).toEqual({ service: 'api', correlation_id: 'corr-123' });
  });

  it('bounds recursive values and oversized strings', () => {
    let deep: Record<string, unknown> = { value: 'secretless' };
    for (let level = 0; level < 8; level += 1) deep = { nested: deep };
    const safe = sanitizeTelemetryValue({ deep, text: 'x'.repeat(5_000) }) as Record<string, unknown>;
    expect(JSON.stringify(safe)).toContain('[TRUNCATED]');
    expect((safe.text as string).length).toBe(4_000);
  });

  it('scrubs structured log parameters and removes identity attributes', () => {
    const message = new String('provider request failed for person@example.test') as unknown as Log['message'];
    message.__sentry_template_string__ = 'provider request %s failed';
    message.__sentry_template_values__ = ['Bearer private-token'];
    const log: Log = {
      level: 'error',
      message,
      attributes: {
        'sentry.service': 'api',
        correlation_id: 'corr-123',
        access_token: 'private-access-token',
        'user.email': 'person@example.test',
        user: { id: 'user-123', email: 'person@example.test' },
        'sentry.user.id': 'sentry-user-123',
        'sentry.user.email': 'sentry@example.test',
        'user.full_name': 'Private Person',
        'client.ip': '192.0.2.10',
        ip: '192.0.2.11',
        phone_number: '+1-555-0100',
        'sentry.message.parameter.0': 'Bearer private-token',
        details: { email: 'nested@example.test', callback: 'https://example.test/?code=oauth-code' },
      },
    };

    const safe = sanitizeTelemetryLog(log);
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('private-access-token');
    expect(serialized).not.toContain('person@example.test');
    expect(serialized).not.toContain('sentry-user-123');
    expect(serialized).not.toContain('sentry@example.test');
    expect(serialized).not.toContain('Private Person');
    expect(serialized).not.toContain('192.0.2.10');
    expect(serialized).not.toContain('192.0.2.11');
    expect(serialized).not.toContain('+1-555-0100');
    expect(serialized).not.toContain('nested@example.test');
    expect(serialized).not.toContain('oauth-code');
    expect(serialized).toContain('Bearer [REDACTED]');
    expect(String(safe.message)).toBe('provider request failed for [REDACTED]');
    expect(safe.attributes).toEqual({
      'sentry.service': 'api',
      correlation_id: 'corr-123',
      access_token: '[REDACTED]',
      'sentry.message.parameter.0': 'Bearer [REDACTED]',
      details: { callback: 'https://example.test/?code=[REDACTED]' },
    });
    expect(safe.message.__sentry_template_string__).toBe('provider request %s failed');
    expect(safe.message.__sentry_template_values__).toEqual(['Bearer [REDACTED]']);
  });

  it('redacts IP and phone values embedded in free-text log messages', () => {
    const safe = sanitizeTelemetryLog({
      level: 'error',
      message: 'request from 198.51.100.20 (2001:db8::1), call +1-415-555-0123 or 555-0100; release 2026-10-10',
      attributes: {},
    });

    expect(String(safe.message)).toBe(
      'request from [REDACTED] ([REDACTED]), call [REDACTED] or [REDACTED]; release 2026-10-10',
    );
  });

  it('runs work unchanged when telemetry is not configured', async () => {
    const result = await withTelemetrySpan({ name: 'test operation', op: 'test' }, async () => 42);
    expect(result).toBe(42);
  });

  it('preserves span link arrays while scrubbing linked attributes', () => {
    const span = {
      trace_id: 'trace-1234567890abcdef',
      span_id: 'span-1234567890',
      name: 'provider call',
      attributes: { access_token: 'private-span-token', 'user.email': 'span@example.test' },
      links: [{ trace_id: 'linked-trace', span_id: 'linked-span', attributes: { api_key: 'private-link-key' } }],
    };

    const safe = sanitizeTelemetrySpan(span);
    expect(Array.isArray(safe.links)).toBe(true);
    expect(safe.attributes).toEqual({ access_token: '[REDACTED]' });
    expect(safe.links).toEqual([{
      trace_id: 'linked-trace',
      span_id: 'linked-span',
      attributes: { api_key: '[REDACTED]' },
    }]);
    expect(JSON.stringify(safe)).not.toContain('private-span-token');
    expect(JSON.stringify(safe)).not.toContain('span@example.test');
    expect(JSON.stringify(safe)).not.toContain('private-link-key');
  });

  it('omits undefined span links instead of replacing them with a non-array marker', () => {
    const safe = sanitizeTelemetrySpan({
      trace_id: 'trace-1234567890abcdef',
      span_id: 'span-1234567890',
      name: 'provider call',
      links: undefined,
    });

    expect(safe).not.toHaveProperty('links');
  });
});
