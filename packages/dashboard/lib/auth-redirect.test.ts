import { expect, it } from 'vitest';
import { authRedirectUrl } from './auth-redirect';

it('pins both auth redirects to the configured public origin behind a proxy', () => {
  for (const path of ['/login', '/'] as const) {
    expect(authRedirectUrl(path, 'http://localhost:3003/private', 'https://phone.devtunnels.ms').href)
      .toBe(`https://phone.devtunnels.ms${path}`);
  }
});
it('preserves ordinary local operation without an override', () => {
  expect(authRedirectUrl('/login', 'http://localhost:3002/private').href).toBe('http://localhost:3002/login');
});
it.each(['http://external.test', 'https://user:pass@app.test', 'https://app.test/path',
  'https://app.test?query=1', 'https://app.test#fragment', 'javascript:alert(1)'])('rejects invalid configured origin %s', value => {
  expect(() => authRedirectUrl('/', 'http://localhost:3003/', value)).toThrow();
});
