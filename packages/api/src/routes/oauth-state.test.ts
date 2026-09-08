import { describe, expect, it } from 'vitest';
import { resolveOAuthCookieSecret } from './oauth-state.js';

describe('resolveOAuthCookieSecret', () => {
  it('uses the application auth secret when configured', () => {
    expect(
      resolveOAuthCookieSecret({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x'.repeat(32) }),
    ).toBe('x'.repeat(32));
  });

  it('fails closed in production when the application auth secret is absent or weak', () => {
    expect(() => resolveOAuthCookieSecret({ NODE_ENV: 'production' })).toThrow(
      'BETTER_AUTH_SECRET must be at least 32 characters in production',
    );
    expect(() =>
      resolveOAuthCookieSecret({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'too-short' }),
    ).toThrow('BETTER_AUTH_SECRET must be at least 32 characters in production');
  });

  it('uses an explicit development-only fallback outside production', () => {
    expect(resolveOAuthCookieSecret({ NODE_ENV: 'test' })).toBe('axiom-dev-secret-change-me');
  });
});
