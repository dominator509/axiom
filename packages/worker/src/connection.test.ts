import { afterEach, describe, expect, it, vi } from 'vitest';
import { asPlatform, parseConnectorAuth } from './connection.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseConnectorAuth', () => {
  it('accepts a legacy raw access-token envelope', () => {
    expect(parseConnectorAuth('raw-access-token')).toEqual({ accessToken: 'raw-access-token' });
  });

  it('accepts the JSON connector-auth envelope and normalizes OAuth field names', () => {
    expect(
      parseConnectorAuth(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          external_user_id: 'provider-user',
          expires_at: 1_800_000_000,
          extra: { pageId: 'page-1' },
        }),
      ),
    ).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      externalUserId: 'provider-user',
      expiresAt: 1_800_000_000,
      extra: { pageId: 'page-1' },
    });
  });

  it('rejects structured credentials without an access token', () => {
    expect(() => parseConnectorAuth(JSON.stringify({ externalUserId: 'provider-user' }))).toThrow(
      'stored connector credential has no access token',
    );
  });

  it('rejects empty credentials', () => {
    expect(() => parseConnectorAuth('   ')).toThrow('stored connector credential is empty');
  });
});

describe('asPlatform', () => {
  it('accepts only the supported connector platforms', () => {
    expect(asPlatform('threads')).toBe('threads');
    expect(() => asPlatform('not-a-platform')).toThrow("unsupported target platform 'not-a-platform'");
  });
});
