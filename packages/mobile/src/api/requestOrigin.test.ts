import { describe, expect, it } from 'vitest';
import { requestOrigin as nativeOrigin } from './requestOrigin.native';
import { requestOrigin as browserOrigin } from './requestOrigin';

describe('platform request origin', () => {
  it('binds native Origin to the configured API origin, excluding path and query', () => {
    expect(nativeOrigin('https://api.example.invalid:8443/api/auth/sign-out?x=1'))
      .toBe('https://api.example.invalid:8443');
    expect(nativeOrigin('http://127.0.0.1:3001/api/v1/settings')).toBe('http://127.0.0.1:3001');
  });
  it('leaves Origin under browser control on web', () => {
    expect(browserOrigin('https://api.example.invalid/api/auth/sign-out')).toBeUndefined();
  });
});
