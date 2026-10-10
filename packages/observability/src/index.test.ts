import { describe, expect, it } from 'vitest';
import type { Event } from '@sentry/node';
import { sanitizeTelemetryEvent, sanitizeTelemetryValue } from './index.js';

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
});
