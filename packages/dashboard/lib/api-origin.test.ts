import { describe, expect, it } from 'vitest';
import { resolveApiOrigin } from './api-origin';

describe('dashboard API origin', () => {
  it('keeps an explicit origin stable without a trailing slash', () => {
    expect(resolveApiOrigin({ NODE_ENV: 'production', API_ORIGIN: 'http://hono:3001/' })).toBe(
      'http://hono:3001',
    );
  });

  it('fails closed when production has no API origin', () => {
    expect(() => resolveApiOrigin({ NODE_ENV: 'production', API_ORIGIN: '' })).toThrow(
      'API_ORIGIN is required in production',
    );
  });

  it('fails closed when AXIOM_ENV selects production', () => {
    expect(() =>
      resolveApiOrigin({ AXIOM_ENV: 'production', NODE_ENV: 'development', API_ORIGIN: '' }),
    ).toThrow('API_ORIGIN is required in production');
  });

  it('allows the loopback default only outside production', () => {
    expect(resolveApiOrigin({ NODE_ENV: 'development', API_ORIGIN: undefined })).toBe(
      'http://127.0.0.1:3001',
    );
  });

  it('rejects origins containing credentials or a query string', () => {
    expect(() =>
      resolveApiOrigin({ NODE_ENV: 'production', API_ORIGIN: 'https://user:pass@example.test' }),
    ).toThrow('without credentials or query');
    expect(() =>
      resolveApiOrigin({ NODE_ENV: 'production', API_ORIGIN: 'https://example.test?internal=1' }),
    ).toThrow('without credentials or query');
  });
});
