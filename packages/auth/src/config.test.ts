import { describe, expect, it } from 'vitest';
import { normalizeAuthOrigin, resolveAuthConfig } from './config.js';

describe('resolveAuthConfig', () => {
  it('retains explicit local-development defaults outside production', () => {
    const config = resolveAuthConfig({ NODE_ENV: 'test' });
    expect(config.databaseUrl).toContain('localhost');
    expect(config.baseURL).toContain('127.0.0.1');
    expect(config.trustedOrigins).toContain('http://127.0.0.1:3002');
    expect(config.trustedOrigins).toContain('http://localhost:3002');
  });

  it('fails closed when production credentials are absent', () => {
    expect(() => resolveAuthConfig({ NODE_ENV: 'production' })).toThrow('DATABASE_URL');
  });

  it('rejects a short production auth secret', () => {
    expect(() =>
      resolveAuthConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db.example/app',
        BETTER_AUTH_SECRET: 'too-short',
        BETTER_AUTH_URL: 'https://app.example',
      }),
    ).toThrow('at least 32 characters');
  });

  it('rejects a non-HTTPS production auth origin', () => {
    expect(() =>
      resolveAuthConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db.example/app',
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        BETTER_AUTH_URL: 'http://app.example',
      }),
    ).toThrow('absolute HTTPS URL');
  });

  it('accepts complete production configuration', () => {
    const config = resolveAuthConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db.example/app',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'https://app.example',
    });
    expect(config.baseURL).toBe('https://app.example');
    expect(config.trustedOrigins).toEqual(['https://app.example']);
  });

  it.each([' '.repeat(32), '\t'.repeat(32), 'short'.padEnd(32), '\u00a0'.repeat(32)])(
    'rejects blank or padding-inflated production secrets (case %#)',
    (secret) => {
      expect(() => resolveAuthConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://db.example/app',
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: 'https://app.example',
      })).toThrow('at least 32 characters');
    },
  );

  it('preserves the exact bytes of a valid padded secret', () => {
    const secret = `  ${'x'.repeat(32)}  `;
    expect(resolveAuthConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db.example/app',
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: 'https://app.example',
    }).secret).toBe(secret);
  });

  it('canonicalizes a trailing slash and path before auth and browser-origin checks', () => {
    expect(normalizeAuthOrigin('https://app.example/')).toBe('https://app.example');
    expect(normalizeAuthOrigin('https://app.example/dashboard')).toBe('https://app.example');

    const config = resolveAuthConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://db.example/app',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'https://app.example/dashboard/',
    });
    expect(config.baseURL).toBe('https://app.example');
    expect(config.trustedOrigins).toEqual(['https://app.example']);
  });
});
